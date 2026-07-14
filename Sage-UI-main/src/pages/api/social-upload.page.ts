import { NextApiRequest, NextApiResponse } from 'next';
import multer from 'multer';
import sharp from 'sharp';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { Role } from '@prisma/client';
import { requireRole } from '@/utilities/apiAuth';
import prisma from '@/prisma/client';
import { uploadBufferToS3 } from '@/utilities/awsS3-server';
import { uploadBufferToFilebase } from '@/utilities/serverWallet';

export const config = { api: { bodyParser: false } };

/**
 * Media uploads for SAGE Social posts. Everything is recompressed server-side
 * so feeds stay light on mobile:
 *  - images (jpeg/png/webp, ≤12MB in)  → max 1600px WebP q80 (usually <300KB)
 *  - GIFs (≤8MB)                       → passed through (animation preserved)
 *  - video (mp4/mov, ≤25MB in)         → 720p H.264 CRF28 + AAC, faststart
 * Output lands on S3 under social/ and the returned URL goes into the post.
 */
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_GIF_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
const IMAGE_MAX_DIM = 1600;
const SHARP_MAX_INPUT_PIXELS = 12000 * 12000;
// NFT drop artwork gets its OWN pipeline: it's sold and collected, not
// scrolled past in a feed, so it's tuned for fidelity per byte rather than
// minimum bandwidth. 2560px (vs. the 1600px feed cap) keeps real detail
// (brushwork, fine linework) legible when a collector zooms in; q90 + max
// encode effort spends more CPU per upload to buy back quality at a given
// size instead of just cranking the compression ratio up.
const NFT_MAX_DIM = 2560;
const NFT_WEBP_QUALITY = 90;

async function optimizeNftArtwork(buffer: Buffer): Promise<Buffer> {
  // withoutEnlargement means a smaller source is never upscaled — "good
  // compression" isn't "invent detail that wasn't there"
  return sharp(buffer, { limitInputPixels: SHARP_MAX_INPUT_PIXELS })
    .rotate()
    .resize({ width: NFT_MAX_DIM, height: NFT_MAX_DIM, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: NFT_WEBP_QUALITY, effort: 6, smartSubsample: true })
    .toBuffer();
}

interface RequestWithFile extends NextApiRequest {
  file?: any;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_VIDEO_BYTES },
});

function runMiddleware(req: any, res: any, fn: any) {
  return new Promise((resolve, reject) => {
    fn(req, res, (result: any) => (result instanceof Error ? reject(result) : resolve(result)));
  });
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args);
    let err = '';
    p.stderr.on('data', (d) => (err += d.toString().slice(-2000)));
    p.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-300)}`))
    );
    p.on('error', reject);
  });
}

/** 720p-class H.264 with faststart — plays everywhere, streams instantly. */
async function transcodeVideo(input: Buffer): Promise<Buffer> {
  const stamp = `social-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const inPath = path.join(os.tmpdir(), `${stamp}-in`);
  const outPath = path.join(os.tmpdir(), `${stamp}-out.mp4`);
  fs.writeFileSync(inPath, input);
  try {
    await runFfmpeg([
      '-y',
      '-i', inPath,
      '-vf', "scale='min(1280,iw)':-2",
      '-c:v', 'libx264',
      '-crf', '28',
      '-preset', 'veryfast',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-c:a', 'aac',
      '-b:a', '96k',
      '-t', '120', // hard cap: two minutes of video per post
      outPath,
    ]);
    return fs.readFileSync(outPath);
  } finally {
    fs.rmSync(inPath, { force: true });
    fs.rmSync(outPath, { force: true });
  }
}

export default async function handler(req: RequestWithFile, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const requester = await requireRole(req, res, [Role.USER, Role.ARTIST, Role.ADMIN]);
  if (!requester) return;
  // same participation gate as posting — media is part of a post
  const u = await prisma.user.findUnique({
    where: { walletAddress: requester.walletAddress },
    select: { role: true, verifiedAt: true, invitedByCode: true },
  });
  if (!u || (u.role === Role.USER && !u.verifiedAt && !u.invitedByCode))
    return res.status(403).json({ error: 'redeem an invite code to post media' });

  try {
    await runMiddleware(req, res, upload.single('file'));
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'no file provided' });
    const mime: string = file.mimetype || '';
    const buffer: Buffer = file.buffer;
    const wallet = requester.walletAddress.toLowerCase().slice(2, 10);
    const stamp = `${wallet}-${Date.now()}`;

    if (mime === 'image/gif') {
      if (buffer.length > MAX_GIF_BYTES)
        return res.status(400).json({ error: 'GIFs are capped at 8MB' });
      const url = await uploadBufferToS3('social', `${stamp}.gif`, 'image/gif', buffer);
      return res.json({ url, mediaType: 'image', bytes: buffer.length });
    }
    // pin=1 → the output goes to FILEBASE (IPFS) instead of S3; returns the
    // public gateway URL. Used for social NFT art (drops/editions) so the
    // media is content-addressed, not platform-hosted.
    const pinToFilebase = String(req.query.pin || '') === '1';
    const gateway = process.env.FILEBASE_GATEWAY || 'https://ipfs.filebase.io/ipfs';
    const toUrl = async (key: string, type: string, buf: Buffer): Promise<string> => {
      if (pinToFilebase) {
        const ipfs = await uploadBufferToFilebase(`social-nft/${key}`, type, buf);
        if (ipfs) return `${gateway}/${ipfs.replace('ipfs://', '')}`;
        // Filebase unconfigured/down → S3 keeps the flow alive
      }
      return uploadBufferToS3('social', key, type, buf);
    };

    if (['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
      if (buffer.length > MAX_IMAGE_BYTES)
        return res.status(400).json({ error: 'images are capped at 12MB' });
      // kind steers the crop: avatars are square-cover 400px, banners 1500×500
      // cover, posts fit inside 1600px. NFT drop art gets its OWN path below —
      // it's sold/collected, not scrolled past in a feed, so it's tuned for
      // fidelity rather than feed bandwidth.
      const kind = String(req.query.kind || 'post');
      if (kind === 'nft') {
        const nft = await optimizeNftArtwork(buffer);
        const url = await toUrl(`${stamp}-nft.webp`, 'image/webp', nft);
        return res.json({ url, mediaType: 'image', bytes: nft.length });
      }
      let pipeline = sharp(buffer, { limitInputPixels: SHARP_MAX_INPUT_PIXELS }).rotate();
      if (kind === 'avatar') {
        pipeline = pipeline.resize({ width: 400, height: 400, fit: 'cover' });
      } else if (kind === 'banner') {
        pipeline = pipeline.resize({ width: 1500, height: 500, fit: 'cover' });
      } else {
        pipeline = pipeline.resize({
          width: IMAGE_MAX_DIM,
          height: IMAGE_MAX_DIM,
          fit: 'inside',
          withoutEnlargement: true,
        });
      }
      const webp = await pipeline.webp({ quality: 80 }).toBuffer();
      const url = await toUrl(`${stamp}-${kind}.webp`, 'image/webp', webp);
      return res.json({ url, mediaType: 'image', bytes: webp.length });
    }
    if (['video/mp4', 'video/quicktime'].includes(mime)) {
      if (buffer.length > MAX_VIDEO_BYTES)
        return res.status(400).json({ error: 'videos are capped at 25MB (≈2 minutes)' });
      const mp4 = await transcodeVideo(buffer);
      const url = await toUrl(`${stamp}.mp4`, 'video/mp4', mp4);
      return res.json({ url, mediaType: 'video', bytes: mp4.length });
    }
    return res.status(400).json({ error: `unsupported type ${mime} — jpeg/png/webp/gif/mp4/mov only` });
  } catch (e: any) {
    console.error('social upload error', e);
    return res.status(500).json({ error: e?.message?.slice(0, 120) || 'upload failed' });
  }
}
