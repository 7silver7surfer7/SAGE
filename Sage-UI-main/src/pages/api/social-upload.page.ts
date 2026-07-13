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
    if (['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
      if (buffer.length > MAX_IMAGE_BYTES)
        return res.status(400).json({ error: 'images are capped at 12MB' });
      const webp = await sharp(buffer, { limitInputPixels: SHARP_MAX_INPUT_PIXELS })
        .rotate() // bake EXIF orientation in
        .resize({ width: IMAGE_MAX_DIM, height: IMAGE_MAX_DIM, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      const url = await uploadBufferToS3('social', `${stamp}.webp`, 'image/webp', webp);
      return res.json({ url, mediaType: 'image', bytes: webp.length });
    }
    if (['video/mp4', 'video/quicktime'].includes(mime)) {
      if (buffer.length > MAX_VIDEO_BYTES)
        return res.status(400).json({ error: 'videos are capped at 25MB (≈2 minutes)' });
      const mp4 = await transcodeVideo(buffer);
      const url = await uploadBufferToS3('social', `${stamp}.mp4`, 'video/mp4', mp4);
      return res.json({ url, mediaType: 'video', bytes: mp4.length });
    }
    return res.status(400).json({ error: `unsupported type ${mime} — jpeg/png/webp/gif/mp4/mov only` });
  } catch (e: any) {
    console.error('social upload error', e);
    return res.status(500).json({ error: e?.message?.slice(0, 120) || 'upload failed' });
  }
}
