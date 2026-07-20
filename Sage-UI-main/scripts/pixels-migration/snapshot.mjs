/**
 * Pixels migration — Phase 0 snapshot.
 *
 * Copies every known wallet's on-chain SagePoints v3 state (settled,
 * checkpointSage, lastSync) VERBATIM into PixelAccount, so the DB ledger's
 * streaming math (identical to the contract's) continues seamlessly from the
 * same state. Idempotent: re-running refreshes accounts from current chain
 * state; the PixelJournal gets a 'snapshot' row only when a wallet's banked
 * balance actually changed since the last run.
 *
 * Candidates = distinct SAGE traders (trade ledger) ∪ transfer recipients
 * (SocialTokenTransferee) — the same universe the holders list uses. Wallets
 * with zero on-chain state (never synced, nothing banked) are skipped; the
 * DB keeper will create their rows the first time it banks them, exactly as
 * seedSettled would have.
 *
 * Run from Sage-UI-main with DATABASE_CONNECTION_POOL_URL pointed at prod:
 *   node scripts/pixels-migration/snapshot.mjs
 */
import { PrismaClient } from '@prisma/client';
import { ethers } from 'ethers';

const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const SAGE = '0x14561006002e8f76E68EC69e6A32527730bb73c8';
const POINTS_V3 = '0x78cBa250326a19891f67581e2bD8e0D1A11Eb07e';
const BATCH = 20;

const prisma = new PrismaClient();
const provider = new ethers.providers.StaticJsonRpcProvider({ url: RPC, timeout: 30000 }, 4663);
const sp = new ethers.Contract(
  POINTS_V3,
  [
    'function settled(address) view returns (uint256)',
    'function checkpointSage(address) view returns (uint256)',
    'function lastSync(address) view returns (uint256)',
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

async function main() {
  const block = await provider.getBlockNumber();
  const eco = await sp.economics();
  console.log(
    `snapshot @ block ${block} — economics: rateScaled=${eco.rateScaled} capSage=${eco.capSage}`
  );

  const [traders, transferees] = await Promise.all([
    prisma.socialTokenTrade.findMany({
      where: { tokenAddress: SAGE },
      select: { trader: true },
      distinct: ['trader'],
    }),
    prisma.socialTokenTransferee.findMany({
      where: { tokenAddress: SAGE },
      select: { address: true },
    }),
  ]);
  const byLc = new Map();
  for (const a of [...traders.map((t) => t.trader), ...transferees.map((t) => t.address)]) {
    if (!byLc.has(a.toLowerCase())) byLc.set(a.toLowerCase(), ethers.utils.getAddress(a));
  }
  const wallets = Array.from(byLc.values());
  console.log(`${wallets.length} candidate wallet(s)`);

  let written = 0;
  let skipped = 0;
  let journaled = 0;
  for (let i = 0; i < wallets.length; i += BATCH) {
    const chunk = wallets.slice(i, i + BATCH);
    const states = await Promise.all(
      chunk.map((a) =>
        withRetry(async () => ({
          a,
          settled: await sp.settled(a),
          cp: await sp.checkpointSage(a),
          last: await sp.lastSync(a),
        }))
      )
    );
    for (const s of states) {
      if (s.settled.isZero() && s.cp.isZero() && s.last.isZero()) {
        skipped++;
        continue;
      }
      const settled = BigInt(s.settled.toString());
      const prev = await prisma.pixelAccount.findUnique({ where: { walletAddress: s.a } });
      await prisma.pixelAccount.upsert({
        where: { walletAddress: s.a },
        create: {
          walletAddress: s.a,
          settled,
          checkpointSage: BigInt(s.cp.toString()),
          lastSync: new Date(s.last.toNumber() * 1000),
        },
        update: {
          settled,
          checkpointSage: BigInt(s.cp.toString()),
          lastSync: new Date(s.last.toNumber() * 1000),
        },
      });
      if (!prev || prev.settled !== settled) {
        await prisma.pixelJournal.create({
          data: {
            walletAddress: s.a,
            delta: settled - (prev?.settled ?? 0n),
            kind: 'snapshot',
            reason: `chain snapshot @ block ${block}`,
          },
        });
        journaled++;
      }
      written++;
    }
    if ((i / BATCH) % 10 === 0) console.log(`…${Math.min(i + BATCH, wallets.length)}/${wallets.length}`);
  }
  console.log(
    `done: ${written} account(s) written, ${journaled} journal row(s), ${skipped} zero-state wallet(s) skipped`
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('snapshot failed:', e.message);
  process.exit(1);
});
