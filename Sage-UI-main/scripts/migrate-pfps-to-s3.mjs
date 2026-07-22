/**
 * One-off: move base64 profile pictures out of the User table into S3.
 *
 * A 75-127KB data-URL avatar stored in the row gets re-shipped from Supabase
 * on every surface that renders it and was a top egress driver. Uploads each
 * blob to the media bucket (same social/ prefix as post images), rewrites
 * User.profilePicture to the public URL, prints before/after. Idempotent —
 * rows already holding URLs are untouched. The API write path now converts
 * data-URLs on upload, so this cannot regrow.
 *
 * Run from Sage-UI-main (needs AWS_ACCESS_KEY_SAGE / AWS_SECRET_ACCESS_KEY_SAGE
 * / S3_BUCKET from .env, prod DATABASE_CONNECTION_POOL_URL in the env):
 *   node scripts/migrate-pfps-to-s3.mjs
 */
import { PrismaClient } from '@prisma/client';
import aws from 'aws-sdk';
import dotenv from 'dotenv';
dotenv.config();

const REGION = 'us-east-2';
aws.config.update({
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_SAGE || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY_SAGE || '',
  },
  signatureVersion: 'v4',
  region: REGION,
});

const prisma = new PrismaClient();
const s3 = new aws.S3();
const Bucket = process.env.S3_BUCKET;

async function main() {
  if (!Bucket) throw new Error('S3_BUCKET not set');
  const users = await prisma.user.findMany({
    where: { profilePicture: { startsWith: 'data:' } },
    select: { walletAddress: true, username: true, profilePicture: true },
  });
  console.log(`${users.length} base64 pfp(s) to migrate`);
  for (const u of users) {
    const m = u.profilePicture.match(/^data:(image\/(png|jpeg|webp|gif|svg\+xml));base64,(.+)$/s);
    if (!m) {
      console.log(`  SKIP ${u.username || u.walletAddress}: unrecognized data URL prefix ${u.profilePicture.slice(0, 40)}`);
      continue;
    }
    const buffer = Buffer.from(m[3], 'base64');
    const ext = m[2] === 'jpeg' ? 'jpg' : m[2] === 'svg+xml' ? 'svg' : m[2];
    const key = `social/${u.walletAddress.slice(2, 10).toLowerCase()}-${Date.now()}-pfp.${ext}`;
    await s3.putObject({ Bucket, Key: key, Body: buffer, ContentType: m[1] }).promise();
    const url = `https://${Bucket}.s3.${REGION}.amazonaws.com/${key}`;
    // guard: only replace if the row still holds the same blob (no clobbering
    // a concurrent profile edit)
    const r = await prisma.user.updateMany({
      where: { walletAddress: u.walletAddress, profilePicture: u.profilePicture },
      data: { profilePicture: url },
    });
    console.log(
      `  ${u.username || u.walletAddress}: ${(buffer.length / 1024).toFixed(0)}KB -> ${url} (${r.count} row)`
    );
  }
  const left = await prisma.user.count({ where: { profilePicture: { startsWith: 'data:' } } });
  console.log(`done — ${left} base64 pfp(s) remaining`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('migration failed:', e.message);
  process.exit(1);
});
