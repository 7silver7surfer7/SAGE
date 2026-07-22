const { ethers, upgrades } = require("hardhat");

const AUCTION_ADDRESS = "0x83Eac0DCfd0bC5D52Edf4e631CdDb6C0e6438E03";

async function main() {
    const Auction = await ethers.getContractFactory("Auction");
    const upgraded = await upgrades.upgradeProxy(AUCTION_ADDRESS, Auction);
    await upgraded.deployed();
    console.log("Auction upgraded at:", upgraded.address);
    const implAddress = await upgrades.erc1967.getImplementationAddress(AUCTION_ADDRESS);
    console.log("New implementation:", implAddress);
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error.stack);
        process.exit(1);
    });
