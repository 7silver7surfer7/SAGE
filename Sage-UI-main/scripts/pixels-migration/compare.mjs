/**
 * Pixels migration — shadow comparison.
 *
 * For every PixelAccount row, computes what the DB ledger says the wallet's
 * points are RIGHT NOW (settled + streaming accrual since lastSync, identical
 * math to the contract's pendingStream) and compares it against the live
 * on-chain pointsOf(). This is the cutover gate: reads must not flip to the
 * DB until this reports zero material mismatches.
 *
 * Expected drift sources while the chain keeper still runs: a wallet that
 * traded after the last snapshot (chain checkpoint moved, DB's didn't).
 * Re-run snapshot.mjs to converge, then compare again.
 *
 *   node scripts/pixels-migration/compare.mjs
 */
import { PrismaClient } from '@prisma/client';
import { ethers } from 'ethers';

const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const POINTS_V3 = '0x78cBa250326a19891f67581e2bD8e0D1A11Eb07e';
const SAGE = '0x14561006002e8f76E68EC69e6A32527730bb73c8';
const BATCH = 20;
const TOLERANCE = 2n; // whole pixels; sub-pixel timing skew between the two reads

const prisma = new PrismaClient();
const provider = new ethers.providers.StaticJsonRpcProvider({ url: RPC, timeout: 30000 }, 4663);
const sp = new ethers.Contract(
  POINTS_V3,
  [
    'function pointsOf(address) view returns (uint256)',
    'function economics() view returns (uint256 rateScaled, uint256 capSage, bool transferable)',
  ],
  provider
);

async function withRetry(fn, tries = 4, baseDelayMs = 1500) {
  let lastErr;
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

/**
 * The contract's pendingStream, in BigInt: held × rateScaled × elapsed /
 * (100 × 86400), where held = min(LIVE balance, checkpoint) — the SUSTAINED
 * balance, so sellers stop accruing instantly even before any sync.
 */
function dbPointsOf(acct, liveWhole, nowSec, rateScaled, capSage) {
  const elapsed = BigInt(Math.max(0, nowSec - Math.floor(acct.lastSync.getTime() / 1000)));
  let held = liveWhole < acct.checkpointSage ? liveWhole : acct.checkpointSage;
  if (held > capSage) held = capSage;
  return acct.settled + (held * rateScaled * elapsed) / (100n * 86400n);
}

async function main() {
  const eco = await sp.economics();
  const rateScaled = BigInt(eco.rateScaled.toString());
  const capSage = BigInt(eco.capSage.toString());
  const accounts = await prisma.pixelAccount.findMany();
  console.log(`comparing ${accounts.length} account(s) — tolerance ±${TOLERANCE} pixel(s)`);

  let ok = 0;
  const bad = [];
  const sage = new ethers.Contract(
    SAGE,
    ['function balanceOf(address) view returns (uint256)'],
    provider
  );
  for (let i = 0; i < accounts.length; i += BATCH) {
    const chunk = accounts.slice(i, i + BATCH);
    const nowSec = Math.floor(Date.now() / 1000);
    const [chainVals, liveBals] = await Promise.all([
      Promise.all(chunk.map((a) => withRetry(() => sp.pointsOf(a.walletAddress)))),
      Promise.all(chunk.map((a) => withRetry(() => sage.balanceOf(a.walletAddress)))),
    ]);
    chunk.forEach((a, j) => {
      const live = BigInt(liveBals[j].div(ethers.constants.WeiPerEther).toString());
      const db = dbPointsOf(a, live, nowSec, rateScaled, capSage);
      const chain = BigInt(chainVals[j].toString());
      const diff = db > chain ? db - chain : chain - db;
      if (diff <= TOLERANCE) ok++;
      else bad.push({ a: a.walletAddress, db, chain, diff });
    });
  }
  bad.sort((x, y) => (y.diff > x.diff ? 1 : -1));
  console.log(`in sync: ${ok}/${accounts.length}`);
  if (bad.length) {
    console.log(`MISMATCHED: ${bad.length}`);
    for (const b of bad.slice(0, 25)) {
      console.log(`  ${b.a.slice(0, 12)} db=${b.db} chain=${b.chain} (Δ${b.diff})`);
    }
    if (bad.length > 25) console.log(`  … and ${bad.length - 25} more`);
    process.exitCode = 1;
  } else {
    console.log('DB ledger matches the chain — cutover gate PASSES.');
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('compare failed:', e.message);
  process.exit(1);
});
