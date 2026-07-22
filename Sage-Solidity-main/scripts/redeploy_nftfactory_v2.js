/**
 * Second NFTFactory redeploy today — picks up SageNFT.sol's two newest
 * fixes (setArtistShare bound, corrected royalty comments), which are
 * embedded into NFTFactory's own creation bytecode via `new SageNFT(...)`.
 * Confirmed zero NewNFTContract events on the current factory since this
 * morning's redeploy — nothing to lose by replacing it again.
 *
 *   npx hardhat run scripts/redeploy_nftfactory_v2.js --network robinhood
 */
const hre = require("hardhat");

const STORAGE_ADDRESS = "0x43E26D8B5c559DECb09d65F325e1405589775BA2";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("deployer:", deployer.address);

  const block = await hre.ethers.provider.getBlock("latest");
  const gasPrice = block.baseFeePerGas.mul(150).div(100);

  const NFTFactory = await hre.ethers.getContractFactory("NFTFactory");
  const nftFactory = await NFTFactory.deploy(STORAGE_ADDRESS, { gasPrice, type: 0 });
  await nftFactory.deployed();
  console.log("New NFTFactory:", nftFactory.address);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
