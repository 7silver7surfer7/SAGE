#!/usr/bin/env node
/**
 * Seed Pixels for holders who migrated to the new SAGE token BEFORE accrual
 * was pointed at it.
 *
 * People bought the new token and held it while the ledger was still reading
 * the old one, so they earned nothing for that period. This credits it.
 *
 * WHY REPLAY RATHER THAN ESTIMATE
 * -------------------------------
 * The obvious shortcut — first-purchase date times current balance — pays
 * someone who bought a large bag yesterday as if they had held it since the
 * token launched. That is not a rounding error, it is the difference between
 * a fair backfill and minting pixels for whoever timed their buy last. So this
 * replays every Transfer, tracks each wallet's balance through time, and
 * integrates accrual over the intervals the balance was actually held:
 *
 *   pixels = SUM over intervals of  min(balance, CAP) * RATE * seconds
 *                                   ---------------------------------
 *                                        RATE_DIVISOR * 86400
 *
 * Integer maths with a carried remainder, identical to streamWithDust() in
 * utilities/pixelsLedger.ts, so a seeded wallet and a live-accruing one are
 * computed the same way rather than merely close.
 *
 * SAFE TO RE-RUN. Writes are keyed on a 'seed' journal row per wallet; a
 * wallet that already has one is skipped, so a second run cannot double-credit.
 *
 *   node scripts/pixels-migration/seed-from-purchases.mjs           # dry run
 *   node scripts/pixels-migration/seed-from-purchases.mjs --commit  # write
 */
import { ethers } from 'ethers';
import { PrismaClient } from '@prisma/client';

// Which token's holders to replay. Defaults to the NEW token (the original
// job: crediting people who migrated before accrual pointed at it).
//
// --token legacy replays the OLD one instead, which is what repays the holders
// whose accrual was destroyed by the sustained-balance rule: selling before a
// sweep banked them zeroed the whole unbanked interval, and while the sweep
// rotation was broken that interval was DAYS. One confirmed case is owed
// 110,178 pixels for 4.41 days held at the cap.
//
// Legacy balances are replayed in LEGACY units and converted with x250 at the
// end (see LEGACY_RATIO) — the cap must be applied to the CONVERTED figure or
// every legacy holder is capped 250x too low.
const TOKENS = {
  new: '0xE21a2b120FAcF995bC8bF6b1843f409E568beBA3',
  legacy: '0x14561006002e8f76E68EC69e6A32527730bb73c8',
};
const tokenArg = process.argv.indexOf('--token');
const TOKEN_KIND = tokenArg > -1 ? process.argv[tokenArg + 1] : 'new';
const TOKEN = TOKENS[TOKEN_KIND];
if (!TOKEN) throw new Error(`--token must be one of: ${Object.keys(TOKENS).join(', ')}`);
/** One legacy token earns what 250 new ones do. 1 for the new token itself. */
const LEGACY_RATIO = TOKEN_KIND === 'legacy' ? 250n : 1n;
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

const COMMIT = process.argv.includes('--commit');
const prisma = new PrismaClient();

const addrOf = (topic) => ethers.utils.getAddress('0x' + topic.slice(26));

/**
 * The block the token was deployed in — from its CREATION TRANSACTION, not a
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
      'could not read the deploy block from the explorer, and this RPC cannot be ' +
        'binary-searched reliably. Pass --from-block <n> with the creation block.'
    );
  }
  const receipt = await provider.getTransactionReceipt(hash);
  if (!receipt?.blockNumber) throw new Error(`creation tx ${hash} has no receipt`);
  return receipt.blockNumber;
}

async function main() {
  const provider = new ethers.providers.StaticJsonRpcProvider(RPC, CHAIN_ID);
  const head = await provider.getBlockNumber();
  // an explicit override wins, for reruns that must not depend on the explorer
  const fromArg = process.argv.indexOf('--from-block');
  const start =
    fromArg > -1 ? Number(process.argv[fromArg + 1]) : await creationBlock(provider, TOKEN);
  if (!Number.isFinite(start) || start <= 0) throw new Error('bad start block');
  console.log(`token deployed at block ${start.toLocaleString()}, head ${head.toLocaleString()}`);

  // ── collect every transfer ────────────────────────────────────────────────
  const logs = [];
  for (let from = start; from <= head; from += CHUNK) {
    const to = Math.min(from + CHUNK - 1, head);
    const batch = await provider
      .getLogs({ address: TOKEN, topics: [TRANSFER], fromBlock: from, toBlock: to })
      .catch(() => []);
    logs.push(...batch);
  }
  logs.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
  console.log(`${logs.length} transfers`);

  // block timestamps, deduped — the integration is over TIME, not blocks
  const blocks = [...new Set(logs.map((l) => l.blockNumber))];
  const timeOf = new Map();
  for (const b of blocks) {
    const blk = await provider.getBlock(b);
    timeOf.set(b, BigInt(blk.timestamp));
  }
  const now = BigInt(Math.floor(Date.now() / 1000));

  // ── replay, integrating accrual per wallet ────────────────────────────────
  const bal = new Map();
  const since = new Map();
  const dust = new Map();
  const earned = new Map();
  const firstSeen = new Map();

  const accrue = (who, until) => {
    // balances are tracked in WEI and truncated to whole tokens only here.
    // Truncating each transfer instead loses the fraction every time and the
    // error compounds with the wrong sign: two receives of 1.5 count as 1+1=2
    // while one send of 3.0 counts as 3, so a wallet that never went short
    // ends the replay at -1 tokens. Observed on 0x505729ec… before this fix.
    // Convert to NEW-token units BEFORE capping. Capping the raw legacy figure
    // would cap a legacy holder at 25M legacy tokens — 250x too low — and
    // silently under-credit exactly the people this run exists to repay.
    const held = ((bal.get(who) ?? 0n) / WEI) * LEGACY_RATIO;
    const from = since.get(who);
    if (from === undefined || until <= from) return;
    if (held > 0n) {
      const capped = held > CAP_SAGE ? CAP_SAGE : held;
      const num = capped * RATE_SCALED * (until - from) + (dust.get(who) ?? 0n);
      earned.set(who, (earned.get(who) ?? 0n) + num / UNIT);
      dust.set(who, num % UNIT);
    }
    since.set(who, until);
  };

  for (const log of logs) {
    const ts = timeOf.get(log.blockNumber);
    const from = addrOf(log.topics[1]);
    const to = addrOf(log.topics[2]);
    const amount = BigInt(log.data); // wei — never truncate here, see accrue()

    for (const side of [from, to]) {
      if (side === ethers.constants.AddressZero) continue;
      accrue(side, ts);
      if (!since.has(side)) since.set(side, ts);
      if (!firstSeen.has(side)) firstSeen.set(side, ts);
    }
    if (from !== ethers.constants.AddressZero) {
      bal.set(from, (bal.get(from) ?? 0n) - amount);
    }
    if (to !== ethers.constants.AddressZero) {
      bal.set(to, (bal.get(to) ?? 0n) + amount);
    }
  }
  for (const who of bal.keys()) accrue(who, now);

  // ── only real wallets: contracts (pool, token, routers) never earned ──────
  let rows = [];
  for (const [who, pixels] of earned) {
    if (pixels <= 0n) continue;
    const code = await provider.getCode(who).catch(() => null);
    if (code === null) continue;
    const isDelegated = code.toLowerCase().startsWith('0xef0100') && code.length === 2 + 23 * 2;
    if (code !== '0x' && !isDelegated) continue; // a contract, not a person
    rows.push({
      address: who,
      pixels,
      balance: (bal.get(who) ?? 0n) / WEI,
      heldSince: new Date(Number(firstSeen.get(who)) * 1000),
      delegated: isDelegated,
    });
  }
  rows.sort((a, b) => (b.pixels > a.pixels ? 1 : -1));

  // A negative balance is impossible on chain: it means the replay missed
  // transfers, so the whole run is untrustworthy. Refuse rather than seed.
  const impossible = rows.filter((r) => r.balance < 0n);
  if (impossible.length) {
    console.error(`\n${impossible.length} wallet(s) ended with a NEGATIVE balance:`);
    impossible.forEach((r) => console.error('  ' + r.address, r.balance.toString()));
    throw new Error('transfer history is incomplete — refusing to seed from it');
  }

  // ── resolve each HOLDER to the account that should be CREDITED ──────────
  //
  // The holder and the earner are not always the same address. Tokens bought
  // through a custodial/embedded wallet (Privy, via bankrbot) sit in a wallet
  // the user controls but never signs in with, and LinkedWallet is what ties
  // that wallet to their SAGE account.
  //
  // Without this, seeding credited the HOLDER address — so a bankr buyer got a
  // PixelAccount minted for their bankr wallet and their actual account, the
  // one they sign in as, stayed empty. The pixels existed, on an address that
  // was not their identity.
  //
  // Unlinked holders fall back to themselves, which is the original behaviour.
  const links = await prisma.linkedWallet.findMany({
    select: { address: true, walletAddress: true },
  });
  const creditTo = new Map(links.map((l) => [l.address.toLowerCase(), l.walletAddress]));
  for (const r of rows) {
    const owner = creditTo.get(r.address.toLowerCase());
    r.creditTo = owner || r.address;
    r.viaLink = !!owner;
  }

  // Two holders linked to the SAME account must not be seeded as two rows: the
  // journal marker is per credited account, so the second would be skipped as
  // "already seeded" and its pixels lost. Merge first, then seed once.
  const merged = new Map();
  for (const r of rows) {
    const key = r.creditTo.toLowerCase();
    const prev = merged.get(key);
    if (!prev) {
      merged.set(key, { ...r, address: r.creditTo, sources: [r.address] });
    } else {
      prev.pixels += r.pixels;
      prev.balance += r.balance;
      prev.sources.push(r.address);
      if (r.heldSince < prev.heldSince) prev.heldSince = r.heldSince;
    }
  }
  rows = Array.from(merged.values()).sort((a, b) => (b.pixels > a.pixels ? 1 : -1));

  console.log(`\n${rows.length} accounts earned pixels before accrual moved:\n`);
  console.log('  account                                       held since    balance      pixels');
  let total = 0n;
  for (const r of rows) {
    total += r.pixels;
    console.log(
      '  ' + r.address,
      r.heldSince.toISOString().slice(0, 10),
      String(r.balance).padStart(12),
      String(r.pixels).padStart(10),
      r.viaLink ? ` (via link: ${r.sources.join(', ')})` : r.delegated ? ' (7702)' : ''
    );
  }
  console.log(`\n  total to seed: ${total.toLocaleString()} pixels`);

  if (!COMMIT) {
    console.log('\nDRY RUN — pass --commit to write.');
    await prisma.$disconnect();
    return;
  }

  let wrote = 0;
  let skipped = 0;
  for (const r of rows) {
    // idempotence: one 'seed' journal row per wallet is the marker
    const already = await prisma.pixelJournal.findFirst({
      where: { walletAddress: r.address, kind: 'seed' },
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
          settled: r.pixels,
          checkpointSage: r.balance,
          lastSync: new Date(),
        },
        update: { settled: { increment: r.pixels } },
      }),
      prisma.pixelJournal.create({
        data: {
          walletAddress: r.address,
          delta: r.pixels,
          kind: 'seed',
          reason: `held since ${r.heldSince.toISOString().slice(0, 10)}, pre-cutover accrual`,
        },
      }),
    ]);
    wrote++;
  }
  console.log(`\nseeded ${wrote} wallets, skipped ${skipped} already seeded.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
