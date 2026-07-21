import { buildNftMetadata } from './nftMetadata';
import { uploadFileToS3 } from './awsS3-client';

const ARWEAVE_UPLOAD_ENDPOINT = '/api/endpoints/arweaveUpload/';
const DROP_UPLOAD_ENDPOINT = '/api/endpoints/dropUpload/';
const S3_MIRROR_FOLDER = 'arweave-mirror';

// Cloud Run rejects request bodies over 32MB at Google's edge (hard HTTP/1
// limit — the request never reaches the app, so the server upload endpoint
// can't help). Files above this threshold skip our server entirely: the
// browser computes the data's merkle root, asks the server to sign just the
// transaction HEADER (SignArweaveTx — the wallet key stays server-side), and
// streams the chunks straight to arweave.net. Margin below 32MB accounts for
// multipart overhead.
const DIRECT_UPLOAD_THRESHOLD_BYTES = 25 * 1024 * 1024;

/**
 * Uploads a file to Arweave (the sole media host) and returns the permanent
 * media URL plus a browser-friendly optimized URL (a resized JPEG for still
 * images; identical to `url` for video/svg/gif). Small files go through the
 * server (which also produces the optimized copy); large files upload
 * browser→Arweave directly.
 */
export async function uploadFileToArweave(
  file: File
): Promise<{ url: string; optimizedUrl: string; posterUrl?: string }> {
  if (file.size > DIRECT_UPLOAD_THRESHOLD_BYTES) {
    return uploadLargeFileToArweave(file);
  }
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch(ARWEAVE_UPLOAD_ENDPOINT, {
    method: 'POST',
    body: formData,
  });
  if (response.status === 401 || response.status === 403) {
    // the write endpoints are admin-gated; a stale session lands here
    throw new Error('Your session expired — please sign out and sign back in, then retry.');
  }
  if (response.status === 413) {
    throw new Error(
      `'${file.name}' is too large for the server upload path — this should have used the direct path; please report this.`
    );
  }
  const { url, optimizedUrl, error } = await response.json().catch(() => ({}));
  if (error || !url) {
    throw new Error(error || 'Arweave upload failed');
  }
  return { url, optimizedUrl: optimizedUrl || url };
}

/**
 * Browser→Arweave chunked upload for files too large to pass through Cloud
 * Run. The server never sees the bytes — it signs the transaction header
 * (data_root + size + content type) after role-checking the caller, then the
 * browser posts the chunks to the gateway itself.
 */
async function uploadLargeFileToArweave(
  file: File
): Promise<{ url: string; optimizedUrl: string }> {
  // arweave-js is ~150kB — load it only when a large upload actually happens
  const Arweave = (await import('arweave')).default;
  const arweave = Arweave.init({ host: 'arweave.net', port: 443, protocol: 'https' });

  const data = new Uint8Array(await file.arrayBuffer());
  // build an unsigned tx locally purely to compute the merkle data_root
  const draft = await arweave.createTransaction({ data });
  const dataRoot = draft.data_root;

  const signRes = await fetch('/api/endpoints/dropUpload/?action=SignArweaveTx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dataSize: data.byteLength,
      dataRoot,
      contentType: file.type || 'application/octet-stream',
    }),
  });
  if (signRes.status === 401 || signRes.status === 403) {
    throw new Error('Your session expired — please sign out and sign back in, then retry.');
  }
  const { tx: signedTx, error } = await signRes.json().catch(() => ({}));
  if (error || !signedTx) {
    throw new Error(error || 'Arweave upload authorization failed');
  }

  // Post all chunks. Wrapped so we can re-run it: arweave.net sometimes ACKs a
  // chunk POST (200) but drops it before persisting — the uploader reports
  // "complete" yet the data never seeds (a mined tx header with no retrievable
  // data). That's what silently shipped a broken artwork. We verify below and
  // re-post if needed.
  async function postAllChunks() {
    const uploader = await arweave.transactions.getUploader(
      {
        chunkIndex: 0,
        transaction: signedTx,
        lastRequestTimeEnd: 0,
        lastResponseStatus: 0,
        lastResponseError: '',
        txPosted: false,
      } as any,
      data
    );
    while (!uploader.isComplete) {
      await uploader.uploadChunk();
    }
    if (uploader.lastResponseError) {
      throw new Error(
        `Arweave upload of '${file.name}' failed: ${uploader.lastResponseError} (http ${uploader.lastResponseStatus})`
      );
    }
  }

  console.log(`uploadLargeFileToArweave() :: ${file.name} -> ${signedTx.id}, posting chunks…`);
  await postAllChunks();

  // Nudge availability: arweave.net read-availability lags behind the mined tx
  // (minutes, sometimes longer) even for a fully-committed upload. If it's not
  // yet readable, re-post the chunks once — re-posting to a fresh gateway node
  // often makes it available sooner. We do NOT throw on a still-lagging read:
  // the chunks were accepted and the tx is committed, so it WILL become
  // available; the pre-mint gate re-checks before any on-chain mint anyway.
  // (Throwing here would false-reject a good-but-slow upload.)
  console.log(`uploadLargeFileToArweave() :: checking ${signedTx.id} availability…`);
  if (!(await isArweaveDataRetrievable(signedTx.id))) {
    console.warn(`uploadLargeFileToArweave() :: ${signedTx.id} not readable yet, re-posting chunks…`);
    await postAllChunks();
    const readable = await isArweaveDataRetrievable(signedTx.id);
    console.log(
      `uploadLargeFileToArweave() :: ${signedTx.id} ${readable ? 'now readable' : 'still propagating (committed, will appear)'}`
    );
  } else {
    console.log(`uploadLargeFileToArweave() :: ${signedTx.id} readable`);
  }

  // Display-only backup: mirror the same bytes to S3 keyed by txid, so the
  // media proxy has an instant fallback if this viewer's Arweave gateway node
  // hasn't propagated the upload yet — exactly the failure mode above (the
  // whole reason for the isArweaveDataRetrievable dance). The server never
  // saw these bytes (only a signed header), so this mirror has to happen
  // browser-side too. Best-effort: Arweave already has the permanent copy,
  // so a mirror failure must never fail the upload.
  try {
    await uploadFileToS3(DROP_UPLOAD_ENDPOINT, S3_MIRROR_FOLDER, signedTx.id, file);
  } catch (e: any) {
    console.warn(`uploadLargeFileToArweave() :: S3 mirror failed (non-fatal):`, e?.message || e);
  }

  const isVideo = file.type === 'video/mp4';
  const url = `https://arweave.net/${signedTx.id}${isVideo ? '?filetype=mp4' : ''}`;
  // no server-side sharp pass on this path; large stills are downscaled on
  // the fly by next/image, videos never had an optimized variant anyway
  return { url, optimizedUrl: url };
}

/**
 * Polls the Arweave gateway until a tx's DATA is actually retrievable (not just
 * its mined header). Uses a tiny ranged GET; a real 2xx with non-HTML body means
 * the chunks are seeded. Retries with backoff to ride out propagation lag, then
 * gives up (caller treats that as "not seeded").
 */
export async function isArweaveDataRetrievable(txid: string, attempts = 10): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`https://arweave.net/${txid}`, {
        headers: { Range: 'bytes=0-0' },
      });
      const ct = res.headers.get('content-type') || '';
      // gateway serves 200/206 with the real content-type when data is present;
      // a 404 or an HTML error page means it isn't (yet)
      if ((res.status === 200 || res.status === 206) && !ct.startsWith('text/html')) {
        return true;
      }
    } catch {
      /* network hiccup — retry */
    }
    // backoff: 2s, 3s, 4s… (capped) — total ~45s across 10 attempts
    await new Promise((r) => setTimeout(r, Math.min(2000 + i * 1000, 6000)));
  }
  return false;
}

/**
 * Builds a JSON metadata file and uploads it to Arweave.
 */
export async function createNftMetadataOnArweave(
  endpoint: string,
  name: string,
  description: string,
  mediaURL: string,
  isVideo: boolean
) {
  console.log('createNftMetadataOnArweave()');
  const metadata = JSON.stringify({
    filename: name,
    data: buildNftMetadata(name, description, mediaURL, isVideo),
  });
  const response = await fetch(`${endpoint}?action=UploadNftMetadataToArweave`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: metadata,
  });
  const { id, balance, error } = await response.json();
  if (error) {
    console.log(error);
    throw new Error(error);
  }
  console.log(
    `createNftMetadataOnArweave() :: '${name}' metadata saved to ${id} (balance = ${balance})`
  );
  return `https://arweave.net/${id}`;
}