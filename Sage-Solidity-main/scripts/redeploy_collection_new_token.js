/**
 * SageCollection was missed during the earlier SAGE token migration — its
 * `token` still pointed at the old, retired SAGE ERC20. Collection #1 (the
 * only live collection, now sold out 100/100) is priced in free ETH so it
 * never touched the stale token reference; this only matters for future
 * SAGE-priced collections, but is worth closing now that #1 is complete and
 * safe to leave orphaned at its own address (the DB records each collection's
 * contract address per-row — CollectionMint.contractAddress — so #1 keeps
 * resolving correctly regardless of what the new global default becomes).
 *
 * nftDeployer is deliberately left unset (address(0)) — the deployed source
 * already includes createCollectionWithNewNft (self-serve collection
 * creation, live on testnet since 2026-07-14) but shipping that to
 * production is a separate decision not made here; leaving nftDeployer
 * unset keeps it dormant exactly like the current production contract.
 *
 *   npx hardhat run scripts/redeploy_collection_new_token.js --network robinhood
 */
const hre = require("hardhat");

const STORAGE_ADDRESS = "0x43E26D8B5c559DECb09d65F325e1405589775BA2";
const ASH_ADDRESS = "0x14561006002e8f76E68EC69e6A32527730bb73c8";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("deployer:", deployer.address);

  const block = await hre.ethers.provider.getBlock("latest");
  const gasPrice = block.baseFeePerGas.mul(150).div(100);

  const Collection = await hre.ethers.getContractFactory("SageCollection");
  const collection = await Collection.deploy(STORAGE_ADDRESS, ASH_ADDRESS, { gasPrice, type: 0 });
  await collection.deployed();
  console.log("New SageCollection:", collection.address);

  const token = await collection.token();
  console.log("token():", token);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
