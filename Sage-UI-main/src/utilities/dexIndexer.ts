import { ethers } from 'ethers';
import prisma from '@/prisma/client';
import { parameters } from '@/constants/config';

/**
 * Chain-wide DEX indexer — the screener's view of EVERY Uniswap V2 pair on
 * this chain, not just tokens launched through our factory. Same architecture
 * as social.page.ts's pool-trade sync, scaled to a whole factory:
 *  - bounded chunked scans (this RPC times out eth_getLogs past ~20k blocks),
 *  - cursors persisted with GREATEST so concurrent Cloud Run instances can
 *    never clobber a cursor BACKWARD (observed live on the pool sync),
 *  - idempotent inserts (skipDuplicates on unique keys), so overlap re-scans
 *    are free.
 * Server-only. The request path (chainTokenRows) is DB-only — every RPC read
 * happens in the cron-poked sweep, never while a user waits.
 */

const CHUNK = 15_000; // blocks per eth_getLogs — comfortably under the RPC's timeout ceiling
const RPC_BATCH = 20; // parallel RPC calls at a time — this RPC rate-limits sustained bursts

const FACTORY_ABI = [
  'event PairCreated(address indexed token0, address indexed token1, address pair, uint256)',
];
const PAIR_ABI = [
  'event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)',
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
];
const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
];

// never a bare url string — the object form is what carries the timeout, and
// a timeout-less provider is exactly how a dead RPC hangs a sweep
function rpc(): ethers.providers.StaticJsonRpcProvider {
  return new ethers.providers.StaticJsonRpcProvider({ url: parameters.RPC_URL, timeout: 30000 });
}

// Retry with backoff on each individual call (keeper_reconcile.js's shape):
// this RPC rate-limits a few hundred calls into a burst, and a clean fail-fast
// would throw away a whole already-mostly-succeeded sweep for one 429.
async function withRetry<T>(fn: () => Promise<T>, tries = 4, baseDelayMs = 1500): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** i));
    }
  }
  throw lastErr;
}

async function batched<I, O>(items: I[], fn: (item: I) => Promise<O>): Promise<O[]> {
  const out: O[] = [];
  for (let i = 0; i < items.length; i += RPC_BATCH) {
    out.push(...(await Promise.all(items.slice(i, i + RPC_BATCH).map(fn))));
  }
  return out;
}

/** first block where the contract has code — so a fresh cursor never scans pre-deploy history */
async function creationBlock(
  provider: ethers.providers.StaticJsonRpcProvider,
  address: string,
  head: number
): Promise<number> {
  // getCode flips from '0x' to bytecode at the deploy block (same trick as
  // syncPoolTradesInner) — log₂(head) archive reads instead of a full scan
  let lo = 1,
    hi = head;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const code = await provider.getCode(address, mid).catch(() => '0x');
    if (code && code !== '0x') hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** timestamps for a set of blocks, deduped + batch-fetched (bursts put many events in one block) */
async function blockTimestamps(
  provider: ethers.providers.StaticJsonRpcProvider,
  blockNumbers: number[]
): Promise<Map<number, number>> {
  const unique = Array.from(new Set(blockNumbers));
  const ts = new Map<number, number>();
  const blocks = await batched(unique, (b) => withRetry(() => provider.getBlock(b)));
  blocks.forEach((b) => ts.set(b.number, b.timestamp));
  return ts;
}

/**
 * PairCreated discovery sweep — walks the factory's event history from the
 * persisted cursor, keeping only WETH-quoted pairs (no ETH side = no way to
 * price the token in ETH, so non-WETH pairs are skipped entirely). Bounded to
 * maxChunks windows per call; a 17k-pair mainnet backlog converges across
 * consecutive cron pokes rather than stalling any single one.
 */
export async function syncPairDiscovery(
  maxChunks = 8
): Promise<{ newPairs: number; cursor: number; done: boolean }> {
  const provider = rpc();
  const head = await withRetry(() => provider.getBlockNumber());
  const state = await prisma.dexIndexState.findUnique({ where: { key: 'pair-discovery' } });
  const from =
    state && state.cursor > 0
      ? state.cursor + 1
      : await creationBlock(provider, parameters.UNISWAP_FACTORY_ADDRESS, head);
  if (from > head) return { newPairs: 0, cursor: state?.cursor ?? head, done: true };

  const factory = new ethers.Contract(parameters.UNISWAP_FACTORY_ADDRESS, FACTORY_ABI, provider);
  const weth = parameters.WETH_ADDRESS.toLowerCase();

  let scannedTo = from - 1;
  let logs: ethers.Event[] = [];
  for (let c = 0; c < maxChunks && scannedTo < head; c++) {
    const chunkFrom = scannedTo + 1;
    const chunkTo = Math.min(chunkFrom + CHUNK - 1, head);
    const chunkLogs = await withRetry(() =>
      factory.queryFilter(factory.filters.PairCreated(), chunkFrom, chunkTo)
    );
    logs = logs.concat(chunkLogs);
    scannedTo = chunkTo;
  }

  // WETH-quoted only; base = the other side
  const found = logs
    .map((l) => {
      const a = l.args!;
      const t0 = String(a.token0);
      const t1 = String(a.token1);
      if (t0.toLowerCase() !== weth && t1.toLowerCase() !== weth) return null;
      const baseIsToken0 = t0.toLowerCase() !== weth;
      return {
        pairAddress: String(a.pair),
        baseToken: baseIsToken0 ? t0 : t1,
        quoteToken: baseIsToken0 ? t1 : t0,
        baseIsToken0,
        blockNumber: l.blockNumber,
      };
    })
    .filter(Boolean) as {
    pairAddress: string;
    baseToken: string;
    quoteToken: string;
    baseIsToken0: boolean;
    blockNumber: number;
  }[];

  let newPairs = 0;
  if (found.length) {
    const ts = await blockTimestamps(
      provider,
      found.map((f) => f.blockNumber)
    );
    // metadata reads individually .catch-guarded: plenty of tokens revert on
    // name()/symbol() (bytes32-era or hostile contracts) — a '?' row still
    // prices and charts fine, a thrown sweep indexes nothing
    const meta = await batched(found, async (f) => {
      const erc20 = new ethers.Contract(f.baseToken, ERC20_ABI, provider);
      const [name, symbol, decimals] = await Promise.all([
        withRetry(() => erc20.name(), 2).catch(() => '?'),
        withRetry(() => erc20.symbol(), 2).catch(() => '?'),
        withRetry(() => erc20.decimals(), 2).catch(() => 18),
      ]);
      return { name: String(name), symbol: String(symbol), decimals: Number(decimals) };
    });
    const result = await prisma.dexPair.createMany({
      data: found.map((f, i) => ({
        pairAddress: f.pairAddress,
        baseToken: f.baseToken,
        quoteToken: f.quoteToken,
        baseIsToken0: f.baseIsToken0,
        baseName: meta[i].name.slice(0, 80),
        baseSymbol: meta[i].symbol.slice(0, 40),
        baseDecimals: Number.isFinite(meta[i].decimals) ? meta[i].decimals : 18,
        createdAtBlock: f.blockNumber,
        createdAt: new Date((ts.get(f.blockNumber) || 0) * 1000),
      })),
      skipDuplicates: true,
    });
    newPairs = result.count;
  }

  // GREATEST via upsert, not a plain write: several instances can sweep
  // concurrently, and a slow sweep finishing last must not drag the cursor
  // backward (same failure mode observed live on poolSyncedBlock)
  await prisma.$executeRaw`
    INSERT INTO "DexIndexState" ("key", "cursor") VALUES ('pair-discovery', ${scannedTo})
    ON CONFLICT ("key") DO UPDATE
    SET "cursor" = GREATEST("DexIndexState"."cursor", EXCLUDED."cursor")
  `;
  return { newPairs, cursor: scannedTo, done: scannedTo >= head };
}

/**
 * Reserve refresh for a set of pairs — priceEth (ETH per 1M base tokens, the
 * app-wide convention) and liquidityEth (the WETH-side reserve) straight off
 * getReserves. Per-pair failures are skipped, never fatal.
 */
export async function refreshPairStats(pairAddresses: string[]): Promise<number> {
  if (!pairAddresses.length) return 0;
  const pairs = await prisma.dexPair.findMany({
    where: { pairAddress: { in: pairAddresses } },
    select: { pairAddress: true, baseIsToken0: true, baseDecimals: true },
  });
  if (!pairs.length) return 0;
  const provider = rpc();
  const reserves = await batched(pairs, (p) =>
    withRetry(() =>
      (new ethers.Contract(p.pairAddress, PAIR_ABI, provider).getReserves() as Promise<{
        reserve0: ethers.BigNumber;
        reserve1: ethers.BigNumber;
      }>)
    ).catch(() => null)
  );
  let updated = 0;
  for (let i = 0; i < pairs.length; i++) {
    const r = reserves[i];
    if (!r) continue; // RPC gave up on this one — leave its last stats standing
    const p = pairs[i];
    const wethReserve = Number(
      ethers.utils.formatEther(p.baseIsToken0 ? r.reserve1 : r.reserve0)
    );
    const baseReserve = Number(
      ethers.utils.formatUnits(p.baseIsToken0 ? r.reserve0 : r.reserve1, p.baseDecimals)
    );
    // empty/drained pool: price 0 not Infinity — div-by-zero here once poisons
    // sort orders and sparklines downstream
    const priceEth = baseReserve > 0 ? (wethReserve / baseReserve) * 1_000_000 : 0;
    await prisma.dexPair.update({
      where: { pairAddress: p.pairAddress },
      data: { priceEth, liquidityEth: baseReserve > 0 ? wethReserve : 0 },
    });
    updated++;
  }
  return updated;
}

/**
 * Swap-history sweep for ONE pair, resuming from its own cursor (first sync
 * starts at the pair's creation block — no pre-pool history exists). Bounded
 * to maxChunks windows; progress persists even mid-backlog so the next call
 * resumes where this one stopped.
 */
export async function syncPairSwaps(
  pairAddress: string,
  maxChunks = 4
): Promise<{ swaps: number }> {
  const pair = await prisma.dexPair.findUnique({ where: { pairAddress } });
  if (!pair) return { swaps: 0 };
  const provider = rpc();
  const head = await withRetry(() => provider.getBlockNumber());
  const from = (pair.swapSyncedBlock ?? pair.createdAtBlock - 1) + 1;
  if (from > head) return { swaps: 0 };

  const pairC = new ethers.Contract(pair.pairAddress, PAIR_ABI, provider);
  let scannedTo = from - 1;
  let logs: ethers.Event[] = [];
  for (let c = 0; c < maxChunks && scannedTo < head; c++) {
    const chunkFrom = scannedTo + 1;
    const chunkTo = Math.min(chunkFrom + CHUNK - 1, head);
    const chunkLogs = await withRetry(() =>
      pairC.queryFilter(pairC.filters.Swap(), chunkFrom, chunkTo)
    );
    logs = logs.concat(chunkLogs);
    scannedTo = chunkTo;
  }

  const rows: {
    pairAddress: string;
    logKey: string;
    txHash: string;
    trader: string;
    side: string;
    ethAmount: number;
    tokenAmount: number;
    priceEth: number;
    createdAt: Date;
  }[] = [];
  if (logs.length) {
    const ts = await blockTimestamps(
      provider,
      logs.map((l) => l.blockNumber)
    );
    for (const log of logs) {
      const a = log.args!;
      const baseIn = Number(
        ethers.utils.formatUnits(pair.baseIsToken0 ? a.amount0In : a.amount1In, pair.baseDecimals)
      );
      const baseOut = Number(
        ethers.utils.formatUnits(pair.baseIsToken0 ? a.amount0Out : a.amount1Out, pair.baseDecimals)
      );
      const ethIn = Number(ethers.utils.formatEther(pair.baseIsToken0 ? a.amount1In : a.amount0In));
      const ethOut = Number(
        ethers.utils.formatEther(pair.baseIsToken0 ? a.amount1Out : a.amount0Out)
      );
      const isBuy = baseOut > 0; // pool pays out base tokens → someone bought
      const tokenAmount = isBuy ? baseOut : baseIn;
      const ethAmount = isBuy ? ethIn : ethOut;
      if (tokenAmount <= 0 || ethAmount <= 0) continue; // dust/flash edge
      rows.push({
        pairAddress: pair.pairAddress,
        logKey: `${log.transactionHash}:${log.logIndex}`,
        txHash: log.transactionHash,
        // APPROXIMATION: 'to' (buys) / 'sender' (sells) is the router for
        // aggregated swaps, not the end wallet. The exact attribution needs
        // per-swap receipts (netting the token's own Transfer deltas, like
        // syncPoolTrades does) — at 17k pairs that's prohibitive, so the
        // chain-wide tape settles for the event args.
        trader: isBuy ? String(a.to) : String(a.sender),
        side: isBuy ? 'buy' : 'sell',
        ethAmount,
        tokenAmount,
        priceEth: (ethAmount / tokenAmount) * 1_000_000,
        createdAt: new Date((ts.get(log.blockNumber) || 0) * 1000),
      });
    }
  }
  if (rows.length) {
    await prisma.dexSwap.createMany({ data: rows, skipDuplicates: true });
    // newest decoded swap is a fresher price than the last reserve read
    await prisma.dexPair.update({
      where: { pairAddress: pair.pairAddress },
      data: { priceEth: rows[rows.length - 1].priceEth },
    });
  }
  // GREATEST for the same concurrent-instance reason as the discovery cursor;
  // raw SQL also skips @updatedAt, so a cursor write never fakes stat freshness
  await prisma.$executeRaw`
    UPDATE "DexPair"
    SET "swapSyncedBlock" = GREATEST(COALESCE("swapSyncedBlock", 0), ${scannedTo})
    WHERE "pairAddress" = ${pair.pairAddress}
  `;
  return { swaps: rows.length };
}

/**
 * The cron orchestrator: one bounded bite of discovery, a stats pass over the
 * stalest + deepest pairs, and swap tape for the deepest pairs still behind
 * head. Each step try/catch-isolated — a flaky RPC degrades one step's count
 * to zero instead of killing the whole sweep.
 */
export async function sweepChainDex(): Promise<{
  discovered: number;
  statsRefreshed: number;
  swapsSynced: number;
}> {
  let discovered = 0;
  try {
    discovered = (await syncPairDiscovery(4)).newPairs;
  } catch (e) {
    console.error('dex sweep: discovery failed', e);
  }

  let statsRefreshed = 0;
  try {
    // stalest 40 (round-robin coverage of the long tail) + top 40 by depth
    // (the pairs anyone actually looks at stay near-live)
    const [stale, deep] = await Promise.all([
      prisma.dexPair.findMany({
        orderBy: { updatedAt: 'asc' },
        take: 40,
        select: { pairAddress: true },
      }),
      prisma.dexPair.findMany({
        orderBy: { liquidityEth: 'desc' },
        take: 40,
        select: { pairAddress: true },
      }),
    ]);
    const addrs = Array.from(new Set([...stale, ...deep].map((p) => p.pairAddress)));
    statsRefreshed = await refreshPairStats(addrs);
  } catch (e) {
    console.error('dex sweep: stats refresh failed', e);
  }

  let swapsSynced = 0;
  try {
    const top = await prisma.dexPair.findMany({
      orderBy: { liquidityEth: 'desc' },
      take: 15,
      select: { pairAddress: true, swapSyncedBlock: true },
    });
    const head = await withRetry(() => rpc().getBlockNumber()).catch(() => null);
    for (const p of top) {
      // skip pairs already at head (when we know it) — the per-pair head
      // re-check inside syncPairSwaps would burn an RPC round for a no-op
      if (head !== null && p.swapSyncedBlock !== null && p.swapSyncedBlock >= head) continue;
      try {
        swapsSynced += (await syncPairSwaps(p.pairAddress, 2)).swaps;
      } catch (e) {
        console.error(`dex sweep: swap sync failed for ${p.pairAddress}`, e);
      }
    }
  } catch (e) {
    console.error('dex sweep: swap pass failed', e);
  }

  return { discovered, statsRefreshed, swapsSynced };
}

export type ChainTokenRow = {
  tokenAddress: string;
  name: string;
  symbol: string;
  pairAddress: string;
  createdAt: Date;
  priceEth: number; // ETH per 1M base tokens
  liquidityEth: number;
  txns24h: { buys: number; sells: number };
  volume24hEth: number;
  change24h: number | null;
  spark: number[];
};

type SwapAgg = {
  pairAddress: string;
  buys24h: number;
  sells24h: number;
  vol24hEth: number;
  first24h: number | null;
};
type SparkBucket = { pairAddress: string; bucket: number; avgPrice: number };

/**
 * 24 hourly points, oldest->newest, forward-filled (same shape as
 * dex.page.ts's sparkFor). [] when the pair had no swaps in 24h.
 */
function sparkFor(buckets: Map<number, number> | undefined, nowBucket: number): number[] {
  if (!buckets || buckets.size === 0) return [];
  const out: number[] = [];
  let last: number | null = null;
  for (let b = nowBucket - 23; b <= nowBucket; b++) {
    const v = buckets.get(b);
    if (v !== undefined) last = v;
    if (last !== null) out.push(last);
  }
  while (out.length < 24) out.unshift(out[0]);
  return out;
}

/**
 * Screener rows for chain-wide tokens — DB-ONLY (zero RPC: this sits on the
 * request path; every chain read already happened in the cron sweep). Our own
 * launches are excluded — they have richer native rows on the social screener
 * and would otherwise show up twice.
 */
export async function chainTokenRows(): Promise<ChainTokenRow[]> {
  const launches = await prisma.socialTokenLaunch.findMany({
    select: { tokenAddress: true },
  });
  const ours = new Set(launches.map((l) => l.tokenAddress.toLowerCase()));

  // over-fetch by the (small) launch count so the exclusion can't shrink a
  // full board below the 500 cap
  const pairs = await prisma.dexPair.findMany({
    orderBy: { liquidityEth: 'desc' },
    take: 500 + ours.size,
  });
  const kept = pairs.filter((p) => !ours.has(p.baseToken.toLowerCase())).slice(0, 500);
  if (!kept.length) return [];

  // one grouped pass each for the 24h window numbers and the spark buckets —
  // SQL aggregates, never a JS loop over a ledger that grows without bound
  const aggs = await prisma.$queryRaw<SwapAgg[]>`
    SELECT
      "pairAddress",
      (COUNT(*) FILTER (WHERE side = 'buy'))::int AS "buys24h",
      (COUNT(*) FILTER (WHERE side = 'sell'))::int AS "sells24h",
      COALESCE(SUM("ethAmount"), 0)::float8 AS "vol24hEth",
      ((ARRAY_AGG("priceEth" ORDER BY id))[1])::float8 AS "first24h"
    FROM "DexSwap"
    WHERE "createdAt" > now() - interval '24 hours'
    GROUP BY "pairAddress"`;
  const aggByPair = new Map(aggs.map((a) => [a.pairAddress.toLowerCase(), a]));

  const sparkRows = await prisma.$queryRaw<SparkBucket[]>`
    SELECT
      "pairAddress",
      FLOOR(EXTRACT(EPOCH FROM "createdAt") / 3600)::int AS "bucket",
      AVG("priceEth")::float8 AS "avgPrice"
    FROM "DexSwap"
    WHERE "createdAt" > now() - interval '24 hours'
    GROUP BY "pairAddress", FLOOR(EXTRACT(EPOCH FROM "createdAt") / 3600)`;
  const sparkByPair = new Map<string, Map<number, number>>();
  for (const r of sparkRows) {
    const key = r.pairAddress.toLowerCase();
    let m = sparkByPair.get(key);
    if (!m) sparkByPair.set(key, (m = new Map()));
    m.set(r.bucket, r.avgPrice);
  }
  const nowBucket = Math.floor(Date.now() / 3_600_000);

  return kept.map((p) => {
    const key = p.pairAddress.toLowerCase();
    const agg = aggByPair.get(key);
    const first = agg?.first24h ?? null;
    return {
      tokenAddress: p.baseToken,
      name: p.baseName,
      symbol: p.baseSymbol,
      pairAddress: p.pairAddress,
      createdAt: p.createdAt,
      priceEth: p.priceEth,
      liquidityEth: p.liquidityEth,
      txns24h: { buys: agg?.buys24h ?? 0, sells: agg?.sells24h ?? 0 },
      volume24hEth: agg?.vol24hEth ?? 0,
      change24h:
        first != null && first > 0 && p.priceEth > 0
          ? ((p.priceEth - first) / first) * 100
          : null,
      spark: sparkFor(sparkByPair.get(key), nowBucket),
    };
  });
}
