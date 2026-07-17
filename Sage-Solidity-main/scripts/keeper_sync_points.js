/**
 * SagePoints v3 keeper — keeps on-chain pixel balances tracking real SAGE
 * holdings: accrue from purchase, stop on sale, bump on more buys.
 *
 * The SAGE ERC20 has no transfer hook, so the contract can't see a buy/sell on
 * its own. This keeper replays the token's Transfer history (min(balance,cap) x
 * rate, second-by-second — start-at-buy / stop-at-sale = the true accrual) and
 * writes each holder whose live balance has DRIFTED from its on-chain checkpoint
 * (i.e. bought or sold since the last sync) via seedSettled. Holders that
 * haven't traded are already accruing correctly on-chain and are skipped, so a
 * quiet run sends no transactions.
 *
 * STATELESS (no watermark file): detection is `liveBalance != checkpointSage`
 * read straight from the contract, so it's safe on ephemeral CI runners and
 * idempotent (re-derives the full truth from history each run).
 *
 * Env: POINTS_ORACLE_PK (or DEPLOYER_PK) — the controller/owner wallet.
 *
 *   node scripts/keeper_sync_points.js
 */
require('dotenv').config();
const { ethers } = require('ethers');

const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const CHAIN = 4663;
const SAGE = '0x14561006002e8f76E68EC69e6A32527730bb73c8';
const V3 = '0x78cBa250326a19891f67581e2bD8e0D1A11Eb07e';
const FACTORY = '0xeF0c6F3461A373B4b6703EeBc5d44bF3885a200f'.toLowerCase();
const RATE = 25; // rateScaled → 0.25/day
const CAP = 100000; // whole SAGE
const DAY = 86400;

const skip = new Set([FACTORY, ethers.constants.AddressZero.toLowerCase()]);

async function main() {
  const pk = process.env.POINTS_ORACLE_PK || process.env.DEPLOYER_PK;
  if (!pk) throw new Error('POINTS_ORACLE_PK (or DEPLOYER_PK) required');
  const p = new ethers.providers.StaticJsonRpcProvider(RPC, CHAIN);
  const w = new ethers.Wallet(pk, p);

  // ── replay the full SAGE transfer history → per-holder true accrual to now ──
  const iface = new ethers.utils.Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
  const logs = await p.getLogs({ address: SAGE, topics: [ethers.utils.id('Transfer(address,address,uint256)')], fromBlock: 0, toBlock: 'latest' });
  const ts = {};
  for (const l of logs) if (!(l.blockNumber in ts)) ts[l.blockNumber] = (await p.getBlock(l.blockNumber)).timestamp;
  const evs = logs.map((l) => { const e = iface.parseLog(l); return { t: ts[l.blockNumber], from: e.args.from.toLowerCase(), to: e.args.to.toLowerCase(), val: e.args.value }; })
    .sort((a, b) => a.t - b.t);
  const now = (await p.getBlock('latest')).timestamp;
  const bal = {}, last = {}, acc = {};
  const bump = (a, upTo) => {
    if (bal[a] && last[a] !== undefined && upTo > last[a]) {
      let whole = Number(ethers.utils.formatEther(bal[a]));
      if (whole > CAP) whole = CAP;
      acc[a] = (acc[a] || 0) + (whole * RATE * (upTo - last[a])) / (100 * DAY);
    }
    last[a] = upTo;
  };
  for (const e of evs) {
    bump(e.from, e.t); bump(e.to, e.t);
    if (e.from !== ethers.constants.AddressZero.toLowerCase()) bal[e.from] = (bal[e.from] || ethers.BigNumber.from(0)).sub(e.val);
    bal[e.to] = (bal[e.to] || ethers.BigNumber.from(0)).add(e.val);
  }
  for (const a of Object.keys(bal)) bump(a, now);

  const holders = Object.keys(bal).filter((a) => !skip.has(a) && bal[a].gt(0));

  // ── detect drift: live whole balance vs the contract's checkpoint ──
  const sp = new ethers.Contract(V3, [
    'function checkpointSage(address) view returns (uint256)',
    'function seedSettled(address[],uint256[]) external',
  ], w);
  const users = [], amounts = [];
  for (const a of holders) {
    const liveWhole = ethers.BigNumber.from(bal[a]).div(ethers.constants.WeiPerEther);
    const cp = await sp.checkpointSage(a);
    if (!cp.eq(liveWhole)) { // bought or sold since last sync
      users.push(ethers.utils.getAddress(a));
      amounts.push(Math.floor(acc[a] || 0));
    }
  }

  if (users.length === 0) {
    console.log(`keeper ${new Date(now * 1000).toISOString()}: all ${holders.length} holder(s) in sync; nothing to write.`);
    return;
  }

  const blk = await p.getBlock('latest');
  const gasPrice = blk.baseFeePerGas.mul(150).div(100);
  const tx = await sp.seedSettled(users, amounts, { gasPrice, type: 0, gasLimit: 200000 + users.length * 60000 });
  await tx.wait();
  console.log(`keeper ${new Date(now * 1000).toISOString()}: synced ${users.length} changed holder(s) [${users.map((u, i) => u.slice(0, 8) + '=' + amounts[i]).join(', ')}] tx ${tx.hash}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('keeper failed:', e.message); process.exit(1); });
