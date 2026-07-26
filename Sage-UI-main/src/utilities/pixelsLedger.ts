import { ethers } from 'ethers';
import prisma from '@/prisma/client';
import {
  RATE_SCALED as SHARED_RATE_SCALED,
  RATE_DIVISOR as SHARED_RATE_DIVISOR,
  CAP_SAGE as SHARED_CAP_SAGE,
  LEGACY_PIXEL_RATIO as SHARED_LEGACY_RATIO,
} from '@/constants/pixels';
import {
  parameters,
  PIXELS_TOKEN_ADDRESS,
  PIXELS_LEGACY_TOKEN_ADDRESS,
  PIXELS_MIGRATION_ENDS_AT,
  TRADE_RPC_URL,
  TRADE_CHAIN_ID,
} from '@/constants/config';

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

// Pixel economics live in constants/pixels.ts so the UI can read the SAME
// numbers — the profile page previously hardcoded its own copy and would have
// shown a rate 250x too high after the repricing. BigInt here because accrual
// is exact integer maths; the shared module is plain numbers for display.
//
//   25,000,000 whole tokens -> 25,000 pixels/day  (the cap)
//   rate = 25 / 25000 = 0.001 pixels per whole token per day
//
// At spot, maxing a wallet costs ~$5.88 against $1.07 on the old token, so a
// sybil is ~5.5x dearer to run. Above supply parity (10,000,000, ~$2.35):
// 25M of a 100bn supply is 0.025% per wallet.
export const RATE_SCALED = BigInt(SHARED_RATE_SCALED);
export const RATE_DIVISOR = BigInt(SHARED_RATE_DIVISOR);
export const CAP_SAGE = BigInt(SHARED_CAP_SAGE);
const DAY = BigInt(86400);

export function pixelsSource(): 'chain' | 'db' {
  return process.env.PIXELS_SOURCE === 'db' ? 'db' : 'chain';
}

/**
 * PINNED to the pixels chain, exactly like PIXELS_TOKEN_ADDRESS — and for the
 * same reason.
 *
 * This used to read `parameters.RPC_URL`, which resolves per BUILD: testnet on
 * a localhost or staging build. The token address is pinned to mainnet, so the
 * pair asked a testnet node for the balance of a mainnet token and got 0 back
 * for every wallet — accrual that "works", reports no error, and pays nobody.
 * Pinning one half of a (chain, address) pair is the same bug as pinning
 * neither; they have to travel together.
 */
function ledgerProvider() {
  return new ethers.providers.StaticJsonRpcProvider(
    { url: TRADE_RPC_URL, timeout: 30000 },
    TRADE_CHAIN_ID
  );
}

/**
 * One OLD token buys as many pixels as 250 NEW ones: the old pair was
 * 0.25 px/token/day capped at 100,000, the new is 0.001 capped at 25,000,000.
 * 100,000 x 250 lands exactly on the new cap, so a legacy holder's ceiling is
 * unchanged — the conversion is a re-denomination, not a re-rate.
 */
export const LEGACY_PIXEL_RATIO = BigInt(SHARED_LEGACY_RATIO);

export function migrationWindowOpen(now: Date = new Date()): boolean {
  return now < PIXELS_MIGRATION_ENDS_AT;
}

const BALANCE_ABI = ['function balanceOf(address) view returns (uint256)'];

async function wholeBalance(token: string, address: string): Promise<bigint> {
  const c = new ethers.Contract(token, BALANCE_ABI, ledgerProvider());
  const bal = await c.balanceOf(address);
  return BigInt(bal.div(ethers.constants.WeiPerEther).toString());
}

/**
 * The wallet's accrual balance, in NEW-token units.
 *
 * While the migration window is open both tokens are read and the BETTER of
 * the two is credited — never the sum. That is the whole reason a dual window
 * is safe here: the requirement was that nobody earns from two tokens at once,
 * and a max() cannot pay twice however the balances are arranged. Holding both
 * earns exactly what holding the larger one alone would.
 *
 * Once the window closes the legacy balance stops counting entirely, and the
 * only accrual input in the codebase is the new token again.
 */
async function oneWalletWhole(address: string): Promise<bigint> {
  const fresh = await wholeBalance(PIXELS_TOKEN_ADDRESS, address);
  if (!migrationWindowOpen()) return fresh;
  // a legacy read failing must never zero a live balance
  const legacy = await wholeBalance(PIXELS_LEGACY_TOKEN_ADDRESS, address).catch(() => BigInt(0));
  const legacyEquivalent = legacy * LEGACY_PIXEL_RATIO;
  return legacyEquivalent > fresh ? legacyEquivalent : fresh;
}

/**
 * Accrual balance for an ACCOUNT — its sign-in wallet plus any verified
 * LinkedWallet.
 *
 * Holdings moved into embedded/custodial wallets (Privy, via bankrbot) that
 * the holder controls but does not sign in with, so a balance read against the
 * sign-in wallet alone returned zero and those holders earned nothing.
 *
 * SUMMED across wallets, and the CAP is applied to the total downstream — the
 * per-wallet max() above resolves the two TOKENS, this resolves the two
 * WALLETS, and they are different questions. Summing is only safe because the
 * cap lands on the sum: splitting a holding across wallets earns exactly what
 * holding it in one does.
 *
 * A linked-wallet lookup failure degrades to the sign-in wallet rather than
 * throwing — the sweep must not stall the whole book over one row.
 */
async function liveSageWhole(address: string): Promise<bigint> {
  /**
   * A wallet that is linked INTO another account earns NOTHING on its own.
   *
   * Its balance now belongs to the account it feeds, so leaving it accruing
   * here too pays the same tokens twice. That was live and trivially
   * exploitable: sign in as a throwaway, link a 25,000,000-token wallet to it
   * with one dust transfer, and the whale keeps earning its capped 25,000/day
   * while the throwaway earns another 25,000/day off the identical balance.
   * The LinkedWallet primary key bounds it to 2x per wallet, but it scales
   * linearly — split across N wallets, link each to its own throwaway, and it
   * is 2x forever. The fabricated stream banks into `settled` with an ordinary
   * kind:'bank' journal row, so after the fact it is indistinguishable from
   * real accrual and immediately spendable.
   *
   * Case-insensitive on purpose: LinkedWallet.address is stored checksummed,
   * while callers pass PixelAccount.walletAddress, and those need not agree on
   * case. An exact match would silently fail open — which is the same as no
   * check at all.
   */
  try {
    const linkedElsewhere = await prisma.linkedWallet.findFirst({
      where: { address: { equals: address, mode: 'insensitive' } },
      select: { walletAddress: true },
    });
    if (
      linkedElsewhere &&
      linkedElsewhere.walletAddress.toLowerCase() !== address.toLowerCase()
    ) {
      return BigInt(0);
    }
  } catch {
    /* a lookup failure must not silently open the double-credit; fall through
       to the normal path, which is the pre-link behaviour */
  }

  let extra: string[] = [];
  try {
    extra = (
      await prisma.linkedWallet.findMany({
        where: { walletAddress: address },
        select: { address: true },
      })
    ).map((r) => r.address);
  } catch {
    /* fall back to the sign-in wallet alone */
  }
  if (!extra.length) return oneWalletWhole(address);

  /**
   * SUM EACH TOKEN ACROSS WALLETS FIRST, THEN max(). Never the other way round.
   *
   * This used to call oneWalletWhole per wallet and sum the results — but that
   * function's max() is what enforces "you cannot earn from both tokens at
   * once", so summing its output made the two tokens mutually exclusive only
   * WITHIN one wallet. Splitting them across two linked wallets doubled the
   * rate: 10,000 new + 40 legacy together read 10,000, but apart read
   * 10,000 + 10,000 = 20,000. At the sweet spot (12.5M new + 50k legacy) that
   * minted +12,500 pixels/day from nothing, for the price of one dust transfer.
   *
   * The cap did not save it — a cap bounds the top end, and the exploit works
   * precisely by walking a holder UP to the cap they were not entitled to.
   *
   * Doing it at the account level restores the invariant the module claims:
   * holding both earns exactly what holding the larger one alone would, no
   * matter how the balances are arranged across an account's wallets.
   */
  const wallets = [address, ...extra];
  const freshes = await Promise.all(
    wallets.map((a) => wholeBalance(PIXELS_TOKEN_ADDRESS, a).catch(() => BigInt(0)))
  );
  const fresh = freshes.reduce((s, v) => s + v, BigInt(0));
  if (!migrationWindowOpen()) return fresh;

  // a legacy read failing must never zero a live balance
  const legacies = await Promise.all(
    wallets.map((a) => wholeBalance(PIXELS_LEGACY_TOKEN_ADDRESS, a).catch(() => BigInt(0)))
  );
  const legacyEquivalent = legacies.reduce((s, v) => s + v, BigInt(0)) * LEGACY_PIXEL_RATIO;
  return legacyEquivalent > fresh ? legacyEquivalent : fresh;
}

/**
 * The contract's pendingStream: held × rate × elapsed / (100 × 86400), where
 * held = min(LIVE balance, checkpoint) — the SUSTAINED balance. A seller
 * stops accruing the moment their balance drops, even before any bank/sync
 * touches them (the contract's flash-farm protection; verified live when the
 * checkpoint-only version over-counted four sold-out wallets by 3k–16k).
 */
const STREAM_UNIT = RATE_DIVISOR * DAY;

/**
 * Pixels earned since lastSync, plus the remainder to carry.
 *
 * The division truncates, and `dbBank` advances lastSync unconditionally — so
 * any interval whose stream floors to zero is DESTROYED, not deferred. The
 * threshold is held >= RATE_DIVISOR * 86400 / (RATE_SCALED * elapsed): at a
 * 10-minute keeper cadence that is 144,000 whole tokens, and a holder below it
 * would earn nothing, forever, while the ledger looked healthy. That floor
 * rises with the divisor, so it is 250x higher than the old token's 576 —
 * without the carry below, most real holders would silently earn zero.
 *
 * Carrying the remainder makes accrual exact at every balance instead: the
 * numerator is preserved across banks and only the whole pixels are paid out.
 */
export function streamWithDust(
  liveWhole: bigint,
  checkpointSage: bigint,
  lastSync: Date,
  nowMs: number,
  dust: bigint
): { stream: bigint; dust: bigint } {
  const from = Math.floor(lastSync.getTime() / 1000);
  const to = Math.floor(nowMs / 1000);
  const elapsed = BigInt(Math.max(0, to - from));
  let held = liveWhole < checkpointSage ? liveWhole : checkpointSage;
  if (held > CAP_SAGE) held = CAP_SAGE;

  /**
   * THE MIGRATION BOUNDARY IS NOT A BALANCE CHANGE, SO IT MUST NOT BE PRICED
   * LIKE ONE.
   *
   * `liveSageWhole` stops reading the legacy token the instant the window
   * closes — gated on wall-clock now, not on the interval being priced. So at
   * 2026-08-08T00:00:00Z a holder whose balance is entirely LEGACY sees their
   * live balance fall from legacy*250 to 0 without moving a single token, and
   * the line above prices the WHOLE unbanked interval at min(0, checkpoint) =
   * 0. Nothing was sold, nothing was transferred, and every second since
   * lastSync pays nothing.
   *
   * That interval is not one sweep. dbBankSweep's healthy branch touches only
   * `updatedAt` — `lastSync` is deliberately left alone — so a passive holder
   * still carries the lastSync from their first post-cutover bank. Nineteen
   * days at the cap is 475,000 pixels, destroyed at one instant, for ~284
   * wallets at once, with no journal row (the bank below only writes one when
   * stream > 0) and checkpointSage overwritten to 0 — unrecoverable from the
   * database afterwards.
   *
   * So the one interval that STRADDLES the boundary is split and each side
   * priced under its own rule: before it, the checkpoint (what the holder was
   * entitled to while legacy counted); after it, the post-boundary balance.
   * Intervals wholly before or wholly after are byte-identical to before this
   * existed, so the flash-farm rule is untouched.
   *
   * Note this is the ONE case the staged accrual plan does not catch: both
   * "a balance drop ends the interval" and the Transfer indexer key on an
   * ERC-20 Transfer, and no transfer is emitted here. It is a RULE change, not
   * a balance change.
   */
  const boundary = Math.floor(PIXELS_MIGRATION_ENDS_AT.getTime() / 1000);
  let numerator: bigint;
  if (from < boundary && to >= boundary) {
    const cp = checkpointSage > CAP_SAGE ? CAP_SAGE : checkpointSage;
    numerator =
      (cp * BigInt(boundary - from) + held * BigInt(to - boundary)) * RATE_SCALED + dust;
  } else {
    numerator = held * RATE_SCALED * elapsed + dust;
  }
  return { stream: numerator / STREAM_UNIT, dust: numerator % STREAM_UNIT };
}

/** Read-only view of the same stream. */
function streamOf(liveWhole: bigint, checkpointSage: bigint, lastSync: Date, nowMs: number, dust: bigint = BigInt(0)): bigint {
  return streamWithDust(liveWhole, checkpointSage, lastSync, nowMs, dust).stream;
}

export async function dbPointsOf(address: string): Promise<bigint> {
  const acct = await prisma.pixelAccount.findUnique({ where: { walletAddress: address } });
  if (!acct) return BigInt(0);
  const live = await liveSageWhole(address).catch(() => acct.checkpointSage);
  return (
    acct.settled +
    streamOf(live, acct.checkpointSage, acct.lastSync, Date.now(), acct.streamDust ?? BigInt(0))
  );
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
  return (held * RATE_SCALED) / RATE_DIVISOR;
}

/**
 * The keeper primitive: bank the stream, then re-checkpoint at the observed
 * live balance — the DB twin of what a seedSettled/sync pair does on-chain.
 */
export async function dbBank(address: string, liveWhole: bigint): Promise<void> {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    /**
     * LOCK FIRST, AND NEVER WRITE `settled` AS A LITERAL.
     *
     * This used to open the transaction with a plain findUnique and then write
     * `settled: acct.settled + stream` — a value computed in JS. Prisma emits
     * that as `SET "settled" = $n`, a bound literal, not `settled = settled + n`.
     * At READ COMMITTED (the default; no isolationLevel is set) a plain SELECT
     * neither takes nor waits on a row lock, so dbTransferPixels' own
     * SELECT..FOR UPDATE did not exclude this one: a spend could commit between
     * the read here and the write here, and the stale literal then overwrote it.
     * The spend's journal row survives, so `settled` silently disagrees with
     * the journal and the pixels are back.
     *
     * Both sides of a collect can be one person's wallets, so a failed attempt
     * costs nothing and can be retried indefinitely — which is what made this
     * critical rather than a rare accident. Reachable from the sweep, which the
     * unauthenticated SyncPixelBank poke can run concurrently with itself.
     *
     * The FOR UPDATE is still needed even with `increment`: the stream is
     * computed from checkpointSage/lastSync/streamDust, and those three must be
     * a consistent snapshot of the row being updated. The RPC read stays
     * OUTSIDE the transaction (the caller passes liveWhole), as dbTransferPixels
     * already arranges, so no network round-trip happens while a row is locked.
     */
    await tx.$queryRaw`
      SELECT "walletAddress" FROM "PixelAccount"
      WHERE "walletAddress" = ${address}
      FOR UPDATE`;
    const acct = await tx.pixelAccount.findUnique({ where: { walletAddress: address } });
    const carried = acct
      ? streamWithDust(liveWhole, acct.checkpointSage, acct.lastSync, now.getTime(), acct.streamDust ?? BigInt(0))
      : { stream: BigInt(0), dust: BigInt(0) };
    const stream = carried.stream;
    await tx.pixelAccount.upsert({
      where: { walletAddress: address },
      create: { walletAddress: address, settled: BigInt(0), checkpointSage: liveWhole, lastSync: now },
      update: {
        // `increment` so the write is a read-modify-write IN THE DATABASE. It
        // also fixes the create-branch race: FOR UPDATE cannot lock a row that
        // does not exist, so a row inserted concurrently lands in the ON
        // CONFLICT branch — which under the old literal clamped it to 0 + 0,
        // destroying whatever the other transaction had just credited.
        settled: { increment: stream },
        checkpointSage: liveWhole,
        lastSync: now,
        // preserved, so a sub-threshold interval is deferred rather than lost
        streamDust: carried.dust,
      },
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
  // live balances for the sustained-stream rule — fetched BEFORE the DB tx so
  // no RPC round-trip happens while rows are locked
  const [liveFrom, liveTo] = await Promise.all([
    liveSageWhole(from).catch(() => BigInt(0)),
    liveSageWhole(to).catch(() => BigInt(0)),
  ]);
  const journalId = await prisma.$transaction(async (tx) => {
    // row locks so two concurrent spends can't both pass the balance check
    await tx.$queryRaw`
      SELECT "walletAddress" FROM "PixelAccount"
      WHERE "walletAddress" IN (${from}, ${to})
      FOR UPDATE`;
    const acctFrom = await tx.pixelAccount.findUnique({ where: { walletAddress: from } });
    // streamWithDust, not streamOf: banking here ADVANCES lastSync, so it
    // closes the interval — and a close that does not consume and re-carry the
    // remainder throws away every sub-pixel of it. The balance check is also
    // fractionally more correct for it.
    const carriedFrom = acctFrom
      ? streamWithDust(liveFrom, acctFrom.checkpointSage, acctFrom.lastSync, now.getTime(), acctFrom.streamDust ?? BigInt(0))
      : { stream: BigInt(0), dust: BigInt(0) };
    const banked = (acctFrom?.settled ?? BigInt(0)) + carriedFrom.stream;
    if (banked < amount) throw new Error('insufficient pixels');
    await tx.pixelAccount.upsert({
      where: { walletAddress: from },
      create: { walletAddress: from, settled: BigInt(0) - amount, checkpointSage: BigInt(0), lastSync: now },
      // increment rather than a literal, matching dbBank — the row is locked
      // above, but a literal would still clobber a row created concurrently
      update: {
        settled: { increment: carriedFrom.stream - amount },
        lastSync: now,
        streamDust: carriedFrom.dust,
      },
    });
    // `settled` moves by stream - amount, so the journal needs BOTH halves or
    // it cannot reconstruct the balance it is the record of.
    if (carriedFrom.stream > BigInt(0)) {
      await tx.pixelJournal.create({
        data: { walletAddress: from, delta: carriedFrom.stream, kind: 'bank', reason: 'accrual banked before spend' },
      });
    }
    const spend = await tx.pixelJournal.create({
      data: { walletAddress: from, delta: BigInt(0) - amount, kind: 'spend', reason },
    });
    if (to.toLowerCase() !== from.toLowerCase()) {
      const acctTo = await tx.pixelAccount.findUnique({ where: { walletAddress: to } });
      const carriedTo = acctTo
        ? streamWithDust(liveTo, acctTo.checkpointSage, acctTo.lastSync, now.getTime(), acctTo.streamDust ?? BigInt(0))
        : { stream: BigInt(0), dust: BigInt(0) };
      await tx.pixelAccount.upsert({
        where: { walletAddress: to },
        create: { walletAddress: to, settled: amount, checkpointSage: BigInt(0), lastSync: now },
        update: {
          settled: { increment: carriedTo.stream + amount },
          lastSync: now,
          streamDust: carriedTo.dust,
        },
      });
      if (carriedTo.stream > BigInt(0)) {
        await tx.pixelJournal.create({
          data: { walletAddress: to, delta: carriedTo.stream, kind: 'bank', reason: 'accrual banked before credit' },
        });
      }
    } else {
      // self-transfer nets to zero: put the debit back. Under increment
      // semantics that is +amount, undoing the -amount above and leaving the
      // banked stream — the same end state the literal wrote.
      await tx.pixelAccount.update({
        where: { walletAddress: from },
        data: { settled: { increment: amount } },
      });
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
  const live = await liveSageWhole(to).catch(() => BigInt(0));
  const journalId = await prisma.$transaction(async (tx) => {
    // Same lock + increment as dbBank, and for the same reason — this path had
    // neither. See the note there.
    await tx.$queryRaw`
      SELECT "walletAddress" FROM "PixelAccount"
      WHERE "walletAddress" = ${to}
      FOR UPDATE`;
    const acct = await tx.pixelAccount.findUnique({ where: { walletAddress: to } });
    // Banking the stream CLOSES the interval (lastSync moves), so it must
    // consume and re-carry the dust like dbBank does. Calling streamOf with no
    // dust left the remainder stranded against an interval that had already
    // been paid for.
    const carried = acct
      ? streamWithDust(live, acct.checkpointSage, acct.lastSync, now.getTime(), acct.streamDust ?? BigInt(0))
      : { stream: BigInt(0), dust: BigInt(0) };
    await tx.pixelAccount.upsert({
      where: { walletAddress: to },
      create: { walletAddress: to, settled: amount, checkpointSage: BigInt(0), lastSync: now },
      update: { settled: { increment: carried.stream + amount }, lastSync: now, streamDust: carried.dust },
    });
    // The banked accrual gets its OWN row. Without it `settled` moved by
    // stream + amount while the journal recorded only amount, so the journal
    // could not reconstruct the balance it is supposed to be the record of.
    if (carried.stream > BigInt(0)) {
      await tx.pixelJournal.create({
        data: { walletAddress: to, delta: carried.stream, kind: 'bank', reason: 'accrual banked before credit' },
      });
    }
    const row = await tx.pixelJournal.create({
      data: { walletAddress: to, delta: amount, kind: 'credit', reason },
    });
    return row.id;
  });
  return `db:${journalId}`;
}

/**
 * The whole pixels leaderboard from ONE SQL read — no RPC. Uses each
 * account's checkpoint as the live-balance proxy: the bank sweep
 * re-checkpoints within ~10min of any balance change, so a freshly-traded
 * wallet's row is off by at most minutes of accrual until the next sweep —
 * invisible at leaderboard granularity, and worth it: the per-wallet
 * RPC version pinned cold instances for 30-60s.
 */
export async function dbLeaderboardRows(): Promise<
  { address: string; net: bigint; rate: bigint }[]
> {
  const accounts = await prisma.pixelAccount.findMany();
  const now = Date.now();
  const rows = accounts.map((a) => {
    let held = a.checkpointSage > CAP_SAGE ? CAP_SAGE : a.checkpointSage;
    return {
      address: a.walletAddress,
      net:
        a.settled +
        streamOf(a.checkpointSage, a.checkpointSage, a.lastSync, now, a.streamDust ?? BigInt(0)),
      rate: (held * RATE_SCALED) / RATE_DIVISOR,
    };
  });
  rows.sort((a, b) => (b.net > a.net ? 1 : b.net < a.net ? -1 : 0));
  return rows;
}

/**
 * Bounded drift sweep — the DB keeper. Checks the stalest N accounts plus
 * anyone who traded SAGE in the last two hours, banks every wallet whose live
 * balance moved off its checkpoint. Free (view calls + DB writes). Poked by
 * the same 10-min cron that used to run the gas-costing keeper; each call
 * covers 200 wallets, so the full book cycles in ~40 minutes and active
 * wallets (recent traders) are caught on every single call.
 */
/**
 * Re-checkpoint ONE wallet immediately, from its current effective balance.
 *
 * Linking a wallet changes what liveSageWhole returns, but nothing re-reads it
 * until a sweep happens to pick that account — and the sweep takes the STALEST
 * accounts first, so a wallet synced recently is at the back of a 482-account
 * queue and may wait days. The first real link on production hit exactly that:
 * the row was correct, the balance was there, and the account still earned
 * nothing because its checkpoint stayed at 0.
 *
 * Cheap (one balance read per linked wallet, one write), so the link path can
 * simply call it and the user sees their rate move immediately.
 */
export async function dbResync(address: string): Promise<bigint> {
  const live = await liveSageWhole(address);
  await dbBank(address, live);
  return live;
}

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
        // Healthy — but updatedAt MUST still move, because the batch above is
        // "the 200 stalest by updatedAt". This used to pass `data: {}`, and
        // Prisma does not apply @updatedAt to an empty update: the timestamp
        // never moved, so every call re-picked the same 200 accounts and the
        // book never rotated. Four consecutive sweeps returning an identical
        // {checked:201, banked:49} on production is what that looks like —
        // wallets outside the first batch were never swept at all, some for
        // six days. Set it explicitly rather than relying on the attribute.
        await prisma.pixelAccount.update({
          where: { walletAddress: known.walletAddress },
          data: { updatedAt: new Date() },
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
