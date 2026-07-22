/**
 * Removes NFTFactory's onlyArtist gate on deployByArtist() — there was no
 * self-serve path to earn role.artist (only an admin could grant it via the
 * dashboard's "promote to artist" flow), which silently blocked the entire
 * admin drop pipeline (Auction/OpenEdition/ZIP collection) for every wallet
 * that hadn't been manually promoted. deployByArtist is now permissionless,
 * matching the social launcher's own createEdition/createCollection (also
 * no role gate) — createNFTContract's "one contract per artist" check is
 * still the only guard against redeploy-spam.
 *
 * Not upgradeable — fresh deploy, new address. Safe for existing artists:
 * the client checks the DB for a cached contract address BEFORE ever
 * consulting the factory on-chain (fetchOrCreateNftContract in
 * nftsReducer.ts), so already-onboarded artists are unaffected; only
 * brand-new artists hit the (now-open) factory.
 *
 *   npx hardhat run scripts/redeploy_nftfactory_open_artist.js --network robinhoodTestnet
 */
const hre = require("hardhat");

const STORAGE_ADDRESS = "0x43E26D8B5c559DECb09d65F325e1405589775BA2";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("deployer:", deployer.address);
  const fee = await hre.ethers.provider.getFeeData();
  const gasPrice = fee.gasPrice;

  console.log("\n== Deploying new NFTFactory ==");
  const NFTFactory = await hre.ethers.getContractFactory("NFTFactory");
  const factory = await NFTFactory.deploy(STORAGE_ADDRESS, { gasPrice });
  await factory.deployed();
  console.log("New NFTFactory:", factory.address);

  console.log("\n=== DONE ===");
  console.log("NFTFACTORY_ADDRESS (new):", factory.address);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
