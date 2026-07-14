import sharp from 'sharp';
import * as unzipper from 'unzipper';
import { tokenNameFor, PathMap, CollectionProgress } from './collectionBundler';
import { uploadBufferToFilebase, uploadJsonToFilebase } from './serverWallet';

/**
 * Filebase/IPFS variant of the collection pipeline — the social launcher's
 * self-serve ZIP drops. Where the Arweave bundler (collectionBundler.ts)
 * signs ANS-104 bundles from the platform wallet, this simply pins every
 * image + its metadata JSON to Filebase under a per-collection prefix:
 *
 *   coll-{cmId}/{i}.webp   display image (compressed master)
 *   coll-{cmId}/{i}.json   ERC-721 metadata, name from the source FILENAME
 *
 * tokenURI = {site}/api/collection-meta/coll-{cmId}/{i}.json — see that route
 * for why a resolver is needed (per-object pins have no directory CID).
 *
 * Kept synchronous-in-request like social-collection.page.ts: social ZIP
 * drops are hundreds of images, not the 10k Arweave-bundler scale.
 */

const IMG_EXT = /\.(png|jpe?g|webp|gif)$/i;
const DISPLAY_DIM = 1600;
const SHARP_MAX_INPUT_PIXELS = 12000 * 12000;
export const FILEBASE_COLLECTION_MAX_IMAGES = 1000;
export const FILEBASE_COLLECTION_MAX_ZIP_BYTES = 400 * 1024 * 1024;

export interface PinResult {
  baseUri: string;
  maxSupply: number;
  previewImagePath: string;
  pathMap: PathMap;
}

export async function processCollectionZipToFilebase(args: {
  zipUrl: string;
  collectionMintId: number;
  dropName: string;
  description: string;
  siteUrl: string; // NEXTAUTH_URL — the resolver route's origin
  onProgress: (p: CollectionProgress) => Promise<void>;
}): Promise<PinResult> {
  const { zipUrl, collectionMintId, dropName, description, siteUrl, onProgress } = args;

  const zipRes = await fetch(zipUrl);
  if (!zipRes.ok) throw new Error(`staged zip not readable (HTTP ${zipRes.status})`);
  const zipBuf = Buffer.from(await zipRes.arrayBuffer());
  if (zipBuf.length > FILEBASE_COLLECTION_MAX_ZIP_BYTES)
    throw new Error(`zip is ${(zipBuf.length / 1048576).toFixed(0)}MB — Filebase drops cap at 400MB`);

  const dir = await unzipper.Open.buffer(zipBuf);
  const entries = dir.files
    .filter((f) => f.type === 'File' && IMG_EXT.test(f.path) && !f.path.startsWith('__MACOSX'))
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }));
  if (!entries.length) throw new Error('no images found in the ZIP');
  if (entries.length > FILEBASE_COLLECTION_MAX_IMAGES)
    throw new Error(
      `${entries.length} images — Filebase drops cap at ${FILEBASE_COLLECTION_MAX_IMAGES}`
    );

  const prefix = `coll-${collectionMintId}`;
  const pathMap: PathMap = {};
  let previewImagePath = '';

  for (let i = 0; i < entries.length; i++) {
    const tokenId = i + 1;
    const entryPath = entries[i].path;
    const raw = await entries[i].buffer();
    const isGif = /\.gif$/i.test(entryPath);
    // GIFs pass through (animation preserved); everything else → display WebP
    const media = isGif
      ? raw
      : await sharp(raw, { limitInputPixels: SHARP_MAX_INPUT_PIXELS })
          .rotate()
          .resize({ width: DISPLAY_DIM, height: DISPLAY_DIM, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 80 })
          .toBuffer();
    const ext = isGif ? 'gif' : 'webp';
    const imgIpfs = await uploadBufferToFilebase(
      `${prefix}/${tokenId}.${ext}`,
      isGif ? 'image/gif' : 'image/webp',
      media
    );
    if (!imgIpfs) throw new Error('Filebase is not configured on this deployment');
    const imgUrl = `https://ipfs.filebase.io/ipfs/${imgIpfs.replace('ipfs://', '')}`;
    const name = tokenNameFor(entryPath, dropName, tokenId);
    const jsonIpfs = await uploadJsonToFilebase(`${prefix}/${tokenId}.json`, {
      name,
      description,
      image: imgUrl,
    });
    if (!jsonIpfs) throw new Error('metadata pin failed');
    if (!previewImagePath) previewImagePath = imgUrl;
    // full URLs (not bare Arweave txids) — registerCollectionMint passes
    // http(s) entries through untouched
    pathMap[String(tokenId)] = { img: imgUrl, json: `${prefix}/${tokenId}.json`, ext, name };
    if (tokenId % 5 === 0 || tokenId === entries.length) {
      await onProgress({
        imagesTotal: entries.length,
        imagesBundled: tokenId,
        bundlesPosted: [],
      });
    }
  }

  return {
    baseUri: `${siteUrl.replace(/\/$/, '')}/api/collection-meta/${prefix}/`,
    maxSupply: entries.length,
    previewImagePath,
    pathMap,
  };
}
