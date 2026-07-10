import { buildNftMetadata } from './nftMetadata';

/**
 * Replicates to Arweave a file that was uploaded to AWS S3.
 */
export async function copyFromS3toArweave(endpoint: string, s3Path: string): Promise<string> {
  const response = await fetch(`${endpoint}dropUpload/?action=CopyFromS3toArweave&s3Path=${s3Path}`);
  const { id, balance, error } = await response.json();
  if (error) {
    console.log(error);
    throw new Error(error);
  }
  console.log(`Arweave balance = ${balance}`);
  return `https://arweave.net/${id}`;
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
  const response = await fetch(`${endpoint}dropUpload/?action=UploadNftMetadataToArweave`, {
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