/**
 * ETH-currency rollout for the UUPS games:
 *  - Auction: upgraded in place (deployer holds DEFAULT_ADMIN on SageStorage,
 *    which is what Auction._authorizeUpgrade checks).
 *  - Lottery: _authorizeUpgrade is strict-multisig, which is a hardware
 *    wallet — so we only prepareUpgrade (validates the storage layout and
 *    deploys the new implementation) and print the address for the
 *    deploy/upgrade-lottery.html browser page to call upgradeTo with.
 */
const { ethers, upgrades } = require("hardhat");
const CONTRACTS = require("../contracts.js");

async function main() {
    const net = require("hardhat").network.name;
    const auctionAddress = CONTRACTS[net].auctionAddress;
    const lotteryAddress = CONTRACTS[net].lotteryAddress;

    const Auction = await ethers.getContractFactory("Auction");
    console.log("Upgrading Auction proxy at", auctionAddress, "...");
    const auction = await upgrades.upgradeProxy(auctionAddress, Auction);
    await auction.deployed();
    console.log("Auction upgraded. NATIVE_CURRENCY sentinel:", await auction.NATIVE_CURRENCY());

    const Lottery = await ethers.getContractFactory("Lottery");
    console.log("Preparing Lottery upgrade for proxy at", lotteryAddress, "...");
    const newImpl = await upgrades.prepareUpgrade(lotteryAddress, Lottery);
    console.log("Lottery NEW IMPLEMENTATION deployed at:", newImpl);
    console.log("-> multisig must call upgradeTo(" + newImpl + ") on the proxy");
}

main()
    .then(() => process.exit(0))
    .catch(e => {
        console.error(e);
        process.exit(1);
    });
