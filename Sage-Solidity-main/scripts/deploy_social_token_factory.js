/**
 * Redeploy SocialTokenFactory (v9: pump.fun dynamic fees (mcap-tiered)). Reuses the live factory's
 * constructor params so the curve economics stay identical.
 *
 *   npx hardhat run scripts/deploy_social_token_factory.js --network robinhoodTestnet
 *   npx hardhat run scripts/deploy_social_token_factory.js --network robinhood
 *
 * UNISWAP_FACTORY/WETH were hardcoded to testnet addresses and read
 * treasury/initialVirtualEth from a testnet-only OLD_FACTORY via
 * getContractAt — both silently break on any network but testnet
 * (getContractAt binds to whatever network hardhat is currently pointed at,
 * so on mainnet it would try to read a contract that doesn't exist there).
 * Mainnet's Uniswap-fork factory/WETH were confirmed on-chain by reading the
 * live SAGE/WETH pair's factory()/token1() (0x4a223492...c5F38 on mainnet);
 * treasury/initialVirtualEth were confirmed by reading testnet's factory
 * directly over testnet's own RPC (treasury matches the shared multisig;
 * initialVirtualEth = 2 ETH, a pure economic constant, safe to reuse as-is).
 */
const hre = require('hardhat');

const PARAMS_BY_NETWORK = {
  robinhoodTestnet: {
    treasury: '0x3E099aF007CaB8233D44782D8E6fe80FECDC321e',
    initialVirtualEth: '2000000000000000000', // 2 ETH
    uniswapFactory: '0xDfB9F8A7eF56C39C1eaE28f502b754321A82a625',
    weth: '0xC433C2fb24456290625217e297D9C5db1762a82f',
  },
  robinhood: {
    treasury: '0x3E099aF007CaB8233D44782D8E6fe80FECDC321e',
    initialVirtualEth: '2000000000000000000', // 2 ETH — same curve economics as testnet
    uniswapFactory: '0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f', // confirmed via live SAGE/WETH pair.factory()
    weth: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73', // confirmed via live SAGE/WETH pair.token1()
  },
};

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) throw new Error('set DEPLOYER_PK');
  console.log('deployer:', deployer.address, '| network:', hre.network.name);

  const params = PARAMS_BY_NETWORK[hre.network.name];
  if (!params) throw new Error(`no params configured for network ${hre.network.name}`);
  const { treasury, initialVirtualEth, uniswapFactory: UNISWAP_FACTORY, weth: WETH } = params;
  console.log('treasury:', treasury, 'initialVirtualEth:', initialVirtualEth, 'uniswapFactory:', UNISWAP_FACTORY, 'weth:', WETH);

  // Robinhood Chain rejects EIP-1559 txs — pin legacy gasPrice
  const fee = await hre.ethers.provider.getFeeData();
  const overrides = { gasPrice: fee.gasPrice };

  const F = await hre.ethers.getContractFactory('SocialTokenFactory');
  const factory = await F.deploy(treasury, initialVirtualEth, UNISWAP_FACTORY, WETH, overrides);
  await factory.deployed();
  console.log('SocialTokenFactory:', factory.address);
  console.log('→ update SOCIAL_TOKEN_FACTORY_ADDRESS in Sage-UI-main/src/constants/config.ts');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
