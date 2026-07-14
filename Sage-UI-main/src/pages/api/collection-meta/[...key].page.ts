import { NextApiRequest, NextApiResponse } from 'next';
import { getFilebaseObject } from '@/utilities/serverWallet';

/**
 * Serves collection tokenURIs (and their images) for Filebase-pinned drops.
 *
 * Why this exists: Filebase's S3 API pins every OBJECT as its own CID — a
 * collection prefix like `coll-7/3.json` has no directory CID, so a
 * SageCollection contract's `baseUri + tokenId + ".json"` scheme cannot point
 * at the public IPFS gateway. The contract's baseUri points HERE instead;
 * this route streams the pinned bytes out of the bucket. The content itself
 * stays content-addressed on IPFS (each JSON's `image` field carries its own
 * ipfs:// or gateway URL) — this is only the sequential-path resolver.
 *
 * GET /api/collection-meta/{prefix}/{n}.json
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const parts = req.query.key;
  const key = (Array.isArray(parts) ? parts : [parts]).filter(Boolean).join('/');
  // bucket keys we mint are conservative: prefix segments + {n}.json/.webp
  if (!key || key.includes('..') || key.length > 200)
    return res.status(400).json({ error: 'bad key' });
  const obj = await getFilebaseObject(key);
  if (!obj) return res.status(404).json({ error: 'not found' });
  // pinned collection files are immutable — cache hard (CDN + browser)
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('Content-Type', obj.contentType);
  res.status(200).send(obj.body);
}
