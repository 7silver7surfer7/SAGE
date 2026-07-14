/**
 * Closes two more security-audit findings:
 *  - Marketplace signed offers didn't check the signed chainId against
 *    block.chainid — a signature valid on one chain (or a same-address
 *    fork/clone of this contract elsewhere) verified here regardless.
 *    Marketplace is a plain (non-upgradeable) contract, so this is a fresh
 *    deploy + re-registering its "address.marketplace" entry in SageStorage.
 *  - Lottery.getLotteryTickets wrote past the end of its own result array
 *    for any _from > 0 (out-of-bounds panic). Lottery is UUPS-upgradeable,
 *    so this upgrades in place at the same address.
 * Also fixed alongside: unchecked ERC20 .transfer()/.transferFrom() return
 * values in both contracts (Auction/SageNFT/Splitter/LegacySageNFT already
 * got the same treatment in an earlier commit this session, source-only —
 * SageNFT/LegacySageNFT aren't standalone deployed contracts needing a
 * redeploy of their own).
 *
 *   npx hardhat run scripts/redeploy_market_lottery_fix.js --network robinhoodTestnet
 */
const hre = require("hardhat");

const STORAGE_ADDRESS = "0x43E26D8B5c559DECb09d65F325e1405589775BA2";
const ASH_ADDRESS = "0x5498Ab846Bc64819eB4Fa8c1A76d7DDef594AA0B";
const LOTTERY_PROXY_ADDRESS = "0x7a7264BbDc1751C507f31cd5cec6e2b150F3725E";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("deployer:", deployer.address);
  const fee = await hre.ethers.provider.getFeeData();
  const gasPrice = fee.gasPrice;

  const storage = await hre.ethers.getContractAt("SageStorage", STORAGE_ADDRESS, deployer);
  const key = (s) => hre.ethers.utils.solidityKeccak256(["string"], [s]);

  // 1) Marketplace — fresh deploy (not upgradeable)
  console.log("\n== Deploying new Marketplace ==");
  const Marketplace = await hre.ethers.getContractFactory("Marketplace");
  const marketplace = await Marketplace.deploy(STORAGE_ADDRESS, ASH_ADDRESS, { gasPrice });
  await marketplace.deployed();
  console.log("New Marketplace:", marketplace.address);
  await (await storage.setAddress(key("address.marketplace"), marketplace.address, { gasPrice })).wait();
  console.log("Registered address.marketplace ->", marketplace.address);

  // 2) Lottery — UUPS upgrade in place, same address
  console.log("\n== Upgrading Lottery (UUPS) ==");
  const Lottery = await hre.ethers.getContractFactory("Lottery");
  const lotteryUpgraded = await hre.upgrades.upgradeProxy(LOTTERY_PROXY_ADDRESS, Lottery);
  await lotteryUpgraded.deployed();
  console.log("Lottery upgraded at (same address):", lotteryUpgraded.address);

  console.log("\n=== DONE ===");
  console.log("MARKETPLACE_ADDRESS (new):", marketplace.address);
  console.log("LOTTERY_ADDRESS (unchanged):", lotteryUpgraded.address);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
