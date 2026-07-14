/**
 * Deploy SagePoints v2 (streaming pixel accrual vs SAGE balance).
 *   npx hardhat run scripts/deploy_sage_points.js --network robinhoodTestnet
 */
const hre = require('hardhat');
const SAGE_TOKEN = '0x5498Ab846Bc64819eB4Fa8c1A76d7DDef594AA0B';

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log('deployer/controller:', deployer.address);
  const fee = await hre.ethers.provider.getFeeData(); // legacy gas — Robinhood rejects EIP-1559
  const F = await hre.ethers.getContractFactory('SagePoints');
  const c = await F.deploy(SAGE_TOKEN, { gasPrice: fee.gasPrice });
  await c.deployed();
  console.log('SagePoints:', c.address);
  const eco = await c.economics();
  console.log('economics: rateScaled', eco.rateScaled.toString(), 'capSage', eco.capSage.toString());
}
main().catch((e) => { console.error(e); process.exit(1); });
