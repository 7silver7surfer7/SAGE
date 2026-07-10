const hre = require("hardhat");
const ethers = hre.ethers;
const CONTRACTS = require('../contracts.js');

async function main() {
    const lotteryAddress = CONTRACTS[hre.network.name]["lotteryAddress"];
    const lotteryUpgraded = await upgrades.upgradeProxy(lotteryAddress, Lottery);
    await lotteryUpgraded.deployed();
    console.log("Lottery upgraded at:", lotteryUpgraded.address);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error.stack);
        process.exit(1);
    });
