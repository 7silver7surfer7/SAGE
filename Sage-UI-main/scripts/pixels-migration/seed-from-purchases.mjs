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

const TOKEN = '0xE21a2b120FAcF995bC8bF6b1843f409E568beBA3';
const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const CHAIN_ID = 4663;

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

async function creationBlock(provider, address, head) {
  let lo = 0;
  let hi = head;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const code = await provider.getCode(address, mid).catch(() => '0x');
    if (code === '0x') lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

async function main() {
  const provider = new ethers.providers.StaticJsonRpcProvider(RPC, CHAIN_ID);
  const head = await provider.getBlockNumber();
  const start = await creationBlock(provider, TOKEN, head);
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
    const held = bal.get(who) ?? 0n;
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
    const whole = BigInt(log.data) / WEI; // whole tokens, as the ledger counts

    for (const side of [from, to]) {
      if (side === ethers.constants.AddressZero) continue;
      accrue(side, ts);
      if (!since.has(side)) since.set(side, ts);
      if (!firstSeen.has(side)) firstSeen.set(side, ts);
    }
    if (from !== ethers.constants.AddressZero) {
      bal.set(from, (bal.get(from) ?? 0n) - whole);
    }
    if (to !== ethers.constants.AddressZero) {
      bal.set(to, (bal.get(to) ?? 0n) + whole);
    }
  }
  for (const who of bal.keys()) accrue(who, now);

  // ── only real wallets: contracts (pool, token, routers) never earned ──────
  const rows = [];
  for (const [who, pixels] of earned) {
    if (pixels <= 0n) continue;
    const code = await provider.getCode(who).catch(() => null);
    if (code === null) continue;
    const isDelegated = code.toLowerCase().startsWith('0xef0100') && code.length === 2 + 23 * 2;
    if (code !== '0x' && !isDelegated) continue; // a contract, not a person
    rows.push({
      address: who,
      pixels,
      balance: bal.get(who) ?? 0n,
      heldSince: new Date(Number(firstSeen.get(who)) * 1000),
      delegated: isDelegated,
    });
  }
  rows.sort((a, b) => (b.pixels > a.pixels ? 1 : -1));

  console.log(`\n${rows.length} wallets earned pixels before accrual moved:\n`);
  console.log('  wallet                                        held since    balance      pixels');
  let total = 0n;
  for (const r of rows) {
    total += r.pixels;
    console.log(
      '  ' + r.address,
      r.heldSince.toISOString().slice(0, 10),
      String(r.balance).padStart(12),
      String(r.pixels).padStart(10),
      r.delegated ? ' (7702)' : ''
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
