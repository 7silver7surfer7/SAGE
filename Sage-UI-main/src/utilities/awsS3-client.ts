export function createBucketFolderName() {
  return Date.now().toString();
}

export async function uploadFileToS3(
  endpoint: string,
  folder: string,
  filename: string,
  file: File
): Promise<string> {
  console.log(`uploadFileToS3(folder: ${folder}, file: ${filename})`);
  let { uploadUrl, getUrl } = await fetchS3SignedUrl(endpoint, folder, filename);
  console.log(`uploadFileToS3() :: sending PUT request...`);
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  // this used to go unchecked — a failed PUT (expired signed URL, dropped
  // connection) still returned getUrl as if it had succeeded, so the real
  // failure only surfaced later as a confusing "not readable" error on
  // whatever step next tried to read the (never-written) object
  if (!putRes.ok) throw new Error(`S3 upload failed (HTTP ${putRes.status})`);
  console.log(`uploadFileToS3() :: file uploaded to ${getUrl}`);
  return getUrl;
}

async function fetchS3SignedUrl(endpoint: string, folder: string, filename: string): Promise<any> {
  console.log(`fetchS3SignedUrl()`);
  const response = await fetch(
    `${endpoint}?action=CreateS3SignedUrl&bucket=${folder}&filename=${filename}`
  );
  if (!response.ok) throw new Error(`could not get an upload URL (HTTP ${response.status})`);
  const responseJson = await response.json();
  console.log(`fetchS3SignedUrl() :: ${responseJson.uploadUrl}`);
  return responseJson;
}
