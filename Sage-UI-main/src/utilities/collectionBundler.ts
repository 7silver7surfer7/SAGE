import { PassThrough, Readable } from 'stream';
import Arweave from 'arweave';
import { bundleAndSignData, createData, ArweaveSigner, DataItem } from 'arbundles';
import * as unzipper from 'unzipper';
import { buildNftMetadata } from './nftMetadata';
import { sendArweaveTransaction } from './arweave-server';
import { uploadBufferToS3 } from './awsS3-server';

/**
 * Bulk "collection drop" pipeline: turns a ZIP of thousands of images (staged
 * on S3 by the browser — Cloud Run's edge rejects request bodies over 32MB, so
 * the zip can never travel through this server directly) into:
 *
 *   1. ANS-104 bundles — every image AND its generated metadata JSON becomes a
 *      signed DataItem; bundles of ~200MB post as ONE Arweave tx each (tags
 *      Bundle-Format/Bundle-Version make gateways unbundle + index every
 *      DataItem id as its own addressable txid). This is what makes thousands
 *      of files affordable/feasible vs. the 2-txs-per-artwork standard path.
 *   2. One small path MANIFEST tx mapping "1.json"/"2.json"/… → metadata
 *      DataItem ids. Token i's on-chain URI is `{arweave.net/manifestId/}{i}.json`
 *      (compact, sequential — the SageCollection contract just appends the
 *      index), while each metadata's `image` field points DIRECTLY at the
 *      image DataItem id (proxy/mirror-friendly).
 *   3. S3 display-mirrors for every DataItem while the bytes are in hand —
 *      freshly-bundled items can take even longer than plain txs to become
 *      readable on gateways, so the mirror is what makes the collection
 *      viewable immediately.
 *
 * Resumable: DataItem ids are NOT reproducible across runs (RSA-PSS signing
 * is randomized), so each completed batch checkpoints its {index → ids} map
 * and bundle txid through onCheckpoint; a retry passes those back in and only
 * missing batches are re-signed/re-posted.
 */

const IMAGE_EXTENSIONS: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
};
export const COLLECTION_MAX_IMAGES = 5000;
export const COLLECTION_MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const COLLECTION_MAX_ZIP_BYTES = 1024 * 1024 * 1024; // 1GB (zip is streamed, never held in RAM)
// Per-bundle batch target. Peak RAM during a flush is roughly 3× this (item
// buffers + assembled bundle + its raw copy), so the old 200MB target peaked
// near half a GB — too hot for an 8GB Raspberry Pi sharing RAM with Postgres.
// 50MB keeps the peak ~150MB at the cost of a few more Arweave bundle txs.
const BUNDLE_TARGET_BYTES =
  (parseInt(process.env.COLLECTION_BUNDLE_TARGET_MB || '', 10) || 50) * 1024 * 1024;
const MIRROR_CONCURRENCY = 8;

export interface PathMapEntry {
  img: string; // image DataItem id
  json: string; // metadata DataItem id
  ext: string; // original image extension (png/jpg/…)
  name?: string; // token name baked into the metadata (from the source filename)
}
export type PathMap = Record<string, PathMapEntry>; // key: 1-based index as string

/**
 * Token name for image i: the source FILENAME when it carries meaning
 * ("water-lilies_dusk.png" → "Water Lilies Dusk"), else "{drop} #{i}".
 * Purely numeric/generic camera names (1.png, 0042.jpg, IMG_1234, DSC0001)
 * don't count as meaningful — external marketplaces showing a wall of
 * "rMonet #7" was the complaint that motivated this (2026-07-12; that
 * collection's metadata is already permanent and keeps its index names).
 */
export function tokenNameFor(entryPath: string, dropName: string, i: number): string {
  const base = (entryPath.split('/').pop() || '').replace(/\.[^.]+$/, '');
  const cleaned = base.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  const generic = /^(\d+|img[ ]?\d*|image[ ]?\d*|dsc[ ]?\d*|untitled[ ]?\d*)$/i.test(cleaned);
  if (!cleaned || generic) return `${dropName} #${i}`;
  // A filename that already contains spaces is a human-authored title — keep
  // it VERBATIM ("Water Lilies at Dusk" must not become "…At Dusk"). Only
  // separator-style names (water-lilies_dusk) get Title Cased.
  if (/\s/.test(base)) return cleaned;
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
}

export interface BatchCheckpoint {
  firstIndex: number; // 1-based, inclusive
  lastIndex: number; // inclusive
  bundleTxid: string;
  entries: PathMap;
}

export interface CollectionProgress {
  imagesTotal: number;
  imagesBundled: number;
  bundlesPosted: string[];
  error?: string;
}

interface ProcessArgs {
  zipUrl: string; // public S3 URL of the staged zip
  dropName: string;
  description: string;
  priorCheckpoints: BatchCheckpoint[]; // [] on first run; resume data on retry
  onCheckpoint: (cp: BatchCheckpoint) => Promise<void>;
  onProgress: (p: CollectionProgress) => Promise<void>;
}

export interface ProcessResult {
  manifestId: string;
  baseUri: string;
  maxSupply: number;
  previewImagePath: string;
  pathMap: PathMap;
}

/** natural sort so img2 < img10 (plain lexicographic would put 10 first) */
function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Random-access source over the staged S3 zip via HTTP Range requests, so the
 * zip is NEVER held in memory/tmpfs whole (tmpfs counts against Cloud Run's
 * RAM) — unzipper reads the central directory, then streams one entry at a
 * time on demand.
 */
export async function openZipFromUrl(zipUrl: string) {
  const head = await fetch(zipUrl, { method: 'HEAD' });
  if (!head.ok) throw new Error(`staged zip not readable (HTTP ${head.status})`);
  const totalSize = Number(head.headers.get('content-length') || 0);
  if (!totalSize) throw new Error('staged zip has no size');
  if (totalSize > COLLECTION_MAX_ZIP_BYTES) {
    throw new Error(`zip is ${(totalSize / 1e9).toFixed(2)}GB — the limit is 1GB`);
  }
  const source = {
    size: async () => totalSize,
    stream: (offset: number, length?: number) => {
      const out = new PassThrough();
      const end = length ? offset + length - 1 : totalSize - 1;
      fetch(zipUrl, { headers: { Range: `bytes=${offset}-${end}` } })
        .then((res) => {
          if (!res.ok || !res.body) throw new Error(`zip range read failed (HTTP ${res.status})`);
          (Readable as any).fromWeb(res.body).pipe(out);
        })
        .catch((e) => out.destroy(e));
      return out;
    },
  };
  return unzipper.Open.custom(source as any);
}

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (item !== undefined) await fn(item);
    }
  });
  await Promise.all(workers);
}

export async function processCollectionZip(args: ProcessArgs): Promise<ProcessResult> {
  const { zipUrl, dropName, description, priorCheckpoints, onCheckpoint, onProgress } = args;
  // ANS-104 DataItems require an Arweave-standard 4096-bit RSA signature, but
  // the platform wallet is a 2048-bit key (fine for regular txs — it still
  // signs and PAYS for the outer bundle tx below). DataItem signers don't
  // need balance or persistence — permanence comes from the outer tx — so a
  // throwaway 4096-bit key generated per run signs the items and is then
  // discarded. The resulting item ids are recorded in the pathMap; nothing
  // ever needs this key again.
  const itemSignerArweave = Arweave.init({});
  const throwawayJwk = await itemSignerArweave.wallets.generate();
  const signer = new ArweaveSigner(throwawayJwk as any);

  const directory = await openZipFromUrl(zipUrl);
  const imageEntries = directory.files
    .filter((f: any) => f.type !== 'Directory')
    .filter((f: any) => {
      const p = f.path as string;
      if (p.startsWith('__MACOSX') || p.split('/').pop()!.startsWith('.')) return false;
      const ext = p.toLowerCase().split('.').pop() || '';
      return ext in IMAGE_EXTENSIONS;
    })
    .sort((a: any, b: any) => naturalCompare(a.path, b.path));

  if (imageEntries.length === 0) throw new Error('the zip contains no supported images (png/jpg/gif)');
  if (imageEntries.length > COLLECTION_MAX_IMAGES) {
    throw new Error(`${imageEntries.length} images — the limit is ${COLLECTION_MAX_IMAGES}`);
  }
  for (const f of imageEntries) {
    if (f.uncompressedSize > COLLECTION_MAX_IMAGE_BYTES) {
      throw new Error(`"${f.path}" is over the 25MB per-image limit`);
    }
  }

  const total = imageEntries.length;
  const pathMap: PathMap = {};
  const bundlesPosted: string[] = [];
  // resume: pre-fill from checkpoints of a previous, interrupted run
  const doneRanges: BatchCheckpoint[] = [...priorCheckpoints];
  for (const cp of doneRanges) {
    Object.assign(pathMap, cp.entries);
    bundlesPosted.push(cp.bundleTxid);
  }
  const isIndexDone = (i: number) => doneRanges.some((cp) => i >= cp.firstIndex && i <= cp.lastIndex);

  let report = async () =>
    onProgress({ imagesTotal: total, imagesBundled: Object.keys(pathMap).length, bundlesPosted });
  await report();

  // Walk indexes in order, accumulating a batch until ~BUNDLE_TARGET_BYTES,
  // then bundle+post+mirror+checkpoint it and move on.
  let batchItems: DataItem[] = [];
  let batchEntries: PathMap = {};
  let batchBytes = 0;
  let batchFirst = 0;
  let batchMirrors: { id: string; type: string; bytes: Buffer }[] = [];

  async function flushBatch(lastIndex: number) {
    if (batchItems.length === 0) return;
    const bundle = await bundleAndSignData(batchItems, signer);
    const raw = Buffer.from(bundle.getRaw());
    const { tx } = await sendArweaveTransaction(
      `collection-bundle-${batchFirst}-${lastIndex}`,
      raw,
      'application/octet-stream',
      [
        { name: 'Bundle-Format', value: 'binary' },
        { name: 'Bundle-Version', value: '2.0.0' },
      ]
    );
    // best-effort S3 mirror of every item in the batch (bytes still in hand);
    // drop each buffer ref the moment its upload finishes so GC can reclaim
    // the batch progressively instead of all-at-once at reset below
    await mapWithConcurrency(batchMirrors, MIRROR_CONCURRENCY, async (m) => {
      try {
        await uploadBufferToS3('arweave-mirror', m.id, m.type, m.bytes);
      } catch (e: any) {
        console.warn(`collection mirror ${m.id} failed (non-fatal):`, e?.message || e);
      } finally {
        (m as any).bytes = null;
      }
    });
    const cp: BatchCheckpoint = {
      firstIndex: batchFirst,
      lastIndex,
      bundleTxid: tx.id,
      entries: batchEntries,
    };
    Object.assign(pathMap, batchEntries);
    bundlesPosted.push(tx.id);
    doneRanges.push(cp);
    await onCheckpoint(cp);
    await report();
    batchItems = [];
    batchEntries = {};
    batchBytes = 0;
    batchMirrors = [];
  }

  for (let i = 1; i <= total; i++) {
    if (isIndexDone(i)) continue;
    if (batchItems.length === 0) batchFirst = i;
    const entry = imageEntries[i - 1];
    const ext = (entry.path.toLowerCase().split('.').pop() || 'png') as string;
    const mime = IMAGE_EXTENSIONS[ext];
    const bytes: Buffer = await entry.buffer();

    const imgItem = createData(bytes, signer, {
      tags: [{ name: 'Content-Type', value: mime }],
    });
    await imgItem.sign(signer);

    const tokenName = tokenNameFor(entry.path, dropName, i);
    const metadata = buildNftMetadata(
      tokenName,
      description,
      `https://arweave.net/${imgItem.id}`,
      false
    );
    const metaBytes = Buffer.from(metadata, 'utf-8');
    const metaItem = createData(metaBytes, signer, {
      tags: [{ name: 'Content-Type', value: 'application/json' }],
    });
    await metaItem.sign(signer);

    batchItems.push(imgItem, metaItem);
    // name rides along so mint registration can label the Nft row without
    // re-fetching the metadata JSON from Arweave
    batchEntries[String(i)] = { img: imgItem.id, json: metaItem.id, ext, name: tokenName };
    batchMirrors.push(
      { id: imgItem.id, type: mime, bytes },
      { id: metaItem.id, type: 'application/json', bytes: metaBytes }
    );
    batchBytes += bytes.length + metaBytes.length;
    if (batchBytes >= BUNDLE_TARGET_BYTES) await flushBatch(i);
  }
  await flushBatch(total);

  // Path manifest: "i.json" → metadata item, "i.ext" → image item. One small
  // regular tx; token URIs resolve as arweave.net/{manifestId}/{i}.json.
  const manifestPaths: Record<string, { id: string }> = {};
  for (const [idx, e] of Object.entries(pathMap)) {
    manifestPaths[`${idx}.json`] = { id: e.json };
    manifestPaths[`${idx}.${e.ext}`] = { id: e.img };
  }
  const manifest = JSON.stringify({
    manifest: 'arweave/paths',
    version: '0.1.0',
    index: { path: '1.json' },
    paths: manifestPaths,
  });
  const manifestBytes = Buffer.from(manifest, 'utf-8');
  const { tx: manifestTx } = await sendArweaveTransaction(
    'collection-manifest',
    manifestBytes,
    'application/x.arweave-manifest+json'
  );
  try {
    await uploadBufferToS3('arweave-mirror', manifestTx.id, 'application/json', manifestBytes);
  } catch {
    /* non-fatal */
  }

  const first = pathMap['1'];
  return {
    manifestId: manifestTx.id,
    baseUri: `https://arweave.net/${manifestTx.id}/`,
    maxSupply: total,
    previewImagePath: `https://arweave.net/${first.img}`,
    pathMap,
  };
}
