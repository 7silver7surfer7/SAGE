import type { NextApiRequest, NextApiResponse } from 'next';
import {
  listCollections,
  listCollectionsEnriched,
  getCollection,
  getCollectionPreview,
  listCollectionItems,
  listWalletNfts,
  getItem,
  listItemActivity,
  listCollectionActivity,
} from '@/utilities/blockscout';

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const TOKENID_RE = /^[0-9]{1,78}$/; // uint256, decimal

/**
 * Public read-only proxy over Robinhood Chain's Blockscout NFT index. No auth —
 * this is public on-chain data (browsing NFTs, like OpenSea). Server-side so we
 * can cache and keep rate-limiting off the client.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { action, address, cursor, tokenId } = req.query;
  // browser + CDN caching on top of the server cache: repeat loads are served
  // from the edge/browser without touching this function or Blockscout at all
  res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=600');
  try {
    switch (action) {
      case 'ListCollections':
        res.status(200).json(await listCollections(cursor as string));
        return;
      case 'ListCollectionsEnriched':
        res.status(200).json(await listCollectionsEnriched(cursor as string));
        return;
      case 'GetCollection':
        if (!ADDRESS_RE.test(String(address))) {
          res.status(400).json({ error: 'invalid collection address' });
          return;
        }
        res.status(200).json(await getCollection(String(address)));
        return;
      case 'GetCollectionPreview':
        if (!ADDRESS_RE.test(String(address))) {
          res.status(400).json({ error: 'invalid collection address' });
          return;
        }
        res.status(200).json(await getCollectionPreview(String(address)));
        return;
      case 'ListItems':
        if (!ADDRESS_RE.test(String(address))) {
          res.status(400).json({ error: 'invalid collection address' });
          return;
        }
        res.status(200).json(await listCollectionItems(String(address), cursor as string));
        return;
      case 'ListWalletNfts':
        if (!ADDRESS_RE.test(String(address))) {
          res.status(400).json({ error: 'invalid wallet address' });
          return;
        }
        res.status(200).json(await listWalletNfts(String(address), cursor as string));
        return;
      case 'GetItem':
        if (!ADDRESS_RE.test(String(address)) || !TOKENID_RE.test(String(tokenId))) {
          res.status(400).json({ error: 'invalid collection address or token id' });
          return;
        }
        res.status(200).json(await getItem(String(address), String(tokenId)));
        return;
      case 'ListItemActivity':
        if (!ADDRESS_RE.test(String(address)) || !TOKENID_RE.test(String(tokenId))) {
          res.status(400).json({ error: 'invalid collection address or token id' });
          return;
        }
        res
          .status(200)
          .json(await listItemActivity(String(address), String(tokenId), cursor as string));
        return;
      case 'ListCollectionActivity':
        if (!ADDRESS_RE.test(String(address))) {
          res.status(400).json({ error: 'invalid collection address' });
          return;
        }
        res.status(200).json(await listCollectionActivity(String(address), cursor as string));
        return;
      default:
        res.status(400).json({ error: 'unknown action' });
    }
  } catch (e: any) {
    console.error('marketplace proxy:', e.message);
    // upstream index hiccup — surface as 502 so the client can retry, not a crash
    res.status(502).json({ error: 'NFT index temporarily unavailable' });
  }
}
