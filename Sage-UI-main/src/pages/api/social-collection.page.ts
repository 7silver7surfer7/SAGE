import { NextApiRequest, NextApiResponse } from 'next';
import multer from 'multer';
import sharp from 'sharp';
import * as unzipper from 'unzipper';
import { Role } from '@prisma/client';
import { requireRole } from '@/utilities/apiAuth';
import prisma from '@/prisma/client';
import { uploadJsonToFilebase, uploadBufferToFilebase } from '@/utilities/serverWallet';

export const config = { api: { bodyParser: false, responseLimit: false } };

/**
 * ZIP → collection pipeline for the NFT launcher. The artist uploads a ZIP of
 * images (up to a large project); each image is recompressed to a display
 * WebP (masters stay in the ZIP order), pinned to Filebase/IPFS, and paired
 * with an ERC-721 metadata JSON at {i}.json under a single IPFS directory.
 * Returns the baseUri (ipfs://CID/) the launcher's createCollection needs.
 *
 * SCALE NOTE: a true 10k drop is processed by the background bundler
 * (utilities/collectionBundler.ts) — this synchronous route caps at
 * MAX_SYNC images so a Cloud Run request can't time out; larger ZIPs return
 * the count and the client is told to use the async path. Compression keeps
 * each display asset small (≈1600px WebP q80) so pinning stays cheap.
 */
const MAX_ZIP_BYTES = 500 * 1024 * 1024; // 500MB ZIP ceiling
const MAX_SYNC = 500; // synchronous cap; bigger drops → async bundler
const DISPLAY_DIM = 1600;
const SHARP_MAX_INPUT_PIXELS = 12000 * 12000;
const IMG_EXT = /\.(png|jpe?g|webp|gif)$/i;

interface RequestWithFile extends NextApiRequest {
  file?: any;
}
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_ZIP_BYTES } });
const runMw = (req: any, res: any, fn: any) =>
  new Promise((resolve, reject) => fn(req, res, (r: any) => (r instanceof Error ? reject(r) : resolve(r))));

export default async function handler(req: RequestWithFile, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const requester = await requireRole(req, res, [Role.USER, Role.ARTIST, Role.ADMIN]);
  if (!requester) return;
  const u = await prisma.user.findUnique({
    where: { walletAddress: requester.walletAddress },
    select: { verifiedAt: true, role: true },
  });
  if (!u || (!u.verifiedAt && u.role !== Role.ADMIN))
    return res.status(403).json({ error: 'get verified to launch a collection' });
  if (!process.env.FILEBASE_BUCKET)
    return res.status(400).json({ error: 'Filebase is not configured on this deployment' });

  const { name } = req.query;
  try {
    await runMw(req, res, upload.single('file'));
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'no ZIP provided' });

    // read image entries from the ZIP (sorted by filename for stable ids)
    const dir = await unzipper.Open.buffer(file.buffer);
    const entries = dir.files
      .filter((f) => f.type === 'File' && IMG_EXT.test(f.path) && !f.path.startsWith('__MACOSX'))
      .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
    if (entries.length === 0) return res.status(400).json({ error: 'no images found in the ZIP' });
    if (entries.length > MAX_SYNC)
      return res.status(413).json({
        error: `${entries.length} images — over the ${MAX_SYNC} synchronous limit`,
        count: entries.length,
        useAsync: true,
      });

    const slug = `${requester.walletAddress.slice(2, 10).toLowerCase()}-${Date.now()}`;
    const collectionName = String(name || 'Collection').slice(0, 60);

    // compress + pin each image, then its metadata, under one Filebase prefix
    for (let i = 0; i < entries.length; i++) {
      const tokenId = i + 1;
      const raw = await entries[i].buffer();
      const webp = await sharp(raw, { limitInputPixels: SHARP_MAX_INPUT_PIXELS })
        .rotate()
        .resize({ width: DISPLAY_DIM, height: DISPLAY_DIM, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      const imgUri = await uploadBufferToFilebase(`${slug}/${tokenId}.webp`, 'image/webp', webp);
      await uploadJsonToFilebase(`${slug}/${tokenId}.json`, {
        name: `${collectionName} #${tokenId}`,
        description: `${collectionName} — a generative collection on SAGE Social.`,
        image: imgUri || '',
      });
    }

    // the launcher mints token i → {baseUri}{i}.json; we return the prefix as
    // a gateway URL (ipfs:// prefix would need a per-token CID; Filebase
    // folder pins resolve under the bucket gateway path)
    const gateway = process.env.FILEBASE_GATEWAY || `https://ipfs.filebase.io/ipfs`;
    const baseUri = `${gateway}/${process.env.FILEBASE_BUCKET}/${slug}/`;
    res.json({ ok: true, baseUri, count: entries.length, name: collectionName });
  } catch (e: any) {
    console.error('collection zip error', e);
    return res.status(500).json({ error: e?.message?.slice(0, 140) || 'zip processing failed' });
  }
}
