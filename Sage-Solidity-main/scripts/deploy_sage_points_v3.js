/**
 * Deploy SagePoints v3 — checkpoint accrual (fixes v2's retroactive
 * deployedAt-baseline streaming, which made every never-synced whale show the
 * identical point total and was flash-balance farmable).
 *
 * Constructor now takes (sageToken, rateScaled, capSage). Keeping the same
 * economics as v2: rateScaled 25 (0.25 pixels/SAGE/day), capSage 100_000.
 * Deployer (== the server's POINTS_ORACLE controller wallet) becomes the
 * controller via the constructor, so no separate setController is needed.
 *
 *   npx hardhat run scripts/deploy_sage_points_v3.js --network robinhood
 */
const hre = require('hardhat');

const SAGE_TOKEN = '0x14561006002e8f76E68EC69e6A32527730bb73c8'; // mainnet SAGE
const RATE_SCALED = 25; // 0.25 pixels/SAGE/day
const CAP_SAGE = 100000; // whale cap, whole SAGE

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log('deployer:', deployer.address);

  const block = await hre.ethers.provider.getBlock('latest');
  const gasPrice = block.baseFeePerGas.mul(150).div(100);

  const F = await hre.ethers.getContractFactory('SagePoints');
  const c = await F.deploy(SAGE_TOKEN, RATE_SCALED, CAP_SAGE, { gasPrice, type: 0 });
  await c.deployed();
  console.log('SagePoints v3:', c.address);

  // sanity read-backs
  const eco = await c.economics();
  console.log('  sage:', await c.sage());
  console.log('  economics: rateScaled', eco.rateScaled.toString(), '| capSage', eco.capSage.toString());
  console.log('  controller(deployer):', await c.isController(deployer.address));
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
