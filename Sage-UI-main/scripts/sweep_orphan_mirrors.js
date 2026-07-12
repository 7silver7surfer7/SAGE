/**
 * One-off maintenance: delete S3 mirror objects that no live DB row references
 * anymore — orphans left by drop deletions that predate mirror cleanup (every
 * re-upload gets fresh Arweave txids, so the old mirror copies just pile up).
 *
 * SAFE BY DEFAULT: dry-run unless you pass --delete. It only removes objects
 * whose txid appears in NO drop, NFT or collection — anything still referenced
 * (approved or draft) is kept. Mirrors are display-only, so even a wrong delete
 * would just fall the proxy back to Arweave, but the referenced-set guard makes
 * that a non-issue.
 *
 *   # against prod:
 *   set -a && . ./.env.deploy && set +a
 *   node scripts/sweep_orphan_mirrors.js            # dry run, lists orphans
 *   node scripts/sweep_orphan_mirrors.js --delete   # actually delete them
 */
try {
  require('dotenv').config();
} catch {}
const { PrismaClient } = require('@prisma/client');
const aws = require('aws-sdk');

const S3_MIRROR_FOLDER = 'arweave-mirror';
const AWS_REGION = 'us-east-2';
const BUCKET = process.env.S3_BUCKET;
const DO_DELETE = process.argv.includes('--delete');

const prisma = new PrismaClient();
aws.config.update({
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_SAGE || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY_SAGE || '',
  },
  signatureVersion: 'v4',
  region: AWS_REGION,
});
const s3 = new aws.S3();

const arweaveTxid = (url) => {
  const m = url ? /arweave\.net\/([A-Za-z0-9_-]{43})/.exec(url) : null;
  return m ? m[1] : null;
};

/** Every txid still referenced by a DB row — the KEEP set. */
async function referencedTxids() {
  const keep = new Set();
  const add = (u) => {
    const t = arweaveTxid(u);
    if (t) keep.add(t);
  };

  const drops = await prisma.drop.findMany({
    select: {
      bannerImageS3Path: true,
      tileImageS3Path: true,
      mobileCoverS3Path: true,
      featuredMediaS3Path: true,
    },
  });
  for (const d of drops) {
    add(d.bannerImageS3Path);
    add(d.tileImageS3Path);
    add(d.mobileCoverS3Path);
    add(d.featuredMediaS3Path);
  }

  const nfts = await prisma.nft.findMany({
    select: { arweavePath: true, s3Path: true, s3PathOptimized: true },
  });
  for (const n of nfts) {
    add(n.arweavePath);
    add(n.s3Path);
    add(n.s3PathOptimized);
  }

  const collections = await prisma.collectionMint.findMany({
    select: { manifestId: true, pathMap: true },
  });
  for (const c of collections) {
    if (c.manifestId) keep.add(c.manifestId);
    if (c.pathMap) {
      try {
        for (const e of Object.values(JSON.parse(c.pathMap))) {
          if (e.img) keep.add(e.img);
          if (e.json) keep.add(e.json);
        }
      } catch {}
    }
  }
  return keep;
}

/** Every mirror object key currently in the bucket. */
async function allMirrorKeys() {
  const keys = [];
  let ContinuationToken;
  do {
    const page = await s3
      .listObjectsV2({ Bucket: BUCKET, Prefix: `${S3_MIRROR_FOLDER}/`, ContinuationToken })
      .promise();
    for (const o of page.Contents || []) keys.push(o.Key);
    ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return keys;
}

async function main() {
  if (!BUCKET) throw new Error('S3_BUCKET not set (source .env.deploy first)');
  const [keep, keys] = await Promise.all([referencedTxids(), allMirrorKeys()]);
  const orphans = keys.filter((k) => {
    const txid = k.slice(`${S3_MIRROR_FOLDER}/`.length);
    return txid && !keep.has(txid);
  });

  console.log(`bucket ${BUCKET}: ${keys.length} mirror objects, ${keep.size} referenced txids`);
  console.log(`orphans: ${orphans.length}`);
  orphans.slice(0, 20).forEach((k) => console.log(`  ${k}`));
  if (orphans.length > 20) console.log(`  … and ${orphans.length - 20} more`);

  if (!DO_DELETE) {
    console.log('\nDRY RUN — re-run with --delete to remove these.');
    return;
  }
  for (let i = 0; i < orphans.length; i += 1000) {
    const chunk = orphans.slice(i, i + 1000);
    await s3
      .deleteObjects({
        Bucket: BUCKET,
        Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
      })
      .promise();
    console.log(`deleted ${Math.min(i + 1000, orphans.length)}/${orphans.length}`);
  }
  console.log('done.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
