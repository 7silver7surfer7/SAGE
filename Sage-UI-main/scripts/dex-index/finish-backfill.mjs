/**
 * Resume-only tail for backfill.mjs after a mid-run connection drop:
 * prices the pairs still at liquidityEth=0 (reserves reads) and pins the
 * discovery cursor to the head the interrupted run had already scanned to,
 * so the cron sweep resumes incrementally instead of from factory genesis.
 * Reconnects Prisma per batch — the session pooler killed a single
 * 20-minute connection once already (P1017).
 *
 *   DATABASE_CONNECTION_POOL_URL=<session url> SCANNED_HEAD=<block> node scripts/dex-index/finish-backfill.mjs
 */
import { PrismaClient } from '@prisma/client';
import { ethers } from 'ethers';

const RPC = process.env.RPC || 'https://rpc.mainnet.chain.robinhood.com';
const CHAIN = Number(process.env.CHAIN || 4663);
const SCANNED_HEAD = Number(process.env.SCANNED_HEAD);
if (!SCANNED_HEAD) throw new Error('set SCANNED_HEAD to the head block the interrupted run scanned to');
const BATCH = 20;

const provider = new ethers.providers.StaticJsonRpcProvider({ url: RPC, timeout: 30000 }, CHAIN);
const PAIR = ['function getReserves() view returns (uint112, uint112, uint32)'];

async function withRetry(fn, tries = 4, base = 1500) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) { last = e; if (i < tries - 1) await new Promise((r) => setTimeout(r, base * 2 ** i)); }
  }
  throw last;
}

async function main() {
  let prisma = new PrismaClient();
  const todo = await prisma.dexPair.findMany({
    where: { liquidityEth: 0 },
    select: { pairAddress: true, baseIsToken0: true, baseDecimals: true },
  });
  console.log(`pairs still unpriced: ${todo.length}`);
  let statted = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH);
    const reserves = await Promise.all(
      chunk.map((p) => withRetry(() => new ethers.Contract(p.pairAddress, PAIR, provider).getReserves(), 2).catch(() => null))
    );
    // fresh client every few hundred updates — outlive the pooler's per-
    // connection lifetime instead of dying with it
    if (i > 0 && i % 400 === 0) {
      await prisma.$disconnect().catch(() => {});
      prisma = new PrismaClient();
    }
    for (let j = 0; j < chunk.length; j++) {
      const r = reserves[j];
      if (!r) continue;
      const p = chunk[j];
      const baseRes = Number(ethers.utils.formatUnits(p.baseIsToken0 ? r[0] : r[1], p.baseDecimals));
      const wethRes = Number(ethers.utils.formatEther(p.baseIsToken0 ? r[1] : r[0]));
      if (wethRes === 0) continue; // genuinely empty pool — 0 is its true state
      await withRetry(() =>
        prisma.dexPair.update({
          where: { pairAddress: p.pairAddress },
          data: { liquidityEth: wethRes, priceEth: baseRes > 0 ? (wethRes / baseRes) * 1e6 : 0 },
        })
      );
      statted++;
    }
    if (i % (BATCH * 10) === 0) console.log(`…reserves ${i}/${todo.length}`);
  }
  console.log(`priced ${statted} more pair(s)`);
  await prisma.$executeRaw`
    INSERT INTO "DexIndexState" (key, cursor) VALUES ('pair-discovery', ${SCANNED_HEAD})
    ON CONFLICT (key) DO UPDATE SET cursor = GREATEST("DexIndexState".cursor, ${SCANNED_HEAD})`;
  console.log(`cursor -> ${SCANNED_HEAD}. done.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('finish-backfill failed:', e);
  process.exit(1);
});
