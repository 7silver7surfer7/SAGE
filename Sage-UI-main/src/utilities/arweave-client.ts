import { buildNftMetadata } from './nftMetadata';

const ARWEAVE_UPLOAD_ENDPOINT = '/api/endpoints/arweaveUpload/';

/**
 * Uploads a file directly to Arweave (the sole media host) and returns the
 * permanent media URL plus a browser-friendly optimized URL (a resized JPEG
 * for still images; identical to `url` for video/svg/gif).
 */
export async function uploadFileToArweave(
  file: File
): Promise<{ url: string; optimizedUrl: string }> {
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
  const { url, optimizedUrl, error } = await response.json().catch(() => ({}));
  if (error || !url) {
    throw new Error(error || 'Arweave upload failed');
  }
  return { url, optimizedUrl: optimizedUrl || url };
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