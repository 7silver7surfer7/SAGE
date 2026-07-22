/**
 * Redeploys SocialNFTLauncher to fix a deployed/source mismatch: the live
 * contract at 0x2D3369CbD7a79C3E681A7E598F67Ad3937659161 predates commit
 * 4cf5453 ("SAGE Social: ZIP collection mints + Filebase..."), which added a
 * 7th `bool isCollection` param to the EditionCreated event. The deployed
 * bytecode still emits the OLD 6-param event
 * (EditionCreated(address,address,string,string,uint256,uint256)), so every
 * client using the current ABI silently fails to find the event in the
 * receipt (topic0 mismatch, no revert) after every single/collection edition
 * launch — this is what broke the "Poppy Field" launch and blocks Mint
 * testing entirely.
 *
 * Preserves the existing treasury address (queried live off the current
 * deployed contract before writing this script): 0x3E099aF007CaB8233D44782D8E6fe80FECDC321e
 *
 * Not upgradeable — fresh deploy, new address. After this runs:
 *   1. Update SOCIAL_NFT_LAUNCHER_ADDRESS in Sage-UI-main/src/constants/config.ts
 *      (localhost/dev/staging blocks all point at the same testnet address).
 *   2. Update ADDR.SOCIAL_NFT_LAUNCHER in the test harness (test_drops.js).
 *   3. No on-chain data migration needed — the old launcher has no funds/state
 *      worth preserving beyond the treasury address itself (editions mapping
 *      resets, but no edition on the buggy contract ever succeeded in a way
 *      that recorded correctly downstream anyway).
 *
 *   npx hardhat run scripts/redeploy_social_nft_launcher.js --network robinhoodTestnet
 */
const hre = require("hardhat");

const TREASURY_ADDRESS = "0x3E099aF007CaB8233D44782D8E6fe80FECDC321e";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("deployer:", deployer.address);
  const fee = await hre.ethers.provider.getFeeData();
  const gasPrice = fee.gasPrice;

  console.log("\n== Deploying new SocialNFTLauncher ==");
  const SocialNFTLauncher = await hre.ethers.getContractFactory("SocialNFTLauncher");
  const launcher = await SocialNFTLauncher.deploy(TREASURY_ADDRESS, { gasPrice });
  await launcher.deployed();
  console.log("New SocialNFTLauncher:", launcher.address);

  const onChainTreasury = await launcher.treasury();
  console.log("Confirmed treasury():", onChainTreasury);

  console.log("\n=== DONE ===");
  console.log("SOCIAL_NFT_LAUNCHER_ADDRESS (new):", launcher.address);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
