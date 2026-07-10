export function createBucketFolderName() {
  return Date.now().toString();
}

export async function uploadFileToS3Bucket(endpoint: string, bucket: string, filename: string, file: File): Promise<string> {
  console.log(`uploadFileToS3Bucket(bucket: ${bucket}, file: ${filename})`);
  let { uploadUrl, getUrl } = await fetchS3SignedUrl(endpoint, bucket, filename);
  console.log(`uploadFileToS3Bucket() :: sending PUT request...`);
  const result = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  if (result.status != 200) {
    console.log(result);
    throw new Error('Error uploading file to S3');
  }
  console.log(`uploadFileToS3Bucket() :: file uploaded to ${getUrl}`);
  return getUrl;
}

async function fetchS3SignedUrl(endpoint: string, bucket: string, filename: string): Promise<any> {
  console.log(`fetchS3SignedUrl()`);
  const request = await fetch(`${endpoint}dropUpload/?action=CreateS3SignedUrl&bucket=${bucket}&filename=${filename}`);
  const response = await request.json();
  console.log(`fetchS3SignedUrl() :: ${response.uploadUrl}`);
  return response;
}