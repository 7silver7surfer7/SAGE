import { NextApiRequest, NextApiResponse } from 'next';
import multer from 'multer';
import sharp from 'sharp';
import NextCors from 'nextjs-cors';
import { Role } from '@prisma/client';
import { OPTIMIZED_IMAGE_WIDTH } from '@/constants/config';
import { arweaveUrl, sendArweaveTransaction } from '@/utilities/arweave-server';
import { requireRole } from '@/utilities/apiAuth';

export const config = { api: { bodyParser: false } };

interface RequestWithFile extends NextApiRequest {
  file?: any;
}

const upload = multer({ storage: multer.memoryStorage() });

// Formats we transcode to a smaller browser-friendly JPEG for display.
// TIFF must be transcoded (browsers can't render it); animated GIF/SVG/MP4 are
// left untouched so animation and vector quality are preserved.
const OPTIMIZABLE = ['image/tiff', 'image/png', 'image/jpeg'];

async function handler(req: RequestWithFile, res: NextApiResponse) {
  await setupCors(req, res);
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  // Every upload spends AR from the site wallet — artists (minting, banners)
  // and admins (drops) only.
  const requester = await requireRole(req, res, [Role.ARTIST, Role.ADMIN]);
  if (!requester) return;
  try {
    await runMiddleware(req, res, upload.single('file'));
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No file provided' });
      return;
    }
    const buffer: Buffer = Buffer.from(file.buffer);
    const mimeType: string = file.mimetype;
    const filename: string = file.originalname || `${Date.now()}`;

    // Upload the original bytes (the permanent NFT asset).
    const { tx } = await sendArweaveTransaction(filename, buffer, mimeType);
    // Arweave URLs are bare content hashes with no file extension, but
    // BaseMedia decides image-vs-video by looking at the URL. Tag video
    // uploads with a marker so that check still works after the media
    // migration off S3 (S3 paths kept their real .mp4 extension).
    const isVideo = mimeType === 'video/mp4';
    const url = arweaveUrl(tx.id) + (isVideo ? '?filetype=mp4' : '');

    // Produce a resized JPEG for display, when the format benefits from it.
    let optimizedUrl = url;
    if (OPTIMIZABLE.includes(mimeType)) {
      const jpegBuffer: Buffer = await sharp(buffer)
        .jpeg()
        .resize(OPTIMIZED_IMAGE_WIDTH)
        .toBuffer();
      const { tx: optimizedTx } = await sendArweaveTransaction(
        `optimized_${filename}.jpg`,
        jpegBuffer,
        'image/jpeg'
      );
      optimizedUrl = arweaveUrl(optimizedTx.id);
    }

    res.json({ url, optimizedUrl });
  } catch (e: any) {
    console.log(e);
    res.status(500).json({ error: (e as Error).message });
  }
}

const runMiddleware = (req: NextApiRequest, res: NextApiResponse, fn: any) => {
  return new Promise((resolve, reject) => {
    fn(req, res, (result: unknown) => {
      if (result instanceof Error) {
        return reject(result);
      }
      return resolve(result);
    });
  });
};

async function setupCors(request: NextApiRequest, response: NextApiResponse) {
  await NextCors(request, response, {
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
    origin: '*',
    optionsSuccessStatus: 200,
  });
}

export default handler;
