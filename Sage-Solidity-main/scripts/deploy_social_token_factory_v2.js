/**
 * Corrected SocialTokenFactory (audit round 3): sell() restores
 * realTokenReserves (fixes premature/over-seeded graduation) and _graduate()
 * skims any pre-donation to the pair before seeding (front-run defense).
 *
 * Constructor params read from the live/old factory (0xeF0c6F34...) so the new
 * one has an identical curve shape / Uniswap wiring. FUTURE token launches
 * point here; the existing SAGE token stays on the old factory (its curve
 * state lives there and can't be moved).
 *
 *   npx hardhat run scripts/deploy_social_token_factory_v2.js --network robinhood
 */
const hre = require("hardhat");

const TREASURY = "0x3E099aF007CaB8233D44782D8E6fe80FECDC321e";
const INITIAL_VIRTUAL_ETH = "2000000000000000000"; // 2 ETH (matches old factory)
const UNISWAP_FACTORY = "0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f";
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("deployer:", deployer.address);

  const block = await hre.ethers.provider.getBlock("latest");
  const gasPrice = block.baseFeePerGas.mul(150).div(100);

  const Factory = await hre.ethers.getContractFactory("SocialTokenFactory");
  const factory = await Factory.deploy(TREASURY, INITIAL_VIRTUAL_ETH, UNISWAP_FACTORY, WETH, { gasPrice, type: 0 });
  await factory.deployed();
  console.log("New SocialTokenFactory:", factory.address);

  // sanity: read back params so the new factory is provably identical-shape
  console.log("  treasury:         ", await factory.treasury());
  console.log("  initialVirtualEth:", (await factory.initialVirtualEth()).toString());
  console.log("  uniswapFactory:   ", await factory.uniswapFactory());
  console.log("  weth:             ", await factory.weth());
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
