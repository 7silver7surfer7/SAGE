import { buildNftMetadata } from './nftMetadata';

const ARWEAVE_UPLOAD_ENDPOINT = '/api/endpoints/arweaveUpload/';

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
): Promise<{ url: string; optimizedUrl: string }> {
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

  // resume-style uploader: signed header from the server + data we hold.
  // getUploader expects a serialized-uploader wrapper (not a bare tx); it
  // recomputes the merkle root from `data` and refuses on mismatch, then
  // posts the tx header (txPosted:false) before streaming chunks.
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

  const isVideo = file.type === 'video/mp4';
  const url = `https://arweave.net/${signedTx.id}${isVideo ? '?filetype=mp4' : ''}`;
  // no server-side sharp pass on this path; large stills are downscaled on
  // the fly by next/image, videos never had an optimized variant anyway
  return { url, optimizedUrl: url };
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