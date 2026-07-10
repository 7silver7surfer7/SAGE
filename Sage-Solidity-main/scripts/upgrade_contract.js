const { ethers, upgrades } = require("hardhat");
const CONTRACTS = require("../contracts.js");

async function main() {
    const lotteryAddress = "0x4732D73D8526E4b05E2dEdaC1E65f7eC1F544686";
    const Lottery = await ethers.getContractFactory("Lottery");
    const lotteryUpgraded = await upgrades.upgradeProxy(
        lotteryAddress,
        Lottery
    );
    await lotteryUpgraded.deployed();
    console.log("Lottery upgraded at:", lotteryUpgraded.address);
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error.stack);
        process.exit(1);
    });
