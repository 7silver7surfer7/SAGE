/**
 * Redeploy SocialTokenFactory (v4: multiple launches per creator — tokenOf
 * keeps the FIRST token as the profile token). Reuses the live factory's
 * constructor params so the curve economics stay identical.
 *
 *   npx hardhat run scripts/deploy_social_token_factory.js --network robinhoodTestnet
 */
const hre = require('hardhat');

const OLD_FACTORY = '0x081fA456c70076A1826C9287a7B5ed48bdEb0131';

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

  const F = await hre.ethers.getContractFactory('SocialTokenFactory');
  const factory = await F.deploy(treasury, initialVirtualEth, overrides);
  await factory.deployed();
  console.log('SocialTokenFactory v4:', factory.address);
  console.log('→ update SOCIAL_TOKEN_FACTORY_ADDRESS in Sage-UI-main/src/constants/config.ts');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
