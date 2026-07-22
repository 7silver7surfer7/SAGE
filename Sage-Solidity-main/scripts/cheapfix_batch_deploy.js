/**
 * Cheap-fix audit batch (round 3):
 *  - Fresh NFTFactory embedding the fixed SageNFT template (withdraw()
 *    reentrancy guard + constructor artistShare<=10000 bound).
 *  - New Lottery implementation (setToken()->onlyMultisig, incoming
 *    transferFrom return checked). Deployed as a plain impl for the multisig
 *    to upgradeTo — this script does NOT call upgradeTo.
 *
 * Both are unprivileged deploys; they touch no live proxy or funds.
 *
 *   npx hardhat run scripts/cheapfix_batch_deploy.js --network robinhood
 */
const hre = require("hardhat");

const STORAGE_ADDRESS = "0x43E26D8B5c559DECb09d65F325e1405589775BA2";
const LOTTERY_PROXY = "0xfF1dF77766c5dbc3C440a8d70782406B32C0Fb54";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("deployer:", deployer.address);

  const block = await hre.ethers.provider.getBlock("latest");
  const gasPrice = block.baseFeePerGas.mul(150).div(100);

  console.log("\n== NFTFactory (embeds fixed SageNFT) ==");
  const NFTFactory = await hre.ethers.getContractFactory("NFTFactory");
  const nftFactory = await NFTFactory.deploy(STORAGE_ADDRESS, { gasPrice, type: 0 });
  await nftFactory.deployed();
  console.log("New NFTFactory:", nftFactory.address);

  console.log("\n== Lottery new implementation ==");
  const Lottery = await hre.ethers.getContractFactory("Lottery");
  const newImpl = await hre.upgrades.prepareUpgrade(LOTTERY_PROXY, Lottery);
  console.log("Lottery proxy:            ", LOTTERY_PROXY);
  console.log("Lottery new implementation:", newImpl);
  const iface = new hre.ethers.utils.Interface(["function upgradeTo(address)"]);
  console.log("upgradeTo() calldata:      ", iface.encodeFunctionData("upgradeTo", [newImpl]));

  console.log("\n=== DONE ===");
  console.log(JSON.stringify({ NFTFACTORY_ADDRESS: nftFactory.address, LOTTERY_NEW_IMPL: newImpl }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
