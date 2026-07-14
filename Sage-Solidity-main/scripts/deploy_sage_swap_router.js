/**
 * Deploy SageSwapRouter — post-graduation trading with creator revenue share.
 *   npx hardhat run scripts/deploy_sage_swap_router.js --network robinhoodTestnet
 */
const hre = require('hardhat');
const CURVE_FACTORY = '0x3297f9CEe3e0858325e826CbFF8FDE04Ee36DC49'; // v9
const WETH = '0xC433C2fb24456290625217e297D9C5db1762a82f';
const TREASURY = '0x3E099aF007CaB8233D44782D8E6fe80FECDC321e';
async function main() {
  const fee = await hre.ethers.provider.getFeeData();
  const R = await hre.ethers.getContractFactory('SageSwapRouter');
  const r = await R.deploy(CURVE_FACTORY, WETH, TREASURY, { gasPrice: fee.gasPrice });
  await r.deployed();
  console.log('SageSwapRouter:', r.address);
}
main().catch((e) => { console.error(e); process.exit(1); });
