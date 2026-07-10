const BigNumber = require('bignumber.js');
const hre = require("hardhat");
const ethers = hre.ethers;
const deployer = ethers.getSigner().address;

const CONTRACTS = require('../contracts.js');
const createLogger = require("./logs.js");
const lotteryAddress = CONTRACTS[hre.network.name]["lotteryAddress"];
const nftAddress = CONTRACTS[hre.network.name]["nftAddress"];
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const logger = createLogger('urn_scripts', 'create_lotteries_from_db');
let nftContract;

async function main() {
    await hre.run('compile');
    const Lottery = await ethers.getContractFactory("Lottery");
    const lottery = await Lottery.attach(lotteryAddress);

    const NFT = await hre.ethers.getContractFactory("NFT");
    nftContract = await NFT.attach(nftAddress);
    // define a float value

    // find drops approved but not yet created on chain
    let drops = await fetchDropsReadyForBlockchain();

    for (const drop of drops) {
        // create new lottery and update DB with lotteryId
        await createLottery(drop, lottery);
    }
    logger.info("Finished creating lotteries succesfully")
}

async function createLottery(drop, lottery) {
    logger.info("Drop #id: " + drop.id);
    // percentage in base points (200 = 2%)
    let royaltyPercentageBasePoints = parseInt(drop.royaltyPercentage * 100);
    const tx = await lottery.createNewLottery(
        drop.costPerTicketPoints,
        drop.costPerTicketCoins,
        drop.startTime,
        drop.endTime,
        nftContract.address,
        drop.maxParticipants,
        drop.CreatedBy.walletAddress,
        drop.defaultPrizeId || 0,
        royaltyPercentageBasePoints,
        drop.metadataIpfsPath
    );
    const receipt = await tx.wait();
    drop.lotteryId = receipt.events[0].args[0];
    logger.info(`Lottery created with lotteryId: ${drop.lotteryId}`);
    drop.blockchainCreatedAt = new Date();
    await prisma.drop.update({
        where: {
            id: drop.id
        },
        data: {
            lotteryId: drop.lotteryId.toNumber(),
            blockchainCreatedAt: drop.blockchainCreatedAt
        }
    });
    logger.info("Created new lottery with #lotteryId: " + drop.lotteryId);
}

function exit(code) {
    prisma.$disconnect;
    process.exit(code);
}

main()
    .then(() => setTimeout(exit, 2000, 0))
    .catch((error) => {
        logger.error(error.stack);
        setTimeout(exit, 2000, 1);
    });

async function fetchDropsReadyForBlockchain() {
    return await prisma.drop.findMany(
        {
            where: {
                blockchainCreatedAt: {
                    equals: null
                },
                approvedAt: {
                    not: null
                }
            },
            include: {
                CreatedBy: true,
            }
        }
    );
}

