import { NextApiRequest, NextApiResponse } from 'next';
import { getSagePriceUsd } from '@/utilities/sagePrice';

// Serves the SAGE/USD price (read from the on-chain SAGE/WETH pair — see
// utilities/sagePrice) to the UI. DexScreener doesn't index Robinhood Chain, so
// it never returned a price for SAGE; the pill rendered blank.

// The pill mounts on every page load; cache so we don't hit the RPC + ETH feed
// on every request. Vercel honors the Cache-Control header; this module-level
// cache covers same-instance bursts and RPC/feed hiccups.
let cache: { priceUsd: number; at: number } | null = null;
const CACHE_MS = 60_000;

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  try {
    if (cache && Date.now() - cache.at < CACHE_MS) {
      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
      res.status(200).json({ priceUsd: cache.priceUsd });
      return;
    }
    const priceUsd = await getSagePriceUsd();
    cache = { priceUsd, at: Date.now() };
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).json({ priceUsd });
  } catch (e) {
    // Serve a stale value if we have one; otherwise report the price as
    // unavailable so the UI simply hides it (same as before).
    if (cache) {
      res.status(200).json({ priceUsd: cache.priceUsd, stale: true });
      return;
    }
    res.status(200).json({ priceUsd: null });
  }
}
