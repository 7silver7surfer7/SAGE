/**
 * Deploy SageSwapRouter — post-graduation trading with creator revenue share.
 * CURVE_FACTORY must be THIS network's SocialTokenFactory (deploy that
 * first) — was hardcoded to testnet's, which would silently wire mainnet's
 * router at a factory that doesn't exist on that chain. WETH was likewise
 * testnet-only; mainnet's confirmed on-chain via the live SAGE/WETH pair.
 *
 *   CURVE_FACTORY=0x... npx hardhat run scripts/deploy_sage_swap_router.js --network robinhoodTestnet
 *   CURVE_FACTORY=0x... npx hardhat run scripts/deploy_sage_swap_router.js --network robinhood
 */
const hre = require('hardhat');
const WETH_BY_NETWORK = {
  robinhoodTestnet: '0xC433C2fb24456290625217e297D9C5db1762a82f',
  robinhood: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73', // confirmed via live SAGE/WETH pair.token1()
};
const TREASURY = '0x3E099aF007CaB8233D44782D8E6fe80FECDC321e'; // shared multisig, same on both networks

async function main() {
  const CURVE_FACTORY = process.env.CURVE_FACTORY;
  if (!CURVE_FACTORY) throw new Error('set CURVE_FACTORY to this network\'s just-deployed SocialTokenFactory address');
  const WETH = WETH_BY_NETWORK[hre.network.name];
  if (!WETH) throw new Error(`no WETH configured for network ${hre.network.name}`);
  console.log('network:', hre.network.name, '| CURVE_FACTORY:', CURVE_FACTORY, '| WETH:', WETH);

  const fee = await hre.ethers.provider.getFeeData();
  const R = await hre.ethers.getContractFactory('SageSwapRouter');
  const r = await R.deploy(CURVE_FACTORY, WETH, TREASURY, { gasPrice: fee.gasPrice });
  await r.deployed();
  console.log('SageSwapRouter:', r.address);
}
main().catch((e) => { console.error(e); process.exit(1); });
