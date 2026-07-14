/**
 * Closes the spoofable-artist-check vulnerability found in a security audit:
 * onlyAdminOrArtist trusted msg.sender == nftContract.artist() with no check
 * that nftContract is actually a real, deployed SageNFT — anyone could point
 * it at a two-line fake contract reporting themselves as the artist and pass
 * the check trivially, then siphon real bidder/minter funds through it.
 *
 * Fix: onlyAdminOrArtist's artist branch now also requires nftContract's
 * runtime bytecode to match a trusted reference SageNFT's codehash (see
 * _isTrustedNft in each contract). Auction upgrades in place (UUPS, same
 * address). SAGEOpenEdition/SageCollection are plain contracts — redeployed
 * fresh, new addresses (matches the pattern from the earlier self-serve
 * permission redeploy this session).
 *
 *   npx hardhat run scripts/redeploy_nft_registry_fix.js --network robinhoodTestnet
 */
const hre = require("hardhat");

const STORAGE_ADDRESS = "0x43E26D8B5c559DECb09d65F325e1405589775BA2";
const ASH_ADDRESS = "0x5498Ab846Bc64819eB4Fa8c1A76d7DDef594AA0B";
const REWARDS_ADDRESS = "0x5349d0cdCA3954CEfaa69eD00A6C370E1c5818FC";
const AUCTION_PROXY_ADDRESS = "0x2ee616D15f09eBB6d3D8c0Fe3F5eE42A461230bD";
// a real, already-deployed SageNFT on this chain — used purely as a codehash
// reference by _isTrustedNft, never called into for its data
const TRUSTED_NFT_REFERENCE = "0xfFb4b189740A6C9BCad3a6C5ae4Db42e7f57FeBd";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("deployer:", deployer.address);
  const fee = await hre.ethers.provider.getFeeData();
  const gasPrice = fee.gasPrice;

  const storage = await hre.ethers.getContractAt("SageStorage", STORAGE_ADDRESS, deployer);
  const key = (s) => hre.ethers.utils.solidityKeccak256(["string"], [s]);

  // 1) Auction — UUPS upgrade in place, same address
  console.log("\n== Upgrading Auction (UUPS) ==");
  const Auction = await hre.ethers.getContractFactory("Auction");
  const upgraded = await hre.upgrades.upgradeProxy(AUCTION_PROXY_ADDRESS, Auction);
  await upgraded.deployed();
  console.log("Auction upgraded at (same address):", upgraded.address);
  await (await upgraded.setTrustedNftReference(TRUSTED_NFT_REFERENCE, { gasPrice })).wait();
  console.log("Auction.trustedNftReference set");

  // 2) SAGEOpenEdition — fresh deploy (not upgradeable)
  console.log("\n== Deploying new SAGEOpenEdition ==");
  const OpenEdition = await hre.ethers.getContractFactory("SAGEOpenEdition");
  const openEdition = await OpenEdition.deploy(
    REWARDS_ADDRESS,
    deployer.address, // _admin — also the points-signer/oracle, matches original deploy
    STORAGE_ADDRESS,
    ASH_ADDRESS,
    { gasPrice }
  );
  await openEdition.deployed();
  console.log("New SAGEOpenEdition:", openEdition.address);
  await (await openEdition.setTrustedNftReference(TRUSTED_NFT_REFERENCE, { gasPrice })).wait();
  console.log("SAGEOpenEdition.trustedNftReference set");

  // 3) SageCollection — fresh deploy (not upgradeable)
  console.log("\n== Deploying new SageCollection ==");
  const Collection = await hre.ethers.getContractFactory("SageCollection");
  const collection = await Collection.deploy(STORAGE_ADDRESS, ASH_ADDRESS, { gasPrice });
  await collection.deployed();
  console.log("New SageCollection:", collection.address);
  await (await collection.setTrustedNftReference(TRUSTED_NFT_REFERENCE, { gasPrice })).wait();
  console.log("SageCollection.trustedNftReference set");

  // 4) Wire roles — same grants the original full deploy makes for these
  console.log("\n== Granting roles ==");
  await (await storage.grantRole(key("role.points"), openEdition.address, { gasPrice })).wait();
  await (await storage.grantRole(key("role.minter"), openEdition.address, { gasPrice })).wait();
  await (await storage.grantRole(key("role.minter"), collection.address, { gasPrice })).wait();
  console.log("Granted role.points + role.minter to OpenEdition, role.minter to Collection");

  console.log("\n=== DONE ===");
  console.log("AUCTION_ADDRESS (unchanged):", upgraded.address);
  console.log("OPENEDITION_ADDRESS (new):  ", openEdition.address);
  console.log("COLLECTION_ADDRESS (new):  ", collection.address);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
