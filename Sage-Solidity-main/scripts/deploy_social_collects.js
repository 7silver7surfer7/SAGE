/**
 * Deploys the shared SageNFT instance SAGE Social's collect-as-NFT feature
 * mints into (SOCIAL_COLLECTS_ADDRESS in Sage-UI-main/src/constants/config.ts).
 * No script existed for this before — the testnet instance was deployed ad
 * hoc. Constructor params mirror the live testnet instance exactly (read
 * on-chain: name "SAGE Social", symbol "SOCIAL", artist = the shared
 * multisig/treasury, artistShare 8333 = 83.33%, defaultRoyaltyBps 1000 = 10%).
 *
 * After this runs:
 *   1. Update SOCIAL_COLLECTS_ADDRESS in Sage-UI-main/src/constants/config.ts
 *      for this network's block.
 *   2. The server signer (POINTS_ORACLE_PK) must hold role.minter on this
 *      network's SageStorage — mintSocialCollectServerSide() calls
 *      safeMint() directly, gated by that GLOBAL (not per-contract) role.
 *
 *   npx hardhat run scripts/deploy_social_collects.js --network robinhoodTestnet
 *   npx hardhat run scripts/deploy_social_collects.js --network robinhood
 */
const hre = require('hardhat');

const STORAGE_ADDRESS = '0x43E26D8B5c559DECb09d65F325e1405589775BA2'; // same on both networks
const ARTIST = '0x3E099aF007CaB8233D44782D8E6fe80FECDC321e'; // shared multisig/treasury
const NAME = 'SAGE Social';
const SYMBOL = 'SOCIAL';
const ARTIST_SHARE = 8333; // 83.33%
const DEFAULT_ROYALTY_BPS = 1000; // 10%

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) throw new Error('set DEPLOYER_PK');
  console.log('deployer:', deployer.address, '| network:', hre.network.name);

  // Robinhood Chain rejects EIP-1559 txs — pin legacy gasPrice
  const fee = await hre.ethers.provider.getFeeData();
  const F = await hre.ethers.getContractFactory('SageNFT');
  const nft = await F.deploy(
    NAME,
    SYMBOL,
    STORAGE_ADDRESS,
    ARTIST,
    ARTIST_SHARE,
    DEFAULT_ROYALTY_BPS,
    { gasPrice: fee.gasPrice }
  );
  await nft.deployed();
  console.log('SOCIAL_COLLECTS_ADDRESS (new):', nft.address);
  console.log('→ update SOCIAL_COLLECTS_ADDRESS in Sage-UI-main/src/constants/config.ts');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
