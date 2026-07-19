/**
 * SagePoints reconciliation keeper — the safety net the fast keeper can't be.
 *
 * keeper_sync_points.js discovers holders from the app's trade LEDGER —
 * cheap and correct for anyone who ever bought or sold, but structurally
 * blind to a wallet that only ever RECEIVED SAGE via a raw transfer that
 * was never a trade. Measured on 2026-07-19: 220 such wallets currently
 * hold SAGE, 211 had never been checkpointed — almost certainly the
 * platform's own follower-airdrop feature (recordAirdrop), not a rare edge
 * case. A wallet like this can drift forever under the fast keeper alone,
 * since it never enters the trade ledger no matter how long you wait.
 *
 * This script closes that gap the only complete way: a full chunked replay
 * of the SAGE token's ENTIRE Transfer history (genesis block found via the
 * launch tx receipt), building each address's true chronological balance
 * timeline from absolute zero — no approximation needed, since nothing
 * about this token exists before its genesis block. Any address whose
 * checkpoint has drifted from that true history — trader or not — gets
 * seeded. Traders the fast keeper already keeps healthy just come back
 * clean here too (checkpoint matches, no tx sent) — this script overlapping
 * with the fast keeper is by design, not a race: seedSettled OVERWRITES,
 * so if the fast keeper juuust settled a wallet a second before this reads
 * it, this script computes the SAME truth from the SAME on-chain source
 * and writes the same answer — never a step backward.
 *
 * COST GROWS WITH TOKEN AGE, NOT TRADE VOLUME: ~165 chunks (20k blocks
 * each) took ~20s at 4 days old. That grows by roughly 2 chunks/hour
 * (this chain's ~0.1s block time), so it stays cheap for weeks. It is NOT
 * bounded forever — if this is still running unmodified once SAGE is many
 * months old and a genesis-to-head scan is taking minutes, the fix is a
 * persisted watermark (a GitHub Actions cache with a run-id-suffixed key +
 * restore-keys prefix match is the standard idiom — GH cache entries are
 * immutable per exact key, so a fixed key can never be updated in place)
 * so each run only replays since the last one. Deliberately NOT built now:
 * this keeper has no DB credentials by design (smaller secret surface on a
 * public CI runner), and the cache-based watermark is real complexity for a
 * problem that doesn't exist yet at 4 days old. Don't add it before it's
 * needed — do add it before this becomes the slow, silently-degrading
 * thing this whole file exists to warn against repeating.
 *
 * Env: POINTS_ORACLE_PK (or DEPLOYER_PK) — controller/owner wallet.
 *      DRY_RUN=1 — print the seed batch, send nothing.
 *
 *   node scripts/keeper_reconcile.js
 */
require('dotenv').config();
const { ethers } = require('ethers');

const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const CHAIN = 4663;
const SAGE = '0x14561006002e8f76E68EC69e6A32527730bb73c8';
const V3 = '0x78cBa250326a19891f67581e2bD8e0D1A11Eb07e';
const LAUNCH_TX = '0x7df1ef68811a3a4fc1149ba4bfa1f88affdc85e2da6890321ca5fc0f8c83513d'; // SAGE's own launch tx — pins the genesis block
const RATE = 25; // rateScaled → 0.25/day
const CAP = 100000; // whole SAGE
const DAY = 86400;

const CHUNK = 20000; // blocks per eth_getLogs (bigger ranges time out on this RPC)
const BATCH = 20; // parallel RPC reads — this RPC rate-limits sustained 50-wide bursts
const DRY = process.env.DRY_RUN === '1';

const accrue = (whole, seconds) => (Math.min(whole, CAP) * RATE * seconds) / (100 * DAY);

/**
 * This RPC rate-limits under sustained burst load, not just occasionally
 * failing — observed live, twice: a bulk block-timestamp sweep died at
 * requests #~460-560 (several hundred calls in, ~9-11 batches of BATCH-many)
 * with a hard 30s timeout, both times. A clean fail-fast on that (the
 * previous fix) just means the WHOLE expensive scan gets thrown away and
 * restarted from zero on the next tick — for a job meant to run unattended,
 * "fails cleanly" isn't enough; it needs to actually survive a transient
 * stall. Retry with backoff on each individual call, so one rate-limited
 * request doesn't sink hundreds of already-succeeded ones.
 */
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

async function batched(items, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += BATCH) {
    out.push(...(await Promise.all(items.slice(i, i + BATCH).map((item) => withRetry(() => fn(item))))));
  }
  return out;
}

async function main() {
  const pk = process.env.POINTS_ORACLE_PK || process.env.DEPLOYER_PK;
  if (!pk) throw new Error('POINTS_ORACLE_PK (or DEPLOYER_PK) required');
  // explicit timeout: a bare URL string leaves ethers' underlying fetch with
  // NO timeout at all — a single stalled request (observed live: 14+ minutes
  // and counting on this same RPC, mid-reconciliation) hangs the whole run
  // forever instead of failing cleanly into a retry-safe exit. This script
  // is stateless and idempotent, so a clean failure is always safe — every
  // future scheduled run just recomputes the same truth from scratch.
  const p = new ethers.providers.StaticJsonRpcProvider({ url: RPC, timeout: 30000 }, CHAIN);
  const w = new ethers.Wallet(pk, p);

  const genesisRcpt = await p.getTransactionReceipt(LAUNCH_TX);
  const genesis = genesisRcpt.blockNumber;
  const head = await p.getBlockNumber();
  const topic = ethers.utils.id('Transfer(address,address,uint256)');
  const iface = new ethers.utils.Interface([
    'event Transfer(address indexed from,address indexed to,uint256 value)',
  ]);

  console.log(`reconcile: scanning ${genesis} → ${head} (${Math.ceil((head - genesis) / CHUNK)} chunks)`);
  let logs = [];
  for (let b = genesis; b <= head; b += CHUNK) {
    const to = Math.min(b + CHUNK - 1, head);
    const chunkLogs = await withRetry(() => p.getLogs({ address: SAGE, topics: [topic], fromBlock: b, toBlock: to }));
    logs = logs.concat(chunkLogs);
  }

  const blockNums = Array.from(new Set(logs.map((l) => l.blockNumber)));
  const stamps = await batched(blockNums, (n) => p.getBlock(n));
  const ts = new Map(stamps.map((b) => [b.number, b.timestamp]));
  const now = (await p.getBlock('latest')).timestamp;

  const zero = ethers.constants.AddressZero.toLowerCase();
  const evs = logs
    .map((l) => {
      const e = iface.parseLog(l);
      return {
        t: ts.get(l.blockNumber),
        bn: l.blockNumber,
        li: l.logIndex,
        from: e.args.from.toLowerCase(),
        to: e.args.to.toLowerCase(),
        val: e.args.value,
      };
    })
    .sort((a, b) => a.t - b.t || a.bn - b.bn || a.li - b.li);

  const byAddr = new Map();
  for (const e of evs) {
    if (e.from !== zero) {
      if (!byAddr.has(e.from)) byAddr.set(e.from, []);
      byAddr.get(e.from).push(e);
    }
    if (e.to !== zero) {
      if (!byAddr.has(e.to)) byAddr.set(e.to, []);
      byAddr.get(e.to).push(e);
    }
  }
  const codes = await batched(Array.from(byAddr.keys()), (a) => p.getCode(a).catch(() => '0x'));
  const holders = Array.from(byAddr.keys()).filter((_, i) => codes[i] === '0x');
  console.log(`${evs.length} transfer(s), ${holders.length} EOA address(es) ever touched`);

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

  const users = [];
  const amounts = [];
  for (const s of state) {
    const liveWhole = s.bal.div(ethers.constants.WeiPerEther).toNumber();
    const cp = s.cp.toNumber();
    const last = s.last.toNumber();
    if (liveWhole === cp && last !== 0) continue; // healthy, already synced
    if (liveWhole === 0 && s.settled.isZero() && last === 0) continue; // never held anything worth seeding

    const mine = byAddr.get(s.a);
    let extra = 0;
    if (last === 0) {
      // Complete history from absolute zero — genesis is this token's
      // first-ever block, so no pre-window balance to approximate for any
      // segment BETWEEN two known events. The trailing segment (last event
      // → now) is different: this scan snapshots history once at the start
      // of a run that then takes minutes to finish (hundreds of retried RPC
      // calls), while SAGE trades continuously — a wallet that traded AGAIN
      // during that window has a live balance the history-at-scan-time
      // can't explain. Measured live: reconstruction 0 vs live 5,954,004 for
      // one wallet in a single run. Always trust liveWhole for the final
      // segment, exactly like the already-synced branch below already does
      // — never let a stale snapshot under-credit the most recent activity.
      let running = 0;
      const relevant = mine; // last==0 means nothing to filter by timestamp
      for (let i = 0; i < relevant.length; i++) {
        const e = relevant[i];
        running += (e.to === s.a ? 1 : -1) * Number(ethers.utils.formatEther(e.val));
        if (running < 0) running = 0; // floor: dust rounding, never a real negative balance
        const isLast = i === relevant.length - 1;
        const until = isLast ? now : relevant[i + 1].t;
        extra += accrue(isLast ? liveWhole : running, until - e.t);
      }
      const reconWhole = Math.floor(running);
      if (Math.abs(reconWhole - liveWhole) > 1) {
        console.log(
          `info: ${s.a.slice(0, 10)} history-at-scan-time ${reconWhole} != live ${liveWhole} — wallet likely traded again while this run was in progress; used live balance for the trailing segment`
        );
      }
    } else {
      // previously synced (by the fast keeper or a prior reconcile run) but
      // drifted — walk forward from the contract's own checkpoint snapshot
      const sinceLast = mine.filter((e) => e.t > last);
      let running = cp;
      let cursor = last;
      for (const e of sinceLast) {
        extra += accrue(running, e.t - cursor);
        running += (e.to === s.a ? 1 : -1) * Number(ethers.utils.formatEther(e.val));
        if (running < 0) running = 0;
        cursor = e.t;
      }
      extra += accrue(liveWhole, now - cursor);
    }
    if (extra < 0) extra = 0; // hard floor: a negative would wrap the uint256 seed
    users.push(ethers.utils.getAddress(s.a));
    amounts.push(Math.floor(s.settled.toNumber() + extra));
  }

  if (users.length === 0) {
    console.log(`reconcile ${new Date(now * 1000).toISOString()}: ${holders.length} address(es) checked, all in sync.`);
    return;
  }
  console.log(
    `reconcile ${new Date(now * 1000).toISOString()}: drifted ${users.length}/${holders.length}: ${users
      .slice(0, 20)
      .map((u, i) => `${u.slice(0, 8)}=${amounts[i]}`)
      .join(', ')}${users.length > 20 ? ', …' : ''}`
  );
  if (DRY) {
    console.log(`DRY_RUN — would seedSettled ${users.length} address(es); no tx sent.`);
    return;
  }
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
    console.log(`reconcile: synced ${u.length} address(es) (${i + u.length}/${users.length}), tx ${tx.hash}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('reconcile failed:', e.message);
    process.exit(1);
  });
