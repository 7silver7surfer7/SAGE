/**
 * Deploy SagePoints v2 (streaming pixel accrual vs SAGE balance).
 *   npx hardhat run scripts/deploy_sage_points.js --network robinhoodTestnet
 *   npx hardhat run scripts/deploy_sage_points.js --network robinhood
 *
 * SAGE_TOKEN is per-network — was hardcoded to the testnet address, which
 * would silently point mainnet's SagePoints at a token that doesn't exist on
 * that chain (this script was never actually run against `robinhood` before).
 */
const hre = require('hardhat');
const SAGE_TOKEN_BY_NETWORK = {
  robinhoodTestnet: '0x5498Ab846Bc64819eB4Fa8c1A76d7DDef594AA0B',
  robinhood: '0x08deaa8250beAeD65366fbbde0088E76261637bA',
};

async function main() {
  const SAGE_TOKEN = SAGE_TOKEN_BY_NETWORK[hre.network.name];
  if (!SAGE_TOKEN) throw new Error(`no SAGE_TOKEN configured for network ${hre.network.name}`);
  console.log('network:', hre.network.name, '| SAGE_TOKEN:', SAGE_TOKEN);
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
