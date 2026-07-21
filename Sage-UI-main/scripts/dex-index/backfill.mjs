/**
 * Chain-wide DEX index — one-time backfill.
 *
 * Discovers EVERY Uniswap V2 pair on the chain (PairCreated from the
 * factory's creation block to head — 17.5k pairs on mainnet at build time),
 * keeps the WETH-quoted ones, reads each base token's metadata, and seeds
 * DexPair with reserves-derived price/liquidity. Idempotent: pairs insert
 * with skipDuplicates and the discovery cursor advances monotonically, so
 * re-running only fills gaps. The in-app incremental sweep (SyncDexIndex
 * cron poke) takes over from wherever this leaves the cursor.
 *
 * Run from Sage-UI-main. Defaults to the LOCAL .env DB — for prod:
 *   DATABASE_CONNECTION_POOL_URL=<prod url> RPC=https://rpc.mainnet.chain.robinhood.com \
 *     FACTORY=0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f WETH=0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73 \
 *     CHAIN=4663 node scripts/dex-index/backfill.mjs
 */
import { PrismaClient } from '@prisma/client';
import { ethers } from 'ethers';

const RPC = process.env.RPC || 'https://rpc.mainnet.chain.robinhood.com';
const CHAIN = Number(process.env.CHAIN || 4663);
const FACTORY = process.env.FACTORY || '0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f';
const WETH = (process.env.WETH || '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73').toLowerCase();
const CHUNK = 15000;
const BATCH = 20;

const prisma = new PrismaClient();
const provider = new ethers.providers.StaticJsonRpcProvider({ url: RPC, timeout: 30000 }, CHAIN);
const PAIR_CREATED = ethers.utils.id('PairCreated(address,address,address,uint256)');
const ERC20 = ['function name() view returns (string)', 'function symbol() view returns (string)', 'function decimals() view returns (uint8)'];
const PAIR = ['function getReserves() view returns (uint112, uint112, uint32)'];

// On-chain names/symbols are attacker-controlled bytes: some carry lone
// UTF-16 surrogate halves (broken emoji), and a naive .slice can CREATE one
// by cutting a pair in two — either way Prisma/Postgres reject the string.
// Code-point-aware truncation + strip unpaired surrogates + strip NULs.
function cleanLabel(s, max) {
  const noNul = String(s).replace(/\u0000/g, '');
  const fixed = noNul
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
    .replace(/(^|[^\uD800-\uDBFF])([\uDC00-\uDFFF])/g, '$1');
  return Array.from(fixed).slice(0, max).join('');
}

async function withRetry(fn, tries = 4, base = 1500) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) { last = e; if (i < tries - 1) await new Promise((r) => setTimeout(r, base * 2 ** i)); }
  }
  throw last;
}

async function creationBlock(addr, head) {
  let lo = 1, hi = head;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const code = await withRetry(() => provider.getCode(addr, mid)).catch(() => '0x');
    if (code && code !== '0x') hi = mid; else lo = mid + 1;
  }
  return lo;
}

async function main() {
  const head = await provider.getBlockNumber();
  const state = await prisma.dexIndexState.findUnique({ where: { key: 'pair-discovery' } });
  const from = state?.cursor ? state.cursor + 1 : await creationBlock(FACTORY, head);
  console.log(`discovery: ${from} -> ${head} (${Math.ceil((head - from + 1) / CHUNK)} chunks)`);

  const events = [];
  for (let b = from; b <= head; b += CHUNK) {
    const to = Math.min(b + CHUNK - 1, head);
    const logs = await withRetry(() => provider.getLogs({ address: FACTORY, topics: [PAIR_CREATED], fromBlock: b, toBlock: to }));
    for (const l of logs) {
      const token0 = ethers.utils.getAddress('0x' + l.topics[1].slice(26));
      const token1 = ethers.utils.getAddress('0x' + l.topics[2].slice(26));
      const pair = ethers.utils.getAddress('0x' + l.data.slice(26, 66));
      events.push({ token0, token1, pair, block: l.blockNumber });
    }
    if (events.length && events.length % 2000 < 50) console.log(`…scanned to ${to}, ${events.length} pairs so far`);
  }
  const wethPairs = events.filter((e) => e.token0.toLowerCase() === WETH || e.token1.toLowerCase() === WETH);
  console.log(`total pairs: ${events.length} | WETH-quoted: ${wethPairs.length}`);

  // block timestamps, deduped
  const blocks = Array.from(new Set(wethPairs.map((e) => e.block)));
  const ts = new Map();
  for (let i = 0; i < blocks.length; i += BATCH) {
    const chunk = blocks.slice(i, i + BATCH);
    const got = await Promise.all(chunk.map((b) => withRetry(() => provider.getBlock(b))));
    got.forEach((b) => ts.set(b.number, b.timestamp));
    if (i % (BATCH * 20) === 0) console.log(`…block timestamps ${i}/${blocks.length}`);
  }

  // metadata + insert
  let inserted = 0;
  for (let i = 0; i < wethPairs.length; i += BATCH) {
    const chunk = wethPairs.slice(i, i + BATCH);
    const rows = await Promise.all(
      chunk.map(async (e) => {
        const baseIsToken0 = e.token1.toLowerCase() === WETH;
        const base = baseIsToken0 ? e.token0 : e.token1;
        const c = new ethers.Contract(base, ERC20, provider);
        const [name, symbol, decimals] = await Promise.all([
          withRetry(() => c.name(), 2).catch(() => '?'),
          withRetry(() => c.symbol(), 2).catch(() => '?'),
          withRetry(() => c.decimals(), 2).catch(() => 18),
        ]);
        return {
          pairAddress: e.pair,
          baseToken: base,
          quoteToken: baseIsToken0 ? e.token1 : e.token0,
          baseIsToken0,
          baseName: cleanLabel(name, 80),
          baseSymbol: cleanLabel(symbol, 40),
          baseDecimals: Number(decimals),
          createdAtBlock: e.block,
          createdAt: new Date((ts.get(e.block) || 0) * 1000),
        };
      })
    );
    const r = await prisma.dexPair.createMany({ data: rows, skipDuplicates: true });
    inserted += r.count;
    if (i % (BATCH * 10) === 0) console.log(`…metadata+insert ${i}/${wethPairs.length} (${inserted} new)`);
  }
  console.log(`inserted ${inserted} pair(s)`);

  // initial reserves for price/liquidity
  const all = await prisma.dexPair.findMany({ select: { pairAddress: true, baseIsToken0: true, baseDecimals: true } });
  let statted = 0;
  for (let i = 0; i < all.length; i += BATCH) {
    const chunk = all.slice(i, i + BATCH);
    const reserves = await Promise.all(
      chunk.map((p) => withRetry(() => new ethers.Contract(p.pairAddress, PAIR, provider).getReserves(), 2).catch(() => null))
    );
    for (let j = 0; j < chunk.length; j++) {
      const r = reserves[j];
      if (!r) continue;
      const p = chunk[j];
      const baseRes = Number(ethers.utils.formatUnits(p.baseIsToken0 ? r[0] : r[1], p.baseDecimals));
      const wethRes = Number(ethers.utils.formatEther(p.baseIsToken0 ? r[1] : r[0]));
      await prisma.dexPair.update({
        where: { pairAddress: p.pairAddress },
        data: { liquidityEth: wethRes, priceEth: baseRes > 0 ? (wethRes / baseRes) * 1e6 : 0 },
      });
      statted++;
    }
    if (i % (BATCH * 10) === 0) console.log(`…reserves ${i}/${all.length}`);
  }
  console.log(`stats seeded for ${statted} pair(s)`);

  await prisma.$executeRaw`
    INSERT INTO "DexIndexState" (key, cursor) VALUES ('pair-discovery', ${head})
    ON CONFLICT (key) DO UPDATE SET cursor = GREATEST("DexIndexState".cursor, ${head})`;
  console.log(`cursor -> ${head}. done.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('backfill failed:', e);
  process.exit(1);
});
