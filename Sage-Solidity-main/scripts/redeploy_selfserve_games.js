/**
 * Relaxes Auction/SAGEOpenEdition/SageCollection so a self-serve artist can
 * register their OWN game without on-chain admin rights (the createX
 * functions now accept msg.sender === nftContract.artist() as an
 * alternative to role.admin; the artist-share setters + setWhitelist got the
 * same treatment). Auction is a UUPS proxy — upgraded in place, same
 * address. SAGEOpenEdition/SageCollection are plain contracts — redeployed
 * fresh, new addresses (existing testnet drops on the old instances are
 * left as-is, unreachable from the new ones — accepted testnet tradeoff).
 *
 *   npx hardhat run scripts/redeploy_selfserve_games.js --network robinhoodTestnet
 */
const hre = require("hardhat");

const STORAGE_ADDRESS = "0x43E26D8B5c559DECb09d65F325e1405589775BA2";
const ASH_ADDRESS = "0x5498Ab846Bc64819eB4Fa8c1A76d7DDef594AA0B";
const REWARDS_ADDRESS = "0x5349d0cdCA3954CEfaa69eD00A6C370E1c5818FC";
const AUCTION_PROXY_ADDRESS = "0x2ee616D15f09eBB6d3D8c0Fe3F5eE42A461230bD";

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

  // 3) SageCollection — fresh deploy (not upgradeable)
  console.log("\n== Deploying new SageCollection ==");
  const Collection = await hre.ethers.getContractFactory("SageCollection");
  const collection = await Collection.deploy(STORAGE_ADDRESS, ASH_ADDRESS, { gasPrice });
  await collection.deployed();
  console.log("New SageCollection:", collection.address);

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
