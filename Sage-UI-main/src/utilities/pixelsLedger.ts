import { ethers } from 'ethers';
import prisma from '@/prisma/client';
import { parameters } from '@/constants/config';

/**
 * Off-chain pixels ledger — the zero-gas successor to on-chain SagePoints.
 *
 * Mirrors the v3 contract's design exactly: a wallet's points are
 * settled + min(checkpointSage, CAP) × RATE × elapsed-since-lastSync, so pure
 * accrual costs NOTHING (computed at read time), and the keeper's job — bank
 * the stream and re-checkpoint when a balance changes — is a free DB write
 * instead of a gas-costing seedSettled tx.
 *
 * PIXELS_SOURCE=db flips serverWallet's four pixels functions here; the
 * default ('chain') leaves the contract authoritative and these tables
 * shadow-only. scripts/pixels-migration/snapshot.mjs seeds PixelAccount from
 * the exact on-chain state, and compare.mjs is the cutover gate.
 *
 * Server-only (imports prisma) — never import from client code.
 */

// SagePoints v3 economics, verified against economics() at snapshot time.
// If setEconomics is ever called pre-cutover, re-snapshot and update these.
export const RATE_SCALED = BigInt(25); // 0.25%/day
export const CAP_SAGE = BigInt(100000);
const DAY = BigInt(86400);
const HUNDRED = BigInt(100);

export function pixelsSource(): 'chain' | 'db' {
  return process.env.PIXELS_SOURCE === 'db' ? 'db' : 'chain';
}

function ledgerProvider() {
  return new ethers.providers.StaticJsonRpcProvider({ url: parameters.RPC_URL, timeout: 30000 });
}

/** Live whole-SAGE balance — a free view call; the only RPC the db mode makes. */
async function liveSageWhole(address: string): Promise<bigint> {
  const c = new ethers.Contract(
    parameters.ASHTOKEN_ADDRESS,
    ['function balanceOf(address) view returns (uint256)'],
    ledgerProvider()
  );
  const bal = await c.balanceOf(address);
  return BigInt(bal.div(ethers.constants.WeiPerEther).toString());
}

/** The contract's pendingStream: held × rate × elapsed / (100 × 86400). */
function streamOf(checkpointSage: bigint, lastSync: Date, nowMs: number): bigint {
  const elapsed = BigInt(Math.max(0, Math.floor(nowMs / 1000) - Math.floor(lastSync.getTime() / 1000)));
  const held = checkpointSage > CAP_SAGE ? CAP_SAGE : checkpointSage;
  return (held * RATE_SCALED * elapsed) / (HUNDRED * DAY);
}

export async function dbPointsOf(address: string): Promise<bigint> {
  const acct = await prisma.pixelAccount.findUnique({ where: { walletAddress: address } });
  if (!acct) return BigInt(0);
  return acct.settled + streamOf(acct.checkpointSage, acct.lastSync, Date.now());
}

export async function dbDailyRate(address: string): Promise<bigint> {
  const [acct, live] = await Promise.all([
    prisma.pixelAccount.findUnique({ where: { walletAddress: address } }),
    liveSageWhole(address).catch(() => BigInt(0)),
  ]);
  // contract semantics: before a first sync there's no checkpoint — preview
  // the live balance; after, the sustained-since-checkpoint balance rules
  const cp = acct?.checkpointSage ?? BigInt(0);
  let held = cp === BigInt(0) ? live : live < cp ? live : cp;
  if (held > CAP_SAGE) held = CAP_SAGE;
  return (held * RATE_SCALED) / HUNDRED;
}

/**
 * The keeper primitive: bank the stream, then re-checkpoint at the observed
 * live balance — the DB twin of what a seedSettled/sync pair does on-chain.
 */
export async function dbBank(address: string, liveWhole: bigint): Promise<void> {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const acct = await tx.pixelAccount.findUnique({ where: { walletAddress: address } });
    const stream = acct ? streamOf(acct.checkpointSage, acct.lastSync, now.getTime()) : BigInt(0);
    await tx.pixelAccount.upsert({
      where: { walletAddress: address },
      create: { walletAddress: address, settled: BigInt(0), checkpointSage: liveWhole, lastSync: now },
      update: { settled: (acct?.settled ?? BigInt(0)) + stream, checkpointSage: liveWhole, lastSync: now },
    });
    if (stream > BigInt(0)) {
      await tx.pixelJournal.create({
        data: { walletAddress: address, delta: stream, kind: 'bank', reason: 'accrual banked at checkpoint' },
      });
    }
  });
}

/**
 * Buyer pays seller — the collect flow's primitive, one atomic DB tx. Banks
 * both sides' streams first (you can spend what you've streamed, exactly as
 * the contract's _sync-then-spend does), throws 'insufficient pixels' on a
 * short balance so existing callers' error handling keeps working. Handles
 * from === to (self-collect): banks once, verifies balance, nets to zero.
 */
export async function dbTransferPixels(
  from: string,
  to: string,
  amount: bigint,
  reason: string
): Promise<string> {
  const now = new Date();
  const journalId = await prisma.$transaction(async (tx) => {
    // row locks so two concurrent spends can't both pass the balance check
    await tx.$queryRaw`
      SELECT "walletAddress" FROM "PixelAccount"
      WHERE "walletAddress" IN (${from}, ${to})
      FOR UPDATE`;
    const acctFrom = await tx.pixelAccount.findUnique({ where: { walletAddress: from } });
    const banked =
      (acctFrom?.settled ?? BigInt(0)) +
      (acctFrom ? streamOf(acctFrom.checkpointSage, acctFrom.lastSync, now.getTime()) : BigInt(0));
    if (banked < amount) throw new Error('insufficient pixels');
    await tx.pixelAccount.upsert({
      where: { walletAddress: from },
      create: { walletAddress: from, settled: BigInt(0) - amount, checkpointSage: BigInt(0), lastSync: now },
      update: { settled: banked - amount, lastSync: now },
    });
    const spend = await tx.pixelJournal.create({
      data: { walletAddress: from, delta: BigInt(0) - amount, kind: 'spend', reason },
    });
    if (to.toLowerCase() !== from.toLowerCase()) {
      const acctTo = await tx.pixelAccount.findUnique({ where: { walletAddress: to } });
      const bankedTo =
        (acctTo?.settled ?? BigInt(0)) +
        (acctTo ? streamOf(acctTo.checkpointSage, acctTo.lastSync, now.getTime()) : BigInt(0));
      await tx.pixelAccount.upsert({
        where: { walletAddress: to },
        create: { walletAddress: to, settled: amount, checkpointSage: BigInt(0), lastSync: now },
        update: { settled: bankedTo + amount, lastSync: now },
      });
    } else {
      // self-transfer nets to zero: put the debit back
      await tx.pixelAccount.update({ where: { walletAddress: from }, data: { settled: banked } });
    }
    await tx.pixelJournal.create({
      data: { walletAddress: to, delta: amount, kind: 'credit', reason },
    });
    return spend.id;
  });
  return `db:${journalId}`;
}

/** Credit pixels (seller earnings, promos, refunds) — atomic, banks first. */
export async function dbCreditPixels(to: string, amount: bigint, reason: string): Promise<string> {
  const now = new Date();
  const journalId = await prisma.$transaction(async (tx) => {
    const acct = await tx.pixelAccount.findUnique({ where: { walletAddress: to } });
    const banked =
      (acct?.settled ?? BigInt(0)) +
      (acct ? streamOf(acct.checkpointSage, acct.lastSync, now.getTime()) : BigInt(0));
    await tx.pixelAccount.upsert({
      where: { walletAddress: to },
      create: { walletAddress: to, settled: amount, checkpointSage: BigInt(0), lastSync: now },
      update: { settled: banked + amount, lastSync: now },
    });
    const row = await tx.pixelJournal.create({
      data: { walletAddress: to, delta: amount, kind: 'credit', reason },
    });
    return row.id;
  });
  return `db:${journalId}`;
}

/**
 * Bounded drift sweep — the DB keeper. Checks the stalest N accounts plus
 * anyone who traded SAGE in the last two hours, banks every wallet whose live
 * balance moved off its checkpoint. Free (view calls + DB writes). Poked by
 * the same 10-min cron that used to run the gas-costing keeper; each call
 * covers 200 wallets, so the full book cycles in ~40 minutes and active
 * wallets (recent traders) are caught on every single call.
 */
export async function dbBankSweep(batch = 200): Promise<{ checked: number; banked: number }> {
  const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000);
  const [stale, recent] = await Promise.all([
    prisma.pixelAccount.findMany({
      orderBy: { updatedAt: 'asc' },
      take: batch,
      select: { walletAddress: true, checkpointSage: true },
    }),
    prisma.socialTokenTrade.findMany({
      where: { tokenAddress: parameters.ASHTOKEN_ADDRESS, createdAt: { gt: twoHoursAgo } },
      select: { trader: true },
      distinct: ['trader'],
    }),
  ]);
  const cpByLc = new Map(stale.map((a) => [a.walletAddress.toLowerCase(), a]));
  const byLc = new Map<string, string>();
  for (const a of [...stale.map((s) => s.walletAddress), ...recent.map((r) => r.trader)]) {
    if (!byLc.has(a.toLowerCase())) byLc.set(a.toLowerCase(), a);
  }
  const addresses = Array.from(byLc.values());
  let banked = 0;
  for (let i = 0; i < addresses.length; i += 20) {
    const chunk = addresses.slice(i, i + 20);
    const lives = await Promise.all(chunk.map((a) => liveSageWhole(a).catch(() => null)));
    for (let j = 0; j < chunk.length; j++) {
      const live = lives[j];
      if (live === null) continue; // RPC hiccup — next sweep catches it
      const known = cpByLc.get(chunk[j].toLowerCase());
      if (known && known.checkpointSage === live) {
        // healthy — still touch updatedAt so the stale-first rotation advances
        await prisma.pixelAccount.update({
          where: { walletAddress: known.walletAddress },
          data: {},
        });
        continue;
      }
      if (!known) {
        const acct = await prisma.pixelAccount.findUnique({ where: { walletAddress: chunk[j] } });
        if (acct && acct.checkpointSage === live) continue;
        if (!acct && live === BigInt(0)) continue; // nothing to track
      }
      await dbBank(chunk[j], live);
      banked++;
    }
  }
  return { checked: addresses.length, banked };
}
