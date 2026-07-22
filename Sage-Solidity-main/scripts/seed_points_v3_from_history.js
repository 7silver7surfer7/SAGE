/**
 * Seed SagePoints v3 with each holder's REAL pixels earned from holding since
 * they bought — reconstructed from the SAGE token's Transfer history (the
 * bonding-curve token records every acquisition on-chain). For each holder:
 *   settled = time-weighted integral of min(balance, cap) x rate, from their
 *             first acquisition to now.
 * seedSettled() then starts honest forward accrual from now. Owner-only.
 *
 *   npx hardhat run scripts/seed_points_v3_from_history.js --network robinhood
 */
const hre = require('hardhat');
const { ethers } = hre;

const SAGE = '0x14561006002e8f76E68EC69e6A32527730bb73c8';
const V3 = '0x78cBa250326a19891f67581e2bD8e0D1A11Eb07e';
const FACTORY = '0xeF0c6F3461A373B4b6703EeBc5d44bF3885a200f';
const RATE_SCALED = 25; // 0.25/day
const CAP = 100000; // whole SAGE
const DAY = 86400;

async function main() {
  const [signer] = await ethers.getSigners();
  const p = signer.provider;

  // ── replay every SAGE transfer to build each address's balance-over-time ──
  const iface = new ethers.utils.Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']);
  const logs = await p.getLogs({ address: SAGE, topics: [ethers.utils.id('Transfer(address,address,uint256)')], fromBlock: 0, toBlock: 'latest' });
  const tsCache = {};
  for (const l of logs) if (!(l.blockNumber in tsCache)) tsCache[l.blockNumber] = (await p.getBlock(l.blockNumber)).timestamp;
  const evs = logs.map((l) => { const e = iface.parseLog(l); return { t: tsCache[l.blockNumber], from: e.args.from.toLowerCase(), to: e.args.to.toLowerCase(), val: e.args.value }; })
    .sort((a, b) => a.t - b.t);

  const now = (await p.getBlock('latest')).timestamp;
  const bal = {};      // wei balance
  const lastTs = {};   // last time this addr's balance changed
  const accrued = {};  // accumulated pixels (float, floored at end)
  const bump = (addr, upTo) => {
    if (bal[addr] && lastTs[addr] !== undefined && upTo > lastTs[addr]) {
      let whole = Number(ethers.utils.formatEther(bal[addr]));
      if (whole > CAP) whole = CAP;
      accrued[addr] = (accrued[addr] || 0) + (whole * RATE_SCALED * (upTo - lastTs[addr])) / (100 * DAY);
    }
    lastTs[addr] = upTo;
  };
  for (const e of evs) {
    bump(e.from, e.t); bump(e.to, e.t);
    if (e.from !== ethers.constants.AddressZero.toLowerCase()) bal[e.from] = (bal[e.from] || ethers.BigNumber.from(0)).sub(e.val);
    bal[e.to] = (bal[e.to] || ethers.BigNumber.from(0)).add(e.val);
  }
  // flush accrual to now for everyone still holding
  for (const a of Object.keys(bal)) bump(a, now);

  // real user holders = everyone with a positive balance, minus infra addrs
  const skip = new Set([FACTORY.toLowerCase(), ethers.constants.AddressZero.toLowerCase()]);
  const holders = Object.keys(bal).filter((a) => !skip.has(a) && bal[a] && bal[a].gt(0));

  const users = [], amounts = [];
  console.log('=== computed historical pixels (credit from buy) ===');
  for (const a of holders) {
    const pixels = Math.floor(accrued[a] || 0);
    const held = ((now - lastTsFirst(evs, a)) / DAY).toFixed(2);
    users.push(ethers.utils.getAddress(a));
    amounts.push(pixels);
    console.log(`${a}  SAGE ${Number(ethers.utils.formatEther(bal[a])).toLocaleString(undefined,{maximumFractionDigits:0}).padStart(12)}  held ${held}d  ->  ${pixels.toLocaleString()} pixels`);
  }

  // ── seed on-chain ──
  const block = await p.getBlock('latest');
  const gasPrice = block.baseFeePerGas.mul(150).div(100);
  const sp = await ethers.getContractAt('SagePoints', V3, signer);
  console.log('\nseeding', users.length, 'holders...');
  const tx = await sp.seedSettled(users, amounts, { gasPrice, type: 0 });
  await tx.wait();
  console.log('seeded, tx', tx.hash);

  console.log('\n=== verify pointsOf after seed ===');
  for (let i = 0; i < users.length; i++) {
    const pts = await sp.pointsOf(users[i]);
    console.log(users[i].slice(0, 10), '->', pts.toString(), 'pixels');
  }
}

// first time an address received tokens (its accrual start)
function lastTsFirst(evs, a) {
  for (const e of evs) if (e.to === a) return e.t;
  return evs[0].t;
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
