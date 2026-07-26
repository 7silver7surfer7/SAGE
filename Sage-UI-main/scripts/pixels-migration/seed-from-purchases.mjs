#!/usr/bin/env node
/**
 * Reconcile every Pixels account against what the chain says it earned.
 *
 * Replays the full ERC-20 Transfer history of BOTH pixel tokens, integrates
 * the accrual each account was actually entitled to, subtracts what the ledger
 * has already credited, and writes the SHORTFALL.
 *
 *   pixels = SUM over intervals of  min(held, CAP) * RATE * seconds
 *                                   ---------------------------------
 *                                        RATE_DIVISOR * 86400
 *
 *   held   = max(newTokens, legacyTokens * 250)   -- per ACCOUNT, per interval
 *
 * Integer maths with a carried remainder, identical to streamWithDust() in
 * utilities/pixelsLedger.ts, so a reconciled wallet and a live-accruing one are
 * computed the same way rather than merely close.
 *
 * WHY REPLAY RATHER THAN ESTIMATE
 * -------------------------------
 * The obvious shortcut — first-purchase date times current balance — pays
 * someone who bought a large bag yesterday as if they had held it since the
 * token launched. That is not a rounding error, it is the difference between a
 * fair backfill and minting pixels for whoever timed their buy last.
 *
 * WHY IT IS ONE RUN AND NOT ONE PER TOKEN
 * ---------------------------------------
 * This used to take --token new | legacy and replay one of them. Two runs
 * cannot produce a MAX: each would credit its own token's accrual on top of
 * the other's, turning the ledger's max(new, legacy*250) into a sum for every
 * wallet that held both. The tokens have to be integrated together, interval
 * by interval, or the invariant is broken by construction.
 *
 * WHY IT PAYS THE SHORTFALL AND NOT THE ENTITLEMENT
 * -------------------------------------------------
 * The live ledger has been banking accrual all along, and one holder had
 * already been swept from 124,328 to 211,826 against a true 250,652. Crediting
 * the integral would have paid them a second time for the part that worked.
 * So the write is `entitlement - alreadyCredited`, floored at zero, and the
 * run is a RECONCILIATION: it repairs the accrual the sustained-balance rule
 * destroyed and is a no-op for an account the ledger got right.
 *
 * SAFE TO RE-RUN. One 'seed:v2' journal row per account is the marker.
 *
 *   node scripts/pixels-migration/seed-from-purchases.mjs                  # dry run
 *   node scripts/pixels-migration/seed-from-purchases.mjs --until <unix>   # reproducible dry run
 *   node scripts/pixels-migration/seed-from-purchases.mjs --until <unix> --commit
 */
import { ethers } from 'ethers';
import { PrismaClient } from '@prisma/client';

// BOTH tokens, always. Neither is optional: the accrual rule compares them.
const TOKEN_NEW = '0xE21a2b120FAcF995bC8bF6b1843f409E568beBA3';
const TOKEN_LEGACY = '0x14561006002e8f76E68EC69e6A32527730bb73c8';
/** One legacy token earns what 250 new ones do. */
const LEGACY_RATIO = 250n;
const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const CHAIN_ID = 4663;
const EXPLORER = 'https://robinhoodchain.blockscout.com';

// must match constants/pixels.ts
const RATE_SCALED = 25n;
const RATE_DIVISOR = 25000n;
const CAP_SAGE = 25000000n;
const DAY = 86400n;
const UNIT = RATE_DIVISOR * DAY;

// This RPC rejects wider eth_getLogs windows; see dexIndexer for the same cap.
const CHUNK = 2000;
const TRANSFER = ethers.utils.id('Transfer(address,address,uint256)');
const WEI = 10n ** 18n;

/**
 * Addresses that are never people. AddressZero is mint/burn; DEAD is where
 * utilities/tip.ts burnSage() sends real tokens, so its balance only ever
 * rises — left in, it accrues continuously and lands at or near the TOP of
 * the printed table, inflating the one number the operator checks before an
 * irreversible write. Committed, it would also mint a PixelAccount row that
 * the public leaderboard would then serve.
 */
const NOBODY = new Set([
  ethers.constants.AddressZero.toLowerCase(),
  '0x000000000000000000000000000000000000dead',
]);

const COMMIT = process.argv.includes('--commit');
const prisma = new PrismaClient();

const addrOf = (topic) => ethers.utils.getAddress('0x' + topic.slice(26));
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};

/**
 * Retry a chain read, and THROW when it will not settle.
 *
 * Every read in this file used to end `.catch(() => …)`, which turned an RPC
 * failure into ordinary-looking data: a dropped getLogs chunk silently deleted
 * 2,000 blocks of history and the run proceeded to the write phase. The
 * asymmetry gave the intent away — getBlock had no catch and aborted loudly,
 * so timestamp failures were fatal while HISTORY HOLES were silent, which is
 * exactly backwards. snapshot.mjs has always wrapped its reads this way.
 */
async function withRetry(label, fn, attempts = 5) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${last?.message || last}`);
}

/**
 * The block a token was deployed in — from its CREATION TRANSACTION, not a
 * getCode binary search.
 *
 * This chain's public RPC is not a full archive node: getCode(addr, oldBlock)
 * answers inconsistently, so a binary search converges on a different wrong
 * block every run. Observed on this exact token — true 18,694,863 against
 * searches returning 18,990,267, 18,696,323 and 18,697,647 on three
 * consecutive attempts. A start block that is too late silently truncates the
 * transfer history and under-credits every holder whose buy predates it; one
 * run of this script began 293,652 blocks late and found 1 wallet instead of 6.
 *
 * Refuses to guess. A seed that quietly pays the wrong people is worse than
 * one that does not run.
 */
async function creationBlock(provider, address) {
  const res = await fetch(`${EXPLORER}/api/v2/addresses/${address}`).catch(() => null);
  const meta = res && res.ok ? await res.json().catch(() => null) : null;
  const hash = meta?.creation_transaction_hash || meta?.creation_tx_hash;
  if (!hash) {
    throw new Error(
      `could not read the deploy block for ${address} from the explorer, and this RPC ` +
        'cannot be binary-searched reliably. Pass --from-block-new / --from-block-legacy.'
    );
  }
  const receipt = await withRetry('creation receipt', () => provider.getTransactionReceipt(hash));
  if (!receipt?.blockNumber) throw new Error(`creation tx ${hash} has no receipt`);
  return receipt.blockNumber;
}

/**
 * Say what is happening, on one rewritten line.
 *
 * This script spends half an hour writing to a live financial ledger and used
 * to print NOTHING between "11,503 transfers" and the final summary. Asked how
 * far along a --commit run was, the only way to answer was to query the
 * database behind it and count journal rows. For an irreversible job that is
 * not a nicety.
 */
const lastPct = new Map();
function progress(label, done, total) {
  const pct = total ? Math.floor((done / total) * 100) : 100;
  const line = `  ${label}: ${done.toLocaleString()}/${total.toLocaleString()} (${pct}%)`;
  if (process.stdout.isTTY) return void process.stdout.write(`\r${line}   `);
  /**
   * Piped/redirected: emit on a PERCENTAGE CHANGE, never on a modulus.
   *
   * The first version of this printed when `done % floor(total/20) === 0`,
   * and the caller only offered it multiples of 100 — so for a 12,240-item
   * phase (step 612) no offered value was ever a multiple of the step and the
   * intermediate lines could not fire at all. A --commit run redirected to a
   * file therefore printed nothing between phases, which is exactly the
   * silence this function was added to remove; worse, I then read that
   * silence as evidence the phase was slow and went looking for a performance
   * problem that was not there.
   */
  const prev = lastPct.get(label) ?? -1;
  if (pct >= prev + 5 || done === total) {
    lastPct.set(label, pct);
    console.log(line);
  }
}

/**
 * Map with bounded concurrency.
 *
 * The chain reads here were strictly sequential: ~12,000 getBlock calls one
 * after another dominated the runtime, at a round-trip each. They are
 * independent point queries, so the only reason to serialise them was that a
 * for-await loop is the easy thing to write. 20 at a time is polite to a
 * public RPC and roughly an order of magnitude faster.
 */
async function mapLimit(items, limit, fn, label) {
  const out = new Array(items.length);
  let next = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i], i);
        done++;
        if (label && done % 10 === 0) progress(label, done, items.length);
      }
    })
  );
  if (label) progress(label, items.length, items.length);
  return out;
}

/** Every Transfer of one token, start..head, with no silent holes. */
async function fetchTransfers(provider, token, start, head) {
  const ranges = [];
  for (let from = start; from <= head; from += CHUNK) {
    ranges.push([from, Math.min(from + CHUNK - 1, head)]);
  }
  // getLogs windows are also independent; the RPC caps the WIDTH of a window,
  // not how many are in flight.
  const batches = await mapLimit(
    ranges,
    20,
    ([from, to]) =>
      withRetry(`getLogs ${token} ${from}-${to}`, () =>
        provider.getLogs({ address: token, topics: [TRANSFER], fromBlock: from, toBlock: to })
      ),
    `scanning ${token.slice(0, 8)}…`
  );
  console.log('');
  return batches.flat();
}

async function main() {
  const provider = new ethers.providers.StaticJsonRpcProvider(RPC, CHAIN_ID);
  const head = await withRetry('getBlockNumber', () => provider.getBlockNumber());

  /**
   * The integration end point. NOT wall-clock now by default on a commit run:
   * the ledger's own in-flight stream covers [lastSync, now) and will be
   * banked by the next sweep, so an unbounded integral overlaps it. The write
   * below stamps lastSync = until precisely so the two meet exactly once.
   *
   * Explicit for a commit so two operators, or a re-run after a failure, get
   * the same answer rather than one that drifts with the clock.
   */
  const untilArg = arg('--until');
  if (COMMIT && !untilArg) {
    throw new Error(
      '--until <unix-seconds> is required for --commit. It is the instant accrual is ' +
        'reconciled to, and it is stamped onto every account as lastSync so the live ' +
        'ledger resumes from exactly there. Without it the answer drifts with the clock ' +
        'and overlaps the stream the next sweep will bank.'
    );
  }
  const until = untilArg ? BigInt(untilArg) : BigInt(Math.floor(Date.now() / 1000));
  if (!Number.isFinite(Number(until)) || until <= 0n) throw new Error('bad --until');
  if (until > BigInt(Math.floor(Date.now() / 1000))) throw new Error('--until is in the future');

  const startNew = arg('--from-block-new')
    ? Number(arg('--from-block-new'))
    : await creationBlock(provider, TOKEN_NEW);
  const startLegacy = arg('--from-block-legacy')
    ? Number(arg('--from-block-legacy'))
    : await creationBlock(provider, TOKEN_LEGACY);
  for (const [label, s] of [
    ['new', startNew],
    ['legacy', startLegacy],
  ]) {
    // A start block AFTER head is not a late start, it is a typo that would
    // replay nothing and report a clean run over zero history.
    if (!Number.isFinite(s) || s <= 0 || s > head) {
      throw new Error(`bad ${label} start block ${s} (head ${head})`);
    }
  }
  console.log(
    `new token from ${startNew.toLocaleString()}, legacy from ${startLegacy.toLocaleString()}, ` +
      `head ${head.toLocaleString()}, until ${new Date(Number(until) * 1000).toISOString()}`
  );

  // ── collect every transfer of both tokens ─────────────────────────────────
  const logsNew = (await fetchTransfers(provider, TOKEN_NEW, startNew, head)).map((l) => ({
    ...l,
    legacy: false,
  }));
  const logsLegacy = (await fetchTransfers(provider, TOKEN_LEGACY, startLegacy, head)).map((l) => ({
    ...l,
    legacy: true,
  }));
  const logs = [...logsNew, ...logsLegacy].sort(
    (a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex
  );
  console.log(`${logsNew.length} new-token transfers, ${logsLegacy.length} legacy transfers`);

  // block timestamps, deduped — the integration is over TIME, not blocks
  const blocks = [...new Set(logs.map((l) => l.blockNumber))];
  const stamps = await mapLimit(
    blocks,
    20,
    (b) => withRetry(`getBlock ${b}`, () => provider.getBlock(b)),
    'block timestamps'
  );
  console.log('');
  const timeOf = new Map(blocks.map((b, i) => [b, BigInt(stamps[i].timestamp)]));

  // ── pass 1: raw per-ADDRESS balances, for the impossibility check ──────────
  //
  // Kept over EVERY address, including contracts, and in WEI. The old check
  // ran over the filtered rows, so the addresses that go most negative when a
  // chunk is dropped — the pool, the router, the token itself — had already
  // been removed before it looked. It also compared whole tokens after a
  // BigInt division that truncates toward zero, so a -0.5-token drift
  // reported as 0n and passed.
  const rawNew = new Map();
  const rawLegacy = new Map();
  const seen = new Set();
  for (const log of logs) {
    const from = addrOf(log.topics[1]);
    const to = addrOf(log.topics[2]);
    const amount = BigInt(log.data);
    const raw = log.legacy ? rawLegacy : rawNew;
    if (from !== ethers.constants.AddressZero) {
      raw.set(from, (raw.get(from) ?? 0n) - amount);
      seen.add(from);
    }
    if (to !== ethers.constants.AddressZero) {
      raw.set(to, (raw.get(to) ?? 0n) + amount);
      seen.add(to);
    }
  }
  const negatives = [];
  for (const [map, label] of [
    [rawNew, 'new'],
    [rawLegacy, 'legacy'],
  ]) {
    for (const [who, wei] of map) if (wei < 0n) negatives.push(`${who} ${label} ${wei} wei`);
  }
  if (negatives.length) {
    console.error(`\n${negatives.length} address(es) ended with a NEGATIVE balance:`);
    negatives.forEach((n) => console.error('  ' + n));
    throw new Error('transfer history is incomplete — refusing to reconcile from it');
  }

  // ── who is a person? getCode every address ONCE, and abort on failure ─────
  //
  // This used to be `.catch(() => null); if (code === null) continue`, which
  // collapsed an RPC error into "skip this address" with no counter and no
  // report: the dropped wallet never appeared in the table and was not in the
  // total, so the operator saw a clean run.
  const isPerson = new Map();
  const everyone = [...seen];
  const codes = await mapLimit(
    everyone,
    20,
    (who) =>
      NOBODY.has(who.toLowerCase())
        ? null
        : withRetry(`getCode ${who}`, () => provider.getCode(who)),
    'classifying addresses'
  );
  console.log('');
  everyone.forEach((who, i) => {
    const code = codes[i];
    if (code === null) return isPerson.set(who, false);
    // EIP-7702 delegated EOAs are exactly 23 bytes of 0xef0100 || implementation
    const delegated = code.toLowerCase().startsWith('0xef0100') && code.length === 2 + 23 * 2;
    isPerson.set(who, code === '0x' || delegated);
  });

  // ── holder -> the ACCOUNT that should be credited ─────────────────────────
  //
  // Resolved BEFORE the replay, not after. The cap has to land on the account
  // total, and capping each holder wallet then summing is not the same number:
  // two linked wallets at 25M each were credited 2 x 25,000/day instead of
  // 25,000/day. That is the inverse of the rule the live ledger enforces
  // (liveSageWhole sums the wallets, streamWithDust caps the sum), and it is
  // exactly the shape that was closed there and left open here.
  const links = await prisma.linkedWallet.findMany({
    select: { address: true, walletAddress: true },
  });
  const ownerOf = new Map(links.map((l) => [l.address.toLowerCase(), l.walletAddress]));
  const accountOf = (holder) => ownerOf.get(holder.toLowerCase()) || holder;

  // ── pass 2: replay per ACCOUNT, integrating max(new, legacy*250) ──────────
  const balNew = new Map();
  const balLegacy = new Map();
  const since = new Map();
  const dust = new Map();
  const earned = new Map();
  const firstSeen = new Map();
  const sources = new Map();

  /** Whole tokens this account effectively holds, in NEW-token units. */
  const effective = (acct) => {
    const fresh = (balNew.get(acct) ?? 0n) / WEI;
    const legacy = ((balLegacy.get(acct) ?? 0n) / WEI) * LEGACY_RATIO;
    return legacy > fresh ? legacy : fresh;
  };

  const accrue = (acct, at) => {
    const from = since.get(acct);
    if (from === undefined || at <= from) return;
    const held = effective(acct);
    if (held > 0n) {
      const capped = held > CAP_SAGE ? CAP_SAGE : held;
      const num = capped * RATE_SCALED * (at - from) + (dust.get(acct) ?? 0n);
      earned.set(acct, (earned.get(acct) ?? 0n) + num / UNIT);
      dust.set(acct, num % UNIT);
    }
    since.set(acct, at);
  };

  for (const log of logs) {
    const ts = timeOf.get(log.blockNumber);
    if (ts > until) break; // sorted: everything after this is out of scope
    const from = addrOf(log.topics[1]);
    const to = addrOf(log.topics[2]);
    // balances are tracked in WEI and truncated to whole tokens only in
    // effective(). Truncating each transfer instead loses the fraction every
    // time and the error compounds with the wrong sign: two receives of 1.5
    // count as 1+1=2 while one send of 3.0 counts as 3, so a wallet that never
    // went short ends the replay at -1 tokens. Observed on 0x505729ec…
    const amount = BigInt(log.data);
    const bal = log.legacy ? balLegacy : balNew;

    for (const holder of [from, to]) {
      if (!isPerson.get(holder)) continue;
      const acct = accountOf(holder);
      accrue(acct, ts);
      if (!since.has(acct)) since.set(acct, ts);
      if (!firstSeen.has(acct)) firstSeen.set(acct, ts);
      if (!sources.has(acct)) sources.set(acct, new Set());
      sources.get(acct).add(holder);
    }
    if (isPerson.get(from)) {
      const a = accountOf(from);
      bal.set(a, (bal.get(a) ?? 0n) - amount);
    }
    if (isPerson.get(to)) {
      const a = accountOf(to);
      bal.set(a, (bal.get(a) ?? 0n) + amount);
    }
  }
  for (const acct of new Set([...balNew.keys(), ...balLegacy.keys()])) accrue(acct, until);

  // ── what has the ledger already credited? ────────────────────────────────
  //
  // The write is the SHORTFALL, so this figure decides the payout and has to
  // be honest about a known gap: before the journal-row fix, spends and
  // credits banked accrual into `settled` WITHOUT writing a row. So the
  // journal alone UNDER-states what was paid, and paying against it would
  // over-credit exactly the accounts that spend most.
  //
  // Every other mutation does journal, so the difference `settled -
  // sum(journal)` IS that un-journalled accrual, and adding it back recovers
  // the true figure. (The same difference also absorbs any balance the
  // read-modify-write race refunded, which errs toward paying less — reported
  // per account below so it is visible rather than assumed.)
  /**
   * REFUSE TO RECONCILE AGAINST A LEDGER THAT ISN'T THERE.
   *
   * The shortfall is `entitlement - alreadyCredited`, and alreadyCredited is
   * read from the database this process happens to be pointed at. Point it at
   * an empty one — a local dev DB, a fresh branch database, a mistyped
   * DATABASE_CONNECTION_POOL_URL — and every account reads as never credited,
   * so the "shortfall" silently becomes the GROSS entitlement and the run pays
   * everyone their entire lifetime accrual on top of what they already hold.
   *
   * This is not hypothetical: the first full dry run of this script did
   * exactly that against localhost and reported 30,793,684 pixels owed across
   * 1,582 accounts, with every single alreadyCredited reading 0. The numbers
   * look completely plausible — there is nothing in the output that says "you
   * are reading the wrong database".
   *
   * A live pixels ledger always has accounts. Zero of them means the
   * connection is wrong, not that nobody has ever earned.
   */
  const ledgerSize = await prisma.pixelAccount.count();
  console.log(`\nledger has ${ledgerSize.toLocaleString()} existing PixelAccount rows`);
  if (ledgerSize === 0) {
    const msg =
      'the connected database has NO PixelAccount rows. Every account would read as ' +
      'never-credited, so the shortfall would silently equal the gross entitlement and ' +
      'this run would pay everyone twice. Check DATABASE_CONNECTION_POOL_URL points at ' +
      'the live ledger.';
    if (COMMIT) throw new Error(msg);
    console.warn(`\nWARNING: ${msg}\nThe SHORTFALL column below is meaningless — it is the gross entitlement.`);
  }

  const accounts = [...earned.keys()].filter((a) => (earned.get(a) ?? 0n) > 0n);
  /**
   * FOUR, AND THE TWO READS INSIDE ARE SEQUENTIAL. Count connections, not
   * workers.
   *
   * This was 8 workers each doing its two reads in a Promise.all — 16
   * simultaneous connections against a pool whose size is 15. It failed
   * exactly as the previous comment on this line warned it might:
   * "EMAXCONNSESSION: max clients reached in session mode - max clients are
   * limited to pool_size: 15". Writing the hazard down is not the same as
   * doing the arithmetic.
   *
   * Worse than a failed script: this pool is SHARED WITH THE LIVE SITE, so an
   * offline maintenance job that saturates it takes the app down with it. A
   * batch job gets the leftovers, not the majority. Four sequential workers is
   * four connections — twice the original's two, a quarter of the ceiling, and
   * still ~4x faster than serialising 3,000 round trips.
   */
  const rows = (
    await mapLimit(
      accounts,
      4,
      async (acct) => {
        const account = await prisma.pixelAccount.findUnique({ where: { walletAddress: acct } });
        const journal = await prisma.pixelJournal.findMany({
          where: { walletAddress: acct },
          select: { delta: true, kind: true },
        });
        const sumAll = journal.reduce((s, j) => s + j.delta, 0n);
        const accrualRows = journal
          .filter((j) => ['bank', 'snapshot', 'seed', 'seed:v2'].includes(j.kind))
          .reduce((s, j) => s + j.delta, 0n);
        const settled = account?.settled ?? 0n;
        const unJournalled = settled > sumAll ? settled - sumAll : 0n;
        const alreadyCredited = accrualRows + unJournalled;
        const entitlement = earned.get(acct) ?? 0n;
        const shortfall = entitlement > alreadyCredited ? entitlement - alreadyCredited : 0n;
        return {
          address: acct,
          entitlement,
          alreadyCredited,
          unJournalled,
          shortfall,
          effective: effective(acct),
          heldSince: new Date(Number(firstSeen.get(acct)) * 1000),
          sources: [...(sources.get(acct) ?? [])],
          exists: !!account,
        };
      },
      'reading the ledger'
    )
  ).filter(Boolean);
  console.log('');
  rows.sort((a, b) => (b.shortfall > a.shortfall ? 1 : b.shortfall < a.shortfall ? -1 : 0));

  console.log(`\n${rows.length} accounts earned pixels on chain:\n`);
  console.log(
    '  account                                       since         entitled    credited   SHORTFALL'
  );
  let totalShortfall = 0n;
  let totalEntitled = 0n;
  for (const r of rows) {
    totalShortfall += r.shortfall;
    totalEntitled += r.entitlement;
    console.log(
      '  ' + r.address,
      r.heldSince.toISOString().slice(0, 10),
      String(r.entitlement).padStart(12),
      String(r.alreadyCredited).padStart(11),
      String(r.shortfall).padStart(11),
      r.sources.length > 1 || r.sources[0] !== r.address ? ` (via ${r.sources.join(', ')})` : '',
      r.unJournalled > 0n ? ` [un-journalled ${r.unJournalled}]` : ''
    );
  }
  console.log(`\n  entitled in total: ${totalEntitled.toLocaleString()} pixels`);
  console.log(`  SHORTFALL to pay:  ${totalShortfall.toLocaleString()} pixels`);
  console.log(`  accounts to pay:   ${rows.filter((r) => r.shortfall > 0n).length}`);

  if (!COMMIT) {
    console.log('\nDRY RUN — pass --until <unix> --commit to write.');
    await prisma.$disconnect();
    return;
  }

  let wrote = 0;
  let skipped = 0;
  let nothingOwed = 0;
  let paid = 0n;
  const owing = rows.filter((r) => r.shortfall > 0n).length;
  // DELIBERATELY SEQUENTIAL. Everything above this line is a read and is
  // parallelised; these are transactions against a live ledger, and the time
  // saved by overlapping them is not worth reasoning about interleaved writes
  // to the table this whole script exists to repair.
  for (const r of rows) {
    if (r.shortfall === 0n) {
      nothingOwed++;
      continue;
    }
    /**
     * The marker is scoped to THIS reconciliation.
     *
     * It used to be a bare kind:'seed', with no token and no version — and
     * since the token was a runtime argument, whichever run went first
     * permanently claimed the account. The legacy repayment would have hit
     * that marker for every wallet the new-token run had already touched and
     * paid nothing, to precisely the sellers it existed to repay, printing
     * "skipped N already seeded" as though healthy.
     */
    const already = await prisma.pixelJournal.findFirst({
      where: { walletAddress: r.address, kind: 'seed:v2' },
      select: { id: true },
    });
    if (already) {
      skipped++;
      continue;
    }
    await prisma.$transaction([
      prisma.pixelAccount.upsert({
        where: { walletAddress: r.address },
        create: {
          walletAddress: r.address,
          settled: r.shortfall,
          // in NEW-token units, which is what the ledger reads this column as.
          // The old code wrote the raw replayed balance, so a 60,000-legacy
          // holder got checkpointSage = 60,000 and a rate of 60/day instead of
          // 15,000 until a sweep happened to correct it.
          checkpointSage: r.effective,
          lastSync: new Date(Number(until) * 1000),
        },
        // lastSync moves to the reconciliation point on an existing row too,
        // so the ledger resumes from exactly where this run stopped instead of
        // banking the same interval again.
        update: {
          settled: { increment: r.shortfall },
          checkpointSage: r.effective,
          lastSync: new Date(Number(until) * 1000),
          streamDust: 0n,
        },
      }),
      prisma.pixelJournal.create({
        data: {
          walletAddress: r.address,
          delta: r.shortfall,
          kind: 'seed:v2',
          reason: `reconciled to ${new Date(Number(until) * 1000).toISOString().slice(0, 10)}, held since ${r.heldSince.toISOString().slice(0, 10)}`,
        },
      }),
    ]);
    wrote++;
    paid += r.shortfall;
    if (wrote % 25 === 0 || wrote === owing) {
      progress(`writing (${paid.toLocaleString()} px)`, wrote, owing);
    }
  }
  console.log(
    `\npaid ${wrote} accounts, skipped ${skipped} already reconciled, ${nothingOwed} owed nothing.`
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
