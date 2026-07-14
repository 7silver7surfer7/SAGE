/**
 * Raise the SagePoints whale cap to 1,000,000 SAGE (rate stays 0.25 pixels/SAGE/day,
 * so max daily accrual becomes 250,000 pixels, matching the updated reward copy).
 *   npx hardhat run scripts/set_points_economics.js --network robinhoodTestnet
 */
const hre = require('hardhat');
const SAGE_POINTS = '0x2CbBc5f92B1b0bc7Dea43b894C94B59B3a8e2d36';

async function main() {
  const [signer] = await hre.ethers.getSigners();
  const fee = await hre.ethers.provider.getFeeData(); // legacy gas — Robinhood rejects EIP-1559
  const points = await hre.ethers.getContractAt('SagePoints', SAGE_POINTS, signer);
  const before = await points.economics();
  console.log('before: rateScaled', before.rateScaled.toString(), 'capSage', before.capSage.toString());
  const tx = await points.setEconomics(25, 1_000_000, false, { gasPrice: fee.gasPrice });
  console.log('tx:', tx.hash);
  await tx.wait();
  const after = await points.economics();
  console.log('after: rateScaled', after.rateScaled.toString(), 'capSage', after.capSage.toString());
}
main().catch((e) => { console.error(e); process.exit(1); });
