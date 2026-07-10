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
  await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  console.log(`uploadFileToS3() :: file uploaded to ${getUrl}`);
  return getUrl;
}

async function fetchS3SignedUrl(endpoint: string, folder: string, filename: string): Promise<any> {
  console.log(`fetchS3SignedUrl()`);
  const response = await fetch(
    `${endpoint}?action=CreateS3SignedUrl&bucket=${folder}&filename=${filename}`
  );
  const responseJson = await response.json();
  console.log(`fetchS3SignedUrl() :: ${responseJson.uploadUrl}`);
  return responseJson;
}
