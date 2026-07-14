/**
 * Ships the collection-drop transaction consolidation: what used to take an
 * artist/admin FOUR separate wallet confirmations (deploy dedicated NFT,
 * setDefaultRoyalty, createCollection, setCollectionArtistShare) now takes
 * ONE — createCollectionWithNewNft() does all of it atomically.
 *
 * SageNFT's constructor gained a 6th param (defaultRoyaltyBps stamped at
 * deploy) and SageCollection embeds a `new SageNFT(...)` call for its new
 * one-tx path — both are source changes to non-upgradeable contracts, so
 * this is a fresh deploy of SageCollection at a NEW address (SageNFT itself
 * isn't a standalone deployed contract; only instances of it are, created on
 * demand by NFTFactory or, now, DedicatedNftDeployer).
 *
 * Embedding `new SageNFT(...)` directly in SageCollection blew Spurious
 * Dragon's 24,576-byte contract-size limit (26,572 bytes) — SageNFT's entire
 * creation bytecode gets bundled into whichever contract calls `new` on it.
 * Fix: a tiny standalone DedicatedNftDeployer contract that SageCollection
 * calls into instead, keeping SageCollection's own bytecode small (8.6% of
 * the limit after this change).
 *
 * carries over the trustedNftReference codehash check from the earlier
 * spoofable-artist-check fix (only relevant to the existing createCollection
 * path — createCollectionWithNewNft's msg.sender IS the artist by
 * construction, so it doesn't need that check).
 *
 *   npx hardhat run scripts/redeploy_collection_one_tx_mint.js --network robinhoodTestnet
 */
const hre = require("hardhat");

const STORAGE_ADDRESS = "0x43E26D8B5c559DECb09d65F325e1405589775BA2";
const ASH_ADDRESS = "0x5498Ab846Bc64819eB4Fa8c1A76d7DDef594AA0B";
// a real, already-deployed SageNFT on this chain — used purely as a codehash
// reference by _isTrustedNft (createCollection path only), never called into
const TRUSTED_NFT_REFERENCE = "0xfFb4b189740A6C9BCad3a6C5ae4Db42e7f57FeBd";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("deployer:", deployer.address);
  const fee = await hre.ethers.provider.getFeeData();
  const gasPrice = fee.gasPrice;

  const storage = await hre.ethers.getContractAt("SageStorage", STORAGE_ADDRESS, deployer);
  const key = (s) => hre.ethers.utils.solidityKeccak256(["string"], [s]);

  // 1) DedicatedNftDeployer — new, standalone, tiny
  console.log("\n== Deploying DedicatedNftDeployer ==");
  const Deployer = await hre.ethers.getContractFactory("DedicatedNftDeployer");
  const nftDeployer = await Deployer.deploy({ gasPrice });
  await nftDeployer.deployed();
  console.log("DedicatedNftDeployer:", nftDeployer.address);

  // 2) SageCollection — fresh deploy (not upgradeable, constructor unchanged)
  console.log("\n== Deploying new SageCollection ==");
  const Collection = await hre.ethers.getContractFactory("SageCollection");
  const collection = await Collection.deploy(STORAGE_ADDRESS, ASH_ADDRESS, { gasPrice });
  await collection.deployed();
  console.log("New SageCollection:", collection.address);
  await (await collection.setTrustedNftReference(TRUSTED_NFT_REFERENCE, { gasPrice })).wait();
  console.log("SageCollection.trustedNftReference set");
  await (await collection.setNftDeployer(nftDeployer.address, { gasPrice })).wait();
  console.log("SageCollection.nftDeployer set ->", nftDeployer.address);

  // 3) Wire role.minter — same grant the original full deploy makes
  console.log("\n== Granting roles ==");
  await (await storage.grantRole(key("role.minter"), collection.address, { gasPrice })).wait();
  console.log("Granted role.minter to Collection");

  console.log("\n=== DONE ===");
  console.log("COLLECTION_ADDRESS (new):    ", collection.address);
  console.log("NFT_DEPLOYER_ADDRESS (new):  ", nftDeployer.address);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
