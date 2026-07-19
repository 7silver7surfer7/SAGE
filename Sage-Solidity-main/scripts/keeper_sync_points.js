/**
 * SagePoints v3 keeper — DB-driven edition.
 *
 * TWO PRIOR DESIGNS, TWO DISTINCT FAILURE MODES:
 *  v1 replayed the token's FULL Transfer history in one eth_getLogs(0→latest).
 *     Post-graduation Uniswap volume pushed that call past the RPC's scan
 *     budget ("log query timed out") and the keeper flatlined outright
 *     (2026-07-19 03:55 UTC — no buyer got a checkpoint until it was fixed).
 *  v2 (the "fix") scanned only a bounded recent window, chunked. That solved
 *     the timeout, but introduced a quieter bug: a wallet whose ONE relevant
 *     transfer scrolls out of the window before any run processes it is
 *     PERMANENTLY invisible to every future run — it never trades again, so
 *     it never re-enters any window. Measured impact: 146 of 214 current
 *     SAGE holders (68%) had lastSync=0 — zero pixel accrual, forever,
 *     because they all bought during the v1 outage and never touched the
 *     token again. A sliding window cannot self-heal this; it can only be
 *     re-swept with a manually-widened one-off LOOKBACK_BLOCKS, which is a
 *     patch, not a fix — the same blind spot reopens on the next outage.
 *
 * NOW (v3): drop chain log scanning from the keeper ENTIRELY. Holder
 * discovery comes from the app's own trade ledger (GetTokenTradeLedger) —
 * an ever-growing, real-time-updated, NEVER-EXPIRING record (the pool-swap
 * indexer shipped 2026-07-19 keeps it current within seconds). Paging
 * through it once per run is a complete substitute for a chain scan:
 *  - no RPC log-query budget to blow (no eth_getLogs against the token at
 *    all — only cheap batched view calls: balanceOf/checkpointSage/lastSync)
 *  - no sliding window to fall out of — a wallet that traded once, ever,
 *    stays a permanent candidate on every future run until it's healthy
 *  - O(distinct traders + trades), both bounded and slow-growing, not
 *    O(chain history) and not O(recent volume)
 *
 * Segment math per drifted holder (whole-SAGE units, capped) — same shape as
 * v2, just fed from DB rows instead of chain events:
 *   [lastSync → t1) at min(checkpointSage, cap)   ← contract's own snapshot
 *   [t1 → t2)      at balance after trade 1
 *   ...
 *   [tN → now)     at live balance (cross-checked against reconstruction)
 *   settled_new = settled_onchain + Σ segment accruals
 *
 * Known limitation (unchanged from v1/v2, stated plainly): this reconstructs
 * accrual from TRADE history. A raw wallet-to-wallet SAGE transfer (a gift,
 * an airdrop outside the trade flow) isn't a "trade" and won't appear in the
 * ledger, so it's invisible to the backdated-accrual estimate. It is NEVER
 * invisible to the final checkpoint, though — that's always set from the
 * true on-chain balanceOf — so a gap here only mis-estimates a one-time
 * bonus, never ongoing accrual, and never compounds.
 *
 * Env: POINTS_ORACLE_PK (or DEPLOYER_PK) — controller/owner wallet.
 *      DRY_RUN=1 — print the seed batch, send nothing.
 *
 *   node scripts/keeper_sync_points.js
 */
require('dotenv').config();
const { ethers } = require('ethers');

const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const CHAIN = 4663;
const SAGE = '0x14561006002e8f76E68EC69e6A32527730bb73c8';
const V3 = '0x78cBa250326a19891f67581e2bD8e0D1A11Eb07e';
const LEDGER_URL = 'https://sageart.xyz/api/social/?action=GetTokenTradeLedger';
const RATE = 25; // rateScaled → 0.25/day
const CAP = 100000; // whole SAGE
const DAY = 86400;

const BATCH = 50; // parallel RPC reads
const DRY = process.env.DRY_RUN === '1';

const accrue = (whole, seconds) => (Math.min(whole, CAP) * RATE * seconds) / (100 * DAY);

async function batched(items, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += BATCH) {
    out.push(...(await Promise.all(items.slice(i, i + BATCH).map(fn))));
  }
  return out;
}

/** Page through the full trade ledger for one token. Never expires, never times out. */
async function fetchLedger(tokenAddress) {
  const trades = [];
  let cursor;
  do {
    const url = `${LEDGER_URL}&address=${tokenAddress}${cursor ? `&cursor=${cursor}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ledger fetch failed: HTTP ${res.status}`);
    const page = await res.json();
    trades.push(...page.trades);
    cursor = page.nextCursor;
  } while (cursor);
  return trades;
}

async function main() {
  const pk = process.env.POINTS_ORACLE_PK || process.env.DEPLOYER_PK;
  if (!pk) throw new Error('POINTS_ORACLE_PK (or DEPLOYER_PK) required');
  // explicit timeout: a bare URL string leaves ethers' fetch with none at
  // all — a single stalled request hangs the whole run instead of failing
  // cleanly (this script is stateless/idempotent, so a clean failure is
  // always safe — the next scheduled tick just recomputes from scratch).
  const p = new ethers.providers.StaticJsonRpcProvider({ url: RPC, timeout: 30000 }, CHAIN);
  const w = new ethers.Wallet(pk, p);

  // ── holder discovery: the DB ledger, not the chain ──
  const trades = await fetchLedger(SAGE);
  const now = Math.floor(Date.now() / 1000);
  // stable order: DB `id` isn't reliably chronological across separate
  // backfill runs (rows inserted well after ones with lower ids can carry
  // EARLIER timestamps) — sort by the timestamp itself, which is what the
  // segment math actually needs to be correct.
  const evs = trades
    .map((t) => ({
      t: Math.floor(new Date(t.createdAt).getTime() / 1000),
      trader: ethers.utils.getAddress(t.trader),
      side: t.side,
      amount: t.tokenAmount,
    }))
    .sort((a, b) => a.t - b.t);
  const byTrader = new Map();
  for (const e of evs) {
    if (!byTrader.has(e.trader)) byTrader.set(e.trader, []);
    byTrader.get(e.trader).push(e);
  }
  const holders = Array.from(byTrader.keys());
  console.log(`ledger: ${trades.length} trade(s), ${holders.length} distinct wallet(s)`);

  // ── contract state per holder (public mappings), batched — no log scans ──
  const sage = new ethers.Contract(SAGE, ['function balanceOf(address) view returns (uint256)'], p);
  const sp = new ethers.Contract(
    V3,
    [
      'function settled(address) view returns (uint256)',
      'function lastSync(address) view returns (uint256)',
      'function checkpointSage(address) view returns (uint256)',
      'function seedSettled(address[],uint256[]) external',
    ],
    w
  );
  const state = await batched(holders, async (a) => ({
    a,
    bal: await sage.balanceOf(a),
    cp: await sp.checkpointSage(a),
    settled: await sp.settled(a),
    last: await sp.lastSync(a),
  }));

  // ── drifted holders → true accrual over their trade-history segments ──
  const users = [];
  const amounts = [];
  for (const s of state) {
    const liveWhole = s.bal.div(ethers.constants.WeiPerEther).toNumber();
    const cp = s.cp.toNumber();
    const last = s.last.toNumber();
    if (liveWhole === cp && last !== 0) continue; // healthy and already synced at least once
    if (liveWhole === 0 && s.settled.isZero() && last === 0) continue; // sold out, nothing banked

    const mine = byTrader.get(s.a).filter((e) => e.t > last);
    let extra = 0;
    if (last === 0) {
      // Never synced. Not always a fresh buyer: a wallet whose ledger opens
      // with a SELL held tokens before its first recorded trade (a transfer
      // outside the trade flow, or trades that predate this ledger) — start
      // the running balance at live − Σ(ledger deltas), never zero, or the
      // opening sell walks it negative (which uint256 seeding would wrap
      // into an astronomical balance).
      const ledgerDelta = mine.reduce((d, e) => d + (e.side === 'buy' ? e.amount : -e.amount), 0);
      let running = Math.max(0, liveWhole - ledgerDelta);
      if (running > 0) {
        console.warn(
          `warn: ${s.a.slice(0, 10)} never synced but held ~${Math.floor(running)} SAGE before its first ledger trade — crediting ledger activity only`
        );
      }
      for (let i = 0; i < mine.length; i++) {
        const e = mine[i];
        running = Math.max(0, running + (e.side === 'buy' ? e.amount : -e.amount));
        const until = i + 1 < mine.length ? mine[i + 1].t : now;
        extra += accrue(running, until - e.t);
      }
    } else {
      // synced before: contract snapshot (checkpointSage) IS the balance at
      // lastSync — walk segments forward from it
      let running = cp;
      let cursor = last;
      for (const e of mine) {
        extra += accrue(running, e.t - cursor);
        running = Math.max(0, running + (e.side === 'buy' ? e.amount : -e.amount));
        cursor = e.t;
      }
      const reconWhole = Math.floor(running);
      if (Math.abs(reconWhole - liveWhole) > 1) {
        console.warn(
          `warn: ${s.a.slice(0, 10)} reconstruction ${reconWhole} != live ${liveWhole} — non-trade transfer? using live for the final segment`
        );
      }
      extra += accrue(liveWhole, now - cursor);
    }
    // hard floor: accrual can never be negative, and a negative would wrap
    // the uint256 seed into an astronomical balance
    if (extra < 0) {
      console.warn(`warn: ${s.a.slice(0, 10)} computed negative extra ${Math.floor(extra)} — clamping to 0`);
      extra = 0;
    }
    users.push(s.a);
    amounts.push(Math.floor(s.settled.toNumber() + extra));
  }

  if (users.length === 0) {
    console.log(`keeper ${new Date(now * 1000).toISOString()}: ${holders.length} wallet(s) checked, all in sync.`);
    return;
  }
  console.log(
    `keeper ${new Date(now * 1000).toISOString()}: drifted ${users.length}/${holders.length}: ${users
      .slice(0, 20)
      .map((u, i) => `${u.slice(0, 8)}=${amounts[i]}`)
      .join(', ')}${users.length > 20 ? ', …' : ''}`
  );
  if (DRY) {
    console.log(`DRY_RUN — would seedSettled ${users.length} holder(s); no tx sent.`);
    return;
  }
  // Chunked seeds with ESTIMATED gas: each seedSettled entry costs ~90-100k
  // (three cold SSTOREs + an external balanceOf) — a hand-rolled per-user
  // formula ran out of gas the first time a large catch-up batch appeared.
  const SEED_BATCH = 40;
  for (let i = 0; i < users.length; i += SEED_BATCH) {
    const u = users.slice(i, i + SEED_BATCH);
    const a = amounts.slice(i, i + SEED_BATCH);
    const blk = await p.getBlock('latest');
    const gasPrice = blk.baseFeePerGas.mul(150).div(100);
    let gasLimit;
    try {
      gasLimit = (await sp.estimateGas.seedSettled(u, a, { gasPrice, type: 0 })).mul(130).div(100);
    } catch {
      gasLimit = ethers.BigNumber.from(300000 + u.length * 120000);
    }
    const tx = await sp.seedSettled(u, a, { gasPrice, type: 0, gasLimit });
    await tx.wait();
    console.log(`keeper: synced ${u.length} holder(s) (${i + u.length}/${users.length}), tx ${tx.hash}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('keeper failed:', e.message);
    process.exit(1);
  });
