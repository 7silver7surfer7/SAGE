/**
 * Second audit-fix deploy batch. Each of these five contracts is plain
 * (non-upgradeable), verified zero-live-activity before this ran, so a
 * fresh deploy + reference update is safe with nothing to migrate:
 *
 *  - Marketplace: royaltyInfo() reentrancy fix (view interface + nonReentrant)
 *  - SAGEOpenEdition: checked transferFrom in batchMint's SAGE-token path
 *  - SageSwapRouter: fee cap in setFeeTiers (fee tiers auto-seed identical
 *    to live values via the constructor's hardcoded defaults — confirmed
 *    the live router never had setFeeTiers called past construction)
 *  - SageConfig: bounds check on share.primaryArtist (currently 0/unset,
 *    nothing to carry over) — repointed via SageStorage.setAddress
 *    (onlyAdmin, not multisig)
 *  - NFTFactory: onlyMultisig fix (same bug class just patched in Auction).
 *    Has exactly one live registered artist (0x20ef0B30...) that needs
 *    carrying over via setArtistContract on the new factory — that call is
 *    NOW correctly multisig-gated, so it is NOT done here; it's queued for
 *    the multisig browser tool alongside the Lottery v3 upgrade.
 *
 *   npx hardhat run scripts/redeploy_audit_fixes_batch.js --network robinhood
 */
const hre = require("hardhat");

const STORAGE_ADDRESS = "0x43E26D8B5c559DECb09d65F325e1405589775BA2";
const ASH_ADDRESS = "0x14561006002e8f76E68EC69e6A32527730bb73c8";
const REWARDS_ADDRESS = "0x652595ffD447513DcA1B5e532618Af60C8791E60";
const SOCIAL_TOKEN_FACTORY_ADDRESS = "0xeF0c6F3461A373B4b6703EeBc5d44bF3885a200f";
const WETH_ADDRESS = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const TREASURY_ADDRESS = "0x3E099aF007CaB8233D44782D8E6fe80FECDC321e";

async function withGas() {
  const block = await hre.ethers.provider.getBlock("latest");
  const gasPrice = block.baseFeePerGas.mul(150).div(100);
  return { gasPrice, type: 0 };
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("deployer:", deployer.address);

  const storage = await hre.ethers.getContractAt("SageStorage", STORAGE_ADDRESS, deployer);
  const key = (s) => hre.ethers.utils.solidityKeccak256(["string"], [s]);

  console.log("\n== Marketplace ==");
  const Marketplace = await hre.ethers.getContractFactory("Marketplace");
  const marketplace = await Marketplace.deploy(STORAGE_ADDRESS, ASH_ADDRESS, await withGas());
  await marketplace.deployed();
  console.log("New Marketplace:", marketplace.address);
  await (await storage.setAddress(key("address.marketplace"), marketplace.address, await withGas())).wait();
  console.log("Registered address.marketplace ->", marketplace.address);

  console.log("\n== SAGEOpenEdition ==");
  const OpenEdition = await hre.ethers.getContractFactory("SAGEOpenEdition");
  const openEdition = await OpenEdition.deploy(
    REWARDS_ADDRESS,
    deployer.address, // _admin — also the points-signer/oracle, matches original deploy
    STORAGE_ADDRESS,
    ASH_ADDRESS,
    await withGas()
  );
  await openEdition.deployed();
  console.log("New SAGEOpenEdition:", openEdition.address);

  console.log("\n== SageSwapRouter ==");
  const SwapRouter = await hre.ethers.getContractFactory("SageSwapRouter");
  const swapRouter = await SwapRouter.deploy(
    SOCIAL_TOKEN_FACTORY_ADDRESS,
    WETH_ADDRESS,
    TREASURY_ADDRESS,
    await withGas()
  );
  await swapRouter.deployed();
  console.log("New SageSwapRouter:", swapRouter.address);

  console.log("\n== SageConfig ==");
  const Config = await hre.ethers.getContractFactory("SageConfig");
  const config = await Config.deploy(STORAGE_ADDRESS, await withGas());
  await config.deployed();
  console.log("New SageConfig:", config.address);
  await (await storage.setAddress(key("address.config"), config.address, await withGas())).wait();
  console.log("Registered address.config ->", config.address);

  console.log("\n== NFTFactory ==");
  const NFTFactory = await hre.ethers.getContractFactory("NFTFactory");
  const nftFactory = await NFTFactory.deploy(STORAGE_ADDRESS, await withGas());
  await nftFactory.deployed();
  console.log("New NFTFactory:", nftFactory.address);

  console.log("\n=== DONE ===");
  console.log(JSON.stringify({
    MARKETPLACE_ADDRESS: marketplace.address,
    OPENEDITION_ADDRESS: openEdition.address,
    SAGE_SWAP_ROUTER_ADDRESS: swapRouter.address,
    SAGE_CONFIG_ADDRESS: config.address,
    NFTFACTORY_ADDRESS: nftFactory.address,
  }, null, 2));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
