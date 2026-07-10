const hre = require("hardhat");
const ethers = hre.ethers;
const CONTRACTS = require('../contracts.js');

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const lotteryAddress = CONTRACTS[hre.network.name]["lotteryAddress"];
const nftAddress = CONTRACTS[hre.network.name]["nftAddress"];

async function main() {
    await hre.run('compile');

    const lotteryId = parseInt(process.argv.slice(2)[0]);
    if (isNaN(lotteryId)) {
        throw new Error("must provide the lottery id");
    }
    const newEndTime = parseInt(process.argv.slice(2)[1]);
    if (isNaN(newEndTime)) {
        throw new Error("must provide the new close time as a number");
    }

    const Lottery = await ethers.getContractFactory("Lottery");
    const lottery = await Lottery.attach(lotteryAddress);

    const tx = await lottery.changeCloseTime(lotteryId, newEndTime);
    const receipt = await tx.wait();
    console.log(receipt);

    if (receipt.status !== 1) {
        throw new Error("transaction failed");
    }

    await prisma.lottery.updateMany({
        where: {
            collectionId: lotteryId
        },
        data: {
            endTime: newEndTime
        },
    });

}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error.stack);
        process.exit(1);
    });