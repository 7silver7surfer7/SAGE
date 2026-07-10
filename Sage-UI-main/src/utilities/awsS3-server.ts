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
    Expires: 60,
    ACL: 'public-read',
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
