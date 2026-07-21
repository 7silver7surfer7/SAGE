import { NextApiRequest, NextApiResponse } from 'next';
import { ethers } from 'ethers';
import prisma from '@/prisma/client';
import { parameters } from '@/constants/config';
import { getEthUsd } from '@/utilities/sagePrice';
import { sweepChainDex, syncPairSwaps, refreshPairStats } from '@/utilities/dexIndexer';

/**
 * Chain-wide DEX indexer API — a thin shell over utilities/dexIndexer.ts.
 *
 * Sweep is the cron trigger, same contract as SyncPixelBank: public and
 * unauthenticated by design (the CI cron pokes it with a bare curl — no DB
 * creds or keys in CI), and safe to be so because every underlying step is
 * idempotent (skipDuplicates inserts, GREATEST cursors) — an extra poke can
 * never corrupt state, the throttle just caps RPC load.
 */

// instance-local memo + in-flight dedupe (social.page.ts's pixel-bank shape):
// withMemoCache only caches AFTER compute settles, so without the in-flight
// guard overlapping pokes would stack concurrent multi-minute sweeps
const memoCache = new Map<string, { data: any; expiresAt: number }>();
async function withMemoCache<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
  const hit = memoCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.data;
  const data = await compute();
  memoCache.set(key, { data, expiresAt: Date.now() + ttlMs });
  return data;
}
const inFlight = new Map<string, Promise<any>>();
function deduped<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
  const running = inFlight.get(key);
  if (running) return running;
  const p = withMemoCache(key, ttlMs, compute).finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

// getEthUsd() throws when both Uniswap RPCs AND CoinGecko are down — keep the
// last good rate so a feed outage means slightly-stale USD, not a dead page
let lastGoodEthUsd = 0;

// a detail view tolerates a small cursor lag (~ seconds at this chain's block
// pace) before paying an inline sync; below that the cron's tape is fresh enough
const DETAIL_LAG_BLOCKS = 50;

async function sweep(res: NextApiResponse) {
  const counts = await deduped('dex-sweep', 60_000, () => sweepChainDex());
  res.json(counts);
}

async function pairDetail(req: NextApiRequest, res: NextApiResponse) {
  let address: string;
  try {
    address = ethers.utils.getAddress(String(req.query.address || '').toLowerCase());
  } catch {
    return res.status(400).json({ error: 'bad address' });
  }
  let pair = await prisma.dexPair.findUnique({ where: { pairAddress: address } });
  if (!pair) return res.status(404).json({ error: 'unknown pair' });

  // catch this one pair up BEFORE reading when its cursor lags — a single
  // pair's bounded sync is cheap enough to await inline (Cloud Run throttles
  // post-response CPU, so fire-and-forget would silently stall anyway).
  // Memo-deduped so a polling detail page costs one sync per 5s per instance.
  const provider = new ethers.providers.StaticJsonRpcProvider({
    url: parameters.RPC_URL,
    timeout: 30000,
  });
  const head = await provider.getBlockNumber().catch(() => null);
  const lagging =
    head !== null && (pair.swapSyncedBlock == null || head - pair.swapSyncedBlock > DETAIL_LAG_BLOCKS);
  if (lagging) {
    await deduped(`pair-detail-sync:${address}`, 5_000, async () => {
      await syncPairSwaps(address, 2).catch((e) => console.error('detail swap sync failed', e));
      await refreshPairStats([address]).catch((e) => console.error('detail stats refresh failed', e));
      return true;
    });
    pair = (await prisma.dexPair.findUnique({ where: { pairAddress: address } })) || pair;
  }

  const [swaps, ethUsd] = await Promise.all([
    prisma.dexSwap.findMany({
      where: { pairAddress: address },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    getEthUsd()
      .then((v) => (lastGoodEthUsd = v))
      .catch(() => lastGoodEthUsd),
  ]);

  res.setHeader('Cache-Control', 'no-store');
  res.json({ pair, swaps, ethUsd });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const action = String(req.query.action || '');
  try {
    switch (action) {
      case 'Sweep':
        return await sweep(res);
      case 'PairDetail':
        return await pairDetail(req, res);
      default:
        return res.status(400).json({ error: 'unknown action' });
    }
  } catch (e: any) {
    console.error('dex-index api error', e);
    return res.status(500).json({ error: e?.message || 'internal error' });
  }
}
