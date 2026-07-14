import { PresetDrop, PresetDropArtist } from '@/store/dropsReducer';
import aws from 'aws-sdk';

const AWS_REGION = 'us-east-2';

aws.config.update({
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_SAGE || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY_SAGE || '',
  },
  signatureVersion: 'v4',
  region: AWS_REGION,
});

/**
 * https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#getSignedUrl-property
 */
export function createS3SignedUrl(folder: string, filename: string) {
  const s3 = new aws.S3();
  var params = {
    Bucket: `${process.env.S3_BUCKET}/${folder}`,
    Key: filename,
    // 60s was too tight for a large collection ZIP (up to 1GB) — a PUT that
    // outlives the signed URL fails partway through with no clear error
    // (the client didn't check the PUT response either — see uploadFileToS3),
    // surfacing later as a baffling "staged zip not readable (403)" once
    // processing tries to read an object that was never fully written. A
    // longer window doesn't weaken anything: it's still signed for this one
    // bucket/key/method, just gives a slow upload room to finish.
    Expires: 900,
    // No ACL: the bucket (sageart-media-mirror) runs with ACLs disabled
    // (BucketOwnerEnforced — the modern S3 default); public READ comes from
    // its bucket policy instead. Signing an x-amz-acl header here would make
    // every PUT fail with AccessControlListNotSupported.
  };
  const uploadUrl = s3.getSignedUrl('putObject', params);
  const getUrl = `https://${process.env.S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${folder}/${filename}`;
  return { uploadUrl, getUrl };
}

export async function uploadBufferToS3(
  folder: string,
  filename: string,
  fileType: string,
  buffer: Buffer
): Promise<string> {
  console.log(`uploadBufferToS3(folder: ${folder}, file: ${filename})`);
  let { uploadUrl, getUrl } = createS3SignedUrl(folder, filename);
  console.log(`uploadBufferToS3() :: sending PUT request...`);
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': fileType },
    body: buffer,
  });
  if (response.status != 200) {
    console.log(response);
    throw new Error('Error uploading file to S3');
  }
  console.log(`uploadBufferToS3() :: file uploaded to ${getUrl}`);
  return getUrl;
}

/**
 * Batch-deletes objects from the media bucket by full key. Idempotent: S3's
 * deleteObjects treats a missing key as a successful no-op, so passing a key
 * that was never written (or already gone) is harmless. Chunks to S3's
 * 1,000-keys-per-request limit.
 */
export async function deleteObjectsFromS3(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const s3 = new aws.S3();
  const Bucket = process.env.S3_BUCKET as string;
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000);
    await s3
      .deleteObjects({
        Bucket,
        Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
      })
      .promise();
  }
}

/** Lists every object key under a prefix, following pagination. */
export async function listAllKeysUnderPrefix(prefix: string): Promise<string[]> {
  const s3 = new aws.S3();
  const Bucket = process.env.S3_BUCKET as string;
  const keys: string[] = [];
  let ContinuationToken: string | undefined;
  do {
    const page = await s3
      .listObjectsV2({ Bucket, Prefix: prefix, ContinuationToken })
      .promise();
    for (const obj of page.Contents || []) {
      if (obj.Key) keys.push(obj.Key);
    }
    ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return keys;
}

export async function readPresetDropsFromS3(): Promise<PresetDrop[]> {
  var presetDrops = [];
  const s3 = new aws.S3();
  var listParams = {
    Bucket: 'staging-sage',
    Prefix: 'presets',
    FetchOwner: false,
  };
  const awsRequest = s3.listObjectsV2(listParams, function (err, data) {
    if (err) {
      console.log('readPresetDropsFromS3() :: Error', err);
    } else {
      presetDrops = s3ObjectListToPresetDrops(data.Contents);
    }
  });
  await awsRequest.promise();
  console.log(`readPresetDropsFromS3() :: ${presetDrops.length} items`);
  return presetDrops;
}

function s3ObjectListToPresetDrops(objectList: aws.S3.ObjectList): PresetDrop[] {
  const drops = new Array<PresetDrop>();
  objectList.forEach((item: aws.S3.Object) => {
    if (item.Key.endsWith('/') || item.Key.endsWith('.json')) {
      return; // ignore folders & json files
    }
    let { artistAddress, dropName, filename } = deconstructS3Key(item.Key);
    let drop = findOrCreateDrop(drops, artistAddress, dropName);
    let s3Path = `https://staging-sage.s3.${AWS_REGION}.amazonaws.com/${item.Key}`;
    if (filename.includes('banner')) {
      drop.bannerS3Path = s3Path;
    } else {
      drop.nfts.push(s3Path);
    }
  });
  return drops;
}

/**
 * @dev sample key = 'presets/0xE20d2701Be7963502AdAF47E4135a31F7f6d1165/Space Travel/banner.png'
 */
function deconstructS3Key(key: string) {
  let parts = key.split('/');
  return { artistAddress: parts[1], dropName: parts[2], filename: parts[3] };
}

function findOrCreateDrop(drops: PresetDrop[], _artistAddress: string, _dropName: string) {
  let drop = drops.find(
    ({ artist, dropName }) => artist.walletAddress == _artistAddress && dropName == _dropName
  );
  if (!drop) {
    drop = <PresetDrop>{
      artist: <PresetDropArtist>{
        walletAddress: _artistAddress,
        username: null,
        role: null
      },
      dropName: _dropName,
      bannerS3Path: '',
      nfts: new Array<string>(),
    };
    drops.push(drop);
  }
  return drop;
}
