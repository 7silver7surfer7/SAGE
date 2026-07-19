/**
 * SagePoints v3 keeper — incremental edition.
 *
 * WHY THE REWRITE: the original replayed the token's FULL Transfer history in
 * one eth_getLogs(fromBlock: 0). That was fine while SAGE had a few dozen
 * transfers — but post-graduation Uniswap trading added thousands of swaps
 * (each with SAGE Transfer legs), the call crossed the RPC's scan budget
 * ("log query timed out"), and the keeper flatlined at 2026-07-19 03:55 UTC.
 * Every wallet that bought during the outage got no checkpoint → no accrual →
 * the pixels leaderboard went stale. Full-history replay is also O(history)
 * per run, so it only ever gets worse.
 *
 * NOW: O(window), flat forever —
 *  - scans only the last LOOKBACK_BLOCKS (default 120k ≈ 33h at ~0.1s blocks)
 *    in 20k-block chunks (empirically safe on this RPC)
 *  - reconstructs each affected holder's true accrual INCREMENTALLY from the
 *    contract's own public state (settled / lastSync / checkpointSage) plus
 *    the window's trade segments — no need to see history before lastSync,
 *    because checkpointSage IS the balance snapshot at lastSync
 *  - skips contract addresses (the Uniswap pair, factory, router) via getCode
 *  - batches every RPC read; drift-detection keeps quiet runs tx-free
 *
 * Segment math per drifted holder (whole-SAGE units, capped):
 *   [lastSync → t1) at min(checkpointSage, cap)   ← contract's own snapshot
 *   [t1 → t2)      at balance after trade 1
 *   ...
 *   [tN → now)     at live balance (cross-checked against reconstruction)
 *   settled_new = settled_onchain + Σ segment accruals
 * seedSettled(users, amounts) then banks settled_new, re-checkpoints at the
 * live balance, and restarts the honest stream from the seed block.
 *
 * Env: POINTS_ORACLE_PK (or DEPLOYER_PK) — controller/owner wallet.
 *      LOOKBACK_BLOCKS  — scan window override (outage recovery: raise it)
 *      DRY_RUN=1        — print the seed batch, send nothing.
 *
 *   node scripts/keeper_sync_points.js
 */
require('dotenv').config();
const { ethers } = require('ethers');

const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const CHAIN = 4663;
const SAGE = '0x14561006002e8f76E68EC69e6A32527730bb73c8';
const V3 = '0x78cBa250326a19891f67581e2bD8e0D1A11Eb07e';
const RATE = 25; // rateScaled → 0.25/day
const CAP = 100000; // whole SAGE
const DAY = 86400;

const LOOKBACK = Number(process.env.LOOKBACK_BLOCKS || 120000);
const CHUNK = 20000; // blocks per eth_getLogs (bigger ranges time out)
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

async function main() {
  const pk = process.env.POINTS_ORACLE_PK || process.env.DEPLOYER_PK;
  if (!pk) throw new Error('POINTS_ORACLE_PK (or DEPLOYER_PK) required');
  const p = new ethers.providers.StaticJsonRpcProvider(RPC, CHAIN);
  const w = new ethers.Wallet(pk, p);

  // ── bounded, chunked scan of recent SAGE transfers ──
  const head = await p.getBlockNumber();
  const fromBlock = Math.max(0, head - LOOKBACK);
  const topic = ethers.utils.id('Transfer(address,address,uint256)');
  const iface = new ethers.utils.Interface([
    'event Transfer(address indexed from,address indexed to,uint256 value)',
  ]);
  let logs = [];
  for (let b = fromBlock; b <= head; b += CHUNK) {
    const to = Math.min(b + CHUNK - 1, head);
    logs = logs.concat(await p.getLogs({ address: SAGE, topics: [topic], fromBlock: b, toBlock: to }));
  }

  // block timestamps (deduped, batched)
  const blockNums = Array.from(new Set(logs.map((l) => l.blockNumber)));
  const stamps = await batched(blockNums, (n) => p.getBlock(n));
  const ts = new Map(stamps.map((b) => [b.number, b.timestamp]));
  const now = (await p.getBlock('latest')).timestamp;

  // stable chain ordering: same-second trades (0.3s blocks + arb bursts) must
  // apply in log order or running balances zig through states that never
  // existed on-chain
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

  // ── affected addresses, minus zero + contracts (pool/factory/router/…) ──
  const zero = ethers.constants.AddressZero.toLowerCase();
  const touched = Array.from(new Set(evs.flatMap((e) => [e.from, e.to]))).filter((a) => a !== zero);
  const codes = await batched(touched, (a) => p.getCode(a).catch(() => '0x'));
  const isContract = new Map(touched.map((a, i) => [a, codes[i] !== '0x']));
  const holders = touched.filter((a) => !isContract.get(a));

  // ── contract state per holder (public mappings), batched ──
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

  // ── drifted holders → incremental true accrual over the window's segments ──
  const users = [];
  const amounts = [];
  for (const s of state) {
    const liveWhole = s.bal.div(ethers.constants.WeiPerEther).toNumber();
    const cp = s.cp.toNumber();
    const last = s.last.toNumber();
    if (liveWhole === cp) continue; // no drift → the contract streams correctly
    if (liveWhole === 0 && s.settled.isZero() && last === 0) continue; // sold out, nothing banked

    // this holder's in-window balance changes after lastSync
    const mine = evs.filter((e) => (e.from === s.a || e.to === s.a) && e.t > last);
    let extra = 0;
    if (last === 0) {
      // Never synced. Not always a fresh buyer: flat-cycling arb bots never
      // drift (balance == checkpoint == 0 at every old-keeper pass), so they
      // reach here holding PRE-window tokens — start their running balance at
      // live − Σ(window deltas), never zero, or an opening sell walks the
      // balance negative and accrues NEGATIVE pixels (which uint256 seeding
      // would wrap into astronomical balances).
      const windowDelta = mine.reduce(
        (d, e) => (e.to === s.a ? d.add(e.val) : d.sub(e.val)),
        ethers.BigNumber.from(0)
      );
      let running = s.bal.sub(windowDelta);
      if (running.lt(0)) running = ethers.BigNumber.from(0);
      if (running.gt(0)) {
        console.warn(
          `warn: ${s.a.slice(0, 10)} never synced but held ${ethers.utils.formatEther(running).split('.')[0]} SAGE pre-window — crediting window activity only`
        );
      }
      for (let i = 0; i < mine.length; i++) {
        const e = mine[i];
        running = e.to === s.a ? running.add(e.val) : running.sub(e.val);
        if (running.lt(0)) running = ethers.BigNumber.from(0);
        const until = i + 1 < mine.length ? mine[i + 1].t : now;
        extra += accrue(running.div(ethers.constants.WeiPerEther).toNumber(), until - e.t);
      }
    } else {
      // synced before: contract snapshot (checkpointSage) IS the balance at
      // lastSync — walk segments forward from it
      let runningWhole = cp;
      let cursor = last;
      let runningWei = ethers.utils.parseEther(String(cp)); // approx anchor
      for (let i = 0; i < mine.length; i++) {
        const e = mine[i];
        extra += accrue(runningWhole, e.t - cursor);
        runningWei = e.to === s.a ? runningWei.add(e.val) : runningWei.sub(e.val);
        if (runningWei.lt(0)) runningWei = ethers.BigNumber.from(0);
        runningWhole = Number(ethers.utils.formatEther(runningWei));
        cursor = e.t;
      }
      // final segment to now; prefer the live balance (whole-token anchor
      // drift from the cp approximation stays sub-token, but live is exact)
      const reconWhole = Math.floor(runningWhole);
      if (Math.abs(reconWhole - liveWhole) > 1) {
        console.warn(
          `warn: ${s.a.slice(0, 10)} reconstruction ${reconWhole} != live ${liveWhole} — trades older than the window? using live`
        );
      }
      extra += accrue(liveWhole, now - cursor);
    }
    // hard floor: accrual can never be negative, and a seed must never bank
    // LESS than what's already settled (seedSettled overwrites) — a negative
    // here would wrap uint256 into an astronomical balance
    if (extra < 0) {
      console.warn(`warn: ${s.a.slice(0, 10)} computed negative extra ${Math.floor(extra)} — clamping to 0`);
      extra = 0;
    }
    users.push(ethers.utils.getAddress(s.a));
    amounts.push(Math.floor(s.settled.toNumber() + extra));
  }

  const scanned = `${fromBlock}→${head}`;
  if (users.length === 0) {
    console.log(`keeper ${new Date(now * 1000).toISOString()}: scanned ${scanned}, ${holders.length} wallet(s) touched, all in sync.`);
    return;
  }
  console.log(
    `keeper ${new Date(now * 1000).toISOString()}: scanned ${scanned}, drifted: ${users
      .map((u, i) => `${u.slice(0, 8)}=${amounts[i]}`)
      .join(', ')}`
  );
  if (DRY) {
    console.log(`DRY_RUN — would seedSettled ${users.length} holder(s); no tx sent.`);
    return;
  }
  // Chunked seeds with ESTIMATED gas: each seedSettled entry costs ~90-100k
  // (three cold SSTOREs + an external balanceOf), so the old hand formula of
  // 60k/user ran out of gas the first time a big catch-up batch appeared
  // (67 holders → status:0 with gasUsed == gasLimit). estimateGas + 30%
  // reflects true cost; the 120k/user fallback covers estimateGas hiccups.
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
