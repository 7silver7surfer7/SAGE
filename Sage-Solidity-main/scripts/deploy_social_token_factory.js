/**
 * Redeploy SocialTokenFactory (v9: pump.fun dynamic fees (mcap-tiered)). Reuses the live factory's
 * constructor params so the curve economics stay identical.
 *
 *   npx hardhat run scripts/deploy_social_token_factory.js --network robinhoodTestnet
 */
const hre = require('hardhat');

const OLD_FACTORY = '0xe86E9163d998f9Ed762765956339A222Ad9Ef4fE'; // v6

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) throw new Error('set DEPLOYER_PK');
  console.log('deployer:', deployer.address);

  // Robinhood Chain rejects EIP-1559 txs — pin legacy gasPrice
  const fee = await hre.ethers.provider.getFeeData();
  const overrides = { gasPrice: fee.gasPrice };

  const old = await hre.ethers.getContractAt('SocialTokenFactory', OLD_FACTORY);
  const treasury = await old.treasury();
  const initialVirtualEth = await old.initialVirtualEth();
  console.log('reusing params — treasury:', treasury, 'initialVirtualEth:', initialVirtualEth.toString());

  const UNISWAP_FACTORY = '0xDfB9F8A7eF56C39C1eaE28f502b754321A82a625';
  const WETH = '0xC433C2fb24456290625217e297D9C5db1762a82f';
  const F = await hre.ethers.getContractFactory('SocialTokenFactory');
  const factory = await F.deploy(treasury, initialVirtualEth, UNISWAP_FACTORY, WETH, overrides);
  await factory.deployed();
  console.log('SocialTokenFactory v9:', factory.address);
  console.log('→ update SOCIAL_TOKEN_FACTORY_ADDRESS in Sage-UI-main/src/constants/config.ts');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
