/**
 * Seed SagePoints v3 with each holder's REAL historical pixels — the
 * time-weighted min(balance,cap) x rate integral from their first SAGE
 * purchase to now (computed in /tmp/sagepoints-seed.json). seedSettled sets
 * settled = amount, lastSync = now, checkpoint = current balance, so forward
 * accrual continues honestly with no gap and no double-count.
 *
 *   npx hardhat run scripts/seed_sage_points_v3.js --network robinhood
 */
const hre = require('hardhat');
const fs = require('fs');

const V3 = '0x78cBa250326a19891f67581e2bD8e0D1A11Eb07e';

async function main() {
  const seed = JSON.parse(fs.readFileSync('/tmp/sagepoints-seed.json', 'utf8'));
  const users = seed.map((s) => s[0]);
  const amounts = seed.map((s) => hre.ethers.BigNumber.from(String(s[1])));
  console.log('seeding', users.length, 'holders:', seed.map((s) => `${s[0].slice(0, 8)}=${s[1]}`).join(', '));

  const [deployer] = await hre.ethers.getSigners();
  const block = await hre.ethers.provider.getBlock('latest');
  const gasPrice = block.baseFeePerGas.mul(150).div(100);

  const sp = await hre.ethers.getContractAt('SagePoints', V3, deployer);
  const tx = await sp.seedSettled(users, amounts, { gasPrice, type: 0 });
  console.log('seedSettled tx:', tx.hash);
  await tx.wait();

  console.log('=== verify pointsOf on v3 ===');
  for (const [a] of seed) console.log(' ', a.slice(0, 10), (await sp.pointsOf(a)).toString());
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
