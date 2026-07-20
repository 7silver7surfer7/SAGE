import { NextApiRequest, NextApiResponse } from 'next';
import { ethers } from 'ethers';
import prisma from '@/prisma/client';
import {
  parameters,
  SAGE_PRICE_TOKEN_ADDRESS,
  SAGE_PRICE_FACTORY_ADDRESS,
} from '@/constants/config';
import { getEthUsd } from '@/utilities/sagePrice';

/**
 * DexScreener-style token screener over every SocialTokenLaunch. One payload
 * powers the whole table: price/mcap/liquidity, 5m/1h/24h change, 24h
 * txns+volume, a 24-point sparkline and a server-side trending score.
 *
 * All trade math runs as SQL aggregates (FILTER windows) — never a JS loop
 * over the trade ledger, which grows without bound. Chain reads (curve
 * reserves, graduation, pair reserves) are individually .catch-guarded so a
 * flaky RPC degrades liquidity/graduated to safe zeros instead of 500ing the
 * screener.
 */

const FACTORY_ABI = [
  'function curves(address) view returns (uint256 virtualTokenReserves, uint256 virtualEthReserves, uint256 realTokenReserves, uint256 realEthReserves, address creator, bool complete, bool airdropEnabled)',
  'function pairOf(address) view returns (address)',
];

const PAIR_ABI = [
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() view returns (address)',
];

// Any token whose bonding-curve/graduation state lives on a factory OTHER than
// the current default must keep resolving there — that state can't migrate
// when the default changes. SAGE is pinned to the ORIGINAL factory
// permanently. Copied verbatim from social.page.ts's LEGACY_FACTORY_BY_TOKEN —
// keep BOTH (and factoryAddressForToken() in utilities/socialToken.ts) in
// sync every time SOCIAL_TOKEN_FACTORY_ADDRESS changes AND a token already
// graduated on the outgoing factory.
const LEGACY_FACTORY_BY_TOKEN: Record<string, string> = {
  [SAGE_PRICE_TOKEN_ADDRESS.toLowerCase()]: SAGE_PRICE_FACTORY_ADDRESS,
  '0x4b6fc1facc24d97010e07459788b6d985d6469d9':
    '0x6a22f6647b00022928bb103E66fA0a6659f7A64F', // "test" — graduated pre-2026-07-19 factory swap
};

function factoryForToken(token: string): string {
  const legacy = token && LEGACY_FACTORY_BY_TOKEN[token.toLowerCase()];
  return legacy || parameters.SOCIAL_TOKEN_FACTORY_ADDRESS;
}

type DexRow = {
  tokenAddress: string;
  name: string;
  symbol: string;
  imageUrl: string | null;
  creator: { address: string; username: string | null; verified: boolean };
  createdAt: string;
  graduated: boolean;
  priceEth: number; // ETH per 1M tokens — the app-wide convention
  priceUsd: number; // USD per single token
  mcapUsd: number;
  liquidityUsd: number;
  change5m: number | null;
  change1h: number | null;
  change24h: number | null;
  txns24h: { buys: number; sells: number };
  volume24hUsd: number;
  trending: number;
  spark: number[];
};

type ScreenerPayload = { ethUsd: number; updatedAt: string; rows: DexRow[] };

// Shape of the one-pass trade aggregate below. FILTERed array_agg over an
// empty window yields NULL, hence the nullable first/last prices.
type TradeAgg = {
  tokenAddress: string;
  buys24h: number;
  sells24h: number;
  vol24hEth: number;
  lastPrice: number | null;
  first5m: number | null;
  first1h: number | null;
  first24h: number | null;
};

type SparkBucket = { tokenAddress: string; bucket: number; avgPrice: number };

/** percent change vs the window-open price; null when the window had no trades */
function pct(first: number | null, cur: number): number | null {
  if (first == null || first <= 0 || cur <= 0) return null;
  return ((cur - first) / first) * 100;
}

/**
 * 24 hourly points, oldest->newest. Gaps AFTER the first traded bucket carry
 * the previous value forward; gaps BEFORE it pad flat at the first observed
 * price (we don't query the pre-window price, and a flat lead-in reads better
 * than a truncated line). [] when the token had no trades in 24h.
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

/** curve liquidity (pre-graduation) or pair WETH-side liquidity, in ETH (already x2) */
async function chainStats(
  provider: ethers.providers.StaticJsonRpcProvider,
  token: string
): Promise<{ graduated: boolean; liquidityEth: number }> {
  const factory = new ethers.Contract(factoryForToken(token), FACTORY_ABI, provider);
  const [curve, pair] = await Promise.all([
    factory.curves(token).catch(() => null),
    factory.pairOf(token).catch(() => ethers.constants.AddressZero),
  ]);
  const hasPair = typeof pair === 'string' && pair !== ethers.constants.AddressZero;
  const graduated = Boolean(curve?.complete) || hasPair;
  if (!graduated) {
    // pre-graduation the curve's REAL ETH reserves are the only real
    // liquidity; x2 mirrors how DexScreener quotes both sides of a pool
    const liquidityEth = curve ? Number(ethers.utils.formatEther(curve.realEthReserves)) * 2 : 0;
    return { graduated, liquidityEth };
  }
  if (!hasPair) return { graduated, liquidityEth: 0 };
  try {
    const pairC = new ethers.Contract(pair, PAIR_ABI, provider);
    const [reserves, token0] = await Promise.all([pairC.getReserves(), pairC.token0()]);
    const tokenIs0 = token0.toLowerCase() === token.toLowerCase();
    const wethReserve = tokenIs0 ? reserves.reserve1 : reserves.reserve0;
    return { graduated, liquidityEth: Number(ethers.utils.formatEther(wethReserve)) * 2 };
  } catch {
    // unreadable pair (RPC hiccup) — degrade to $0, never block the screener
    return { graduated, liquidityEth: 0 };
  }
}

// getEthUsd() throws when both Uniswap RPCs AND CoinGecko are down — keep the
// last good rate so a feed outage dims USD numbers to slightly-stale instead
// of zeroing the whole board (0 only on a truly cold instance).
let lastGoodEthUsd = 0;

async function computeScreener(): Promise<ScreenerPayload> {
  const ethUsd = await getEthUsd()
    .then((v) => {
      lastGoodEthUsd = v;
      return v;
    })
    .catch(() => lastGoodEthUsd);

  const launches = await prisma.socialTokenLaunch.findMany({
    orderBy: { createdAt: 'desc' },
    include: { Creator: { select: { username: true, verifiedAt: true } } },
  });

  // One pass over the ledger: windowed counts/volume via FILTER, current and
  // window-open prices via FILTERed ordered array_agg (index [1] = first row).
  const aggs = await prisma.$queryRaw<TradeAgg[]>`
    SELECT
      "tokenAddress",
      (COUNT(*) FILTER (WHERE side = 'buy'  AND "createdAt" > now() - interval '24 hours'))::int AS "buys24h",
      (COUNT(*) FILTER (WHERE side = 'sell' AND "createdAt" > now() - interval '24 hours'))::int AS "sells24h",
      COALESCE(SUM("ethAmount") FILTER (WHERE "createdAt" > now() - interval '24 hours'), 0)::float8 AS "vol24hEth",
      ((ARRAY_AGG("priceEth" ORDER BY id DESC))[1])::float8 AS "lastPrice",
      ((ARRAY_AGG("priceEth" ORDER BY id) FILTER (WHERE "createdAt" > now() - interval '5 minutes'))[1])::float8 AS "first5m",
      ((ARRAY_AGG("priceEth" ORDER BY id) FILTER (WHERE "createdAt" > now() - interval '1 hour'))[1])::float8 AS "first1h",
      ((ARRAY_AGG("priceEth" ORDER BY id) FILTER (WHERE "createdAt" > now() - interval '24 hours'))[1])::float8 AS "first24h"
    FROM "SocialTokenTrade"
    GROUP BY "tokenAddress"`;
  const aggByToken = new Map(aggs.map((a) => [a.tokenAddress.toLowerCase(), a]));

  // sparkline source: hourly avg price buckets, grouped in SQL (one query for
  // ALL tokens), assembled + forward-filled per token in JS
  const sparkRows = await prisma.$queryRaw<SparkBucket[]>`
    SELECT
      "tokenAddress",
      FLOOR(EXTRACT(EPOCH FROM "createdAt") / 3600)::int AS "bucket",
      AVG("priceEth")::float8 AS "avgPrice"
    FROM "SocialTokenTrade"
    WHERE "createdAt" > now() - interval '24 hours'
    GROUP BY "tokenAddress", FLOOR(EXTRACT(EPOCH FROM "createdAt") / 3600)`;
  const sparkByToken = new Map<string, Map<number, number>>();
  for (const r of sparkRows) {
    const key = r.tokenAddress.toLowerCase();
    let m = sparkByToken.get(key);
    if (!m) sparkByToken.set(key, (m = new Map()));
    m.set(r.bucket, r.avgPrice);
  }
  const nowBucket = Math.floor(Date.now() / 3_600_000);

  // never a bare url string — the object form is what carries the timeout,
  // and a timeout-less provider is exactly how a dead RPC hangs a request
  const provider = new ethers.providers.StaticJsonRpcProvider({
    url: parameters.RPC_URL,
    timeout: 30000,
  });
  // modest parallelism — gentle on the shared RPC, still fast for tens of tokens
  const stats = new Map<string, { graduated: boolean; liquidityEth: number }>();
  for (let i = 0; i < launches.length; i += 8) {
    const chunk = launches.slice(i, i + 8);
    const results = await Promise.all(
      chunk.map((l) =>
        chainStats(provider, l.tokenAddress).catch(() => ({ graduated: false, liquidityEth: 0 }))
      )
    );
    chunk.forEach((l, j) => stats.set(l.tokenAddress.toLowerCase(), results[j]));
  }

  const now = Date.now();
  const rows: DexRow[] = launches.map((l) => {
    const key = l.tokenAddress.toLowerCase();
    const agg = aggByToken.get(key);
    const st = stats.get(key) || { graduated: false, liquidityEth: 0 };
    const priceEth = agg?.lastPrice ?? 0;
    const perToken = priceEth / 1e6; // curve prices quote ETH per 1M tokens
    const txns24h = { buys: agg?.buys24h ?? 0, sells: agg?.sells24h ?? 0 };
    const volume24hUsd = (agg?.vol24hEth ?? 0) * ethUsd;
    // volume-led score, txns as a tiebreaker for many-small-trades tokens,
    // and a flat 1.5x boost so fresh launches surface before volume exists
    let trending = volume24hUsd + 5 * (txns24h.buys + txns24h.sells);
    if (now - l.createdAt.getTime() < 24 * 3600 * 1000) trending *= 1.5;
    return {
      tokenAddress: l.tokenAddress,
      name: l.name,
      symbol: l.symbol,
      imageUrl: l.imageUrl,
      creator: {
        address: l.creatorAddress,
        username: l.Creator?.username ?? null,
        verified: Boolean(l.Creator?.verifiedAt),
      },
      createdAt: l.createdAt.toISOString(),
      links: {
        website: l.website ?? null,
        twitter: l.twitter ?? null,
        telegram: l.telegram ?? null,
        discord: l.discord ?? null,
      },
      graduated: st.graduated,
      priceEth,
      priceUsd: perToken * ethUsd,
      mcapUsd: perToken * 1e9 * ethUsd, // fixed 1B supply, pump.fun-style
      liquidityUsd: st.liquidityEth * ethUsd,
      change5m: pct(agg?.first5m ?? null, priceEth),
      change1h: pct(agg?.first1h ?? null, priceEth),
      change24h: pct(agg?.first24h ?? null, priceEth),
      txns24h,
      volume24hUsd,
      trending,
      spark: sparkFor(sparkByToken.get(key), nowBucket),
    };
  });
  rows.sort((a, b) => b.trending - a.trending);

  return { ethUsd, updatedAt: new Date().toISOString(), rows };
}

// Stale-while-revalidate, same shape as social.page.ts's pixelsLeaderboard:
// any warm cache answers instantly, one deduped background refresh runs past
// the TTL, and only a truly cold instance ever computes inline. The screener
// fans out to the RPC per token — that cost must never sit on a request path
// twice.
let screenerCache: { data: ScreenerPayload; at: number } | null = null;
let screenerRefreshing = false;
const SCREENER_TTL_MS = 5_000;

async function screener(): Promise<ScreenerPayload> {
  if (screenerCache) {
    if (Date.now() - screenerCache.at > SCREENER_TTL_MS && !screenerRefreshing) {
      screenerRefreshing = true;
      computeScreener()
        .then((data) => {
          screenerCache = { data, at: Date.now() };
        })
        .catch((e) => console.error('dex screener background refresh failed', e))
        .finally(() => {
          screenerRefreshing = false;
        });
    }
    return screenerCache.data; // always instant once anything is cached
  }
  const data = await computeScreener();
  screenerCache = { data, at: Date.now() };
  return data;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const action = String(req.query.action || 'Screener');
  try {
    switch (action) {
      case 'Screener':
        res.setHeader('Cache-Control', 'no-store');
        return res.json(await screener());
      default:
        return res.status(400).json({ error: 'unknown action' });
    }
  } catch (e: any) {
    console.error('dex api error', e);
    return res.status(500).json({ error: e?.message || 'internal error' });
  }
}
