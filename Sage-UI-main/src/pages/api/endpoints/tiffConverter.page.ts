import { NextApiRequest, NextApiResponse } from 'next';
import sharp from 'sharp';
import { Role } from '@prisma/client';
import { requireRole } from '@/utilities/apiAuth';
import { uploadBufferToS3 } from '@/utilities/awsS3-server';

const OPTIMIZED_JPEG_WIDTH = 487;
const OPTIMIZED_BUCKET_FOLDER = 'optimized';

// only fetch/convert paths from our own S3 bucket — the handler does a
// server-side fetch(s3PathTiff), so an arbitrary URL is an SSRF vector
// (cloud metadata endpoints, localhost, internal services). Restrict to the
// configured bucket's S3 host over https.
function isAllowedS3Url(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    const bucket = process.env.S3_BUCKET || '';
    return (
      u.hostname.endsWith('.amazonaws.com') &&
      bucket !== '' &&
      u.hostname.startsWith(`${bucket}.s3`)
    );
  } catch {
    return false;
  }
}

/**
 * Receives an s3Path for a TIFF file (by POST), converts it to PNG, uploads the PNG (also to S3),
 * and returns the path (URL) for the new optimized file.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method != 'POST') {
    res.status(401).end();
    return;
  }
  // was unauthenticated + fetched an attacker-controlled URL (SSRF). Gate to
  // ADMIN and restrict the fetch target to our own S3 bucket.
  const requester = await requireRole(req, res, [Role.ADMIN]);
  if (!requester) return;
  try {
    const { s3PathTiff } = req.body;
    if (!s3PathTiff || !isAllowedS3Url(String(s3PathTiff))) {
      res.status(400).end();
      return;
    }
    const response = await fetch(s3PathTiff);
    const tiffFileContent = new Uint8Array(await response.arrayBuffer());
    const pngBuffer: Buffer = await sharp(tiffFileContent)
      .png()
      .resize(OPTIMIZED_JPEG_WIDTH)
      .toBuffer();
    const filename = `${Date.now().toString()}.png`;
    const s3PathOptimized = await uploadBufferToS3(
      OPTIMIZED_BUCKET_FOLDER,
      filename,
      'image/png',
      pngBuffer
    );
    res.json({ s3PathOptimized });
  } catch (e: any) {
    console.log(e);
    res.json({ s3PathOptimized: null });
  }
  res.end();
}
