const hre = require("hardhat");
const ethers = hre.ethers;
require("dotenv").config();
const createLogger = require("./logs.js");
const CONTRACTS = require("../contracts.js");
const sendEmail = require("../util/email.js");
const fs = require("fs");

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const timer = ms => new Promise(res => setTimeout(res, ms));
let logger;

const baseUrl = process.env.BASE_URL;

async function main() {
    logger = createLogger(
        `sage_scripts_${hre.network.name}`,
        `monitor_events_${hre.network.name}`
    );
    logger.info("Starting monitor_events script");

    // let test = await getUserInfo("0x58a26F4048CdFd3785aD2139AeD336595af22fF5");
    // let nft = await getNFTInfo(3984);
    // let bigintPrice = ethers.BigNumber.from("900000000000000000");
    // let salePrice = bigintPrice / 1e18;

    // if (test.email) {
    //     sendEmail(
    //         test,
    //         "New NFT Sale",
    //         "NFT Sale",
    //         "Your NFT sale for " +
    //             salePrice +
    //             " ASH was a success, time to celebrate.",
    //         nft,
    //         `${baseUrl}artists/${test.username}`,
    //         "Visit your gallery",
    //         logger
    //     );
    // }
    const lotteryAddress = CONTRACTS[hre.network.name]["lotteryAddress"];
    const Lottery = await hre.ethers.getContractFactory("Lottery");
    const lottery = await Lottery.attach(lotteryAddress);

    const rewardAddress = CONTRACTS[hre.network.name]["rewardsAddress"];
    const Rewards = await hre.ethers.getContractFactory("Rewards");
    const rewards = await Rewards.attach(rewardAddress);

    const auctionAddress = CONTRACTS[hre.network.name]["auctionAddress"];
    const Auction = await hre.ethers.getContractFactory("Auction");
    const auction = await Auction.attach(auctionAddress);

    // const marketplaceAddress =
    //     CONTRACTS[hre.network.name]["marketplaceAddress"];
    // const Marketplace = await hre.ethers.getContractFactory("Marketplace");
    // const marketplace = await Marketplace.attach(marketplaceAddress);

    const rngAddress = CONTRACTS[hre.network.name]["randomnessAddress"];
    const RNG = await hre.ethers.getContractFactory("RNG");
    const rng = await RNG.attach(rngAddress);

    // listen to events
    // marketplace.on(
    //     "ListedNFTSold",
    //     async (seller, buyer, contractAddress, tokenId, price) => {
    //         logger.info(
    //             `EVENT ListedNFTSold: NFT ${tokenId}/${contractAddress} sold for ${price}`
    //         );
    //         let sellerInfo = await getUserInfo(seller);
    //         let salePrice = price / 1e18;
    //         let nft = await getNFTInfo(tokenId.toNumber());

    //         sendEmail(
    //             sellerInfo,
    //             "New NFT Sale",
    //             "NFT Sale",
    //             "Your NFT sale for " +
    //                 salePrice +
    //                 " ASH was a success, time to celebrate.",
    //             nft,
    //             `${baseUrl}artists/${sellerInfo.username}`,
    //             "Visit your gallery",
    //             logger
    //         );
    //     }
    // );

    lottery.on("LotteryStatusChanged", (lotteryId, stat) => {
        logger.info(
            `EVENT LotteryStatusChanged: Lottery ${lotteryId} status changed to ${stat}`
        );
    });

    rng.on("RequestNumbers", (lotteryId, requestId) => {
        logger.info(
            `EVENT RequestNumbers: Lottery ${lotteryId} requested random number with requestId ${requestId}`
        );
    });

    rng.on("ResponseReceived", requestId => {
        logger.info(`EVENT ResponseReceived: requestId ${requestId}`);
    });

    lottery.on(
        "TicketSold",
        (lotteryId, ticketNumber, participantAddress, tier) => {
            logger.info(
                `EVENT TicketSold: #${ticketNumber} sold for lottery ${lotteryId} for participant ${participantAddress} in tier ${tier}`
            );
        }
    );

    lottery.on("PrizeClaimed", (lotteryId, participantAddress, prizeId) => {
        logger.info(
            `EVENT PrizeClaimed: lottery ${lotteryId} prize claimed for participant ${participantAddress} with prizeId ${prizeId}`
        );
    });

    rewards.on(
        "PointsUsed",
        (participantAddress, amountUsed, amountRemaining) => {
            logger.info(
                `EVENT PointsUsed: participant ${participantAddress} used ${amountUsed} points, remaining ${amountRemaining}`
            );
        }
    );

    rewards.on("PointsEarned", (participantAddress, amount) => {
        logger.info(
            `EVENT PointsEarned: participant ${participantAddress} earned ${amount} points`
        );
    });

    auction.on(
        "AuctionCreated",
        (collectionId, auctionId, nftId, erc20Address) => {
            logger.info(
                `EVENT AuctionCreated: auction ${auctionId} created for collection ${collectionId} with nft ${nftId} and erc20 ${erc20Address}`
            );
        }
    );

    auction.on("AuctionSettled", async (auctionId, highestBidder, highestBid) => {
        logger.info(
            `EVENT AuctionSettled: auction ${auctionId} settled for highest bidder ${highestBidder} with bid ${highestBid}`
        );
        await prisma.auction.update({
            where: {
                id: auctionId
            },
            data: {
                winnerAddress: highestBidder,
                settled: true
            }
        });
    });

    auction.on(
        "BidPlaced",
        async (
            auctionId,
            highestBidder,
            previousBidder,
            highestBid,
            newEndTime
        ) => {
            let user = await getUserInfo(previousBidder);
            let bidValue = highestBid / 1e18;
            let auctionInfo = await getAuctionInfo(auctionId.toNumber());
            sendEmail(
                user,
                "Sage Auction - NEW BID",
                "New bid on auction",
                `The NFT "${auctionInfo.Nft.name}" received a new bid of ` +
                    bidValue +
                    ` ASH, but there's still time if you want it!`,
                auctionInfo.Nft,
                `${baseUrl}drops/${auctionInfo.Drop.id}`,
                "View",
                logger
            );
            logger.info(
                `EVENT BidPlaced: auction ${auctionId} received bid from ${highestBidder} for ${highestBid}. New end time ${newEndTime}`
            );
        }
    );

    let nftContracts = await getNFTContracts();
    const NFTContract = await hre.ethers.getContractFactory("SageNFT");
    for (contract of nftContracts) {
        let attachedContract = await NFTContract.attach(
            contract.contractAddress
        );
        // monitor nft contract events?
    }

    while (true) {
        await timer(60000);
    }
}

async function getNFTContracts() {
    return await prisma.nftContract.findMany({
        where: {
            contractAddress: {
                not: null
            }
        }
    });
}

async function getUserInfo(walletAddress) {
    let user = await prisma.user.findUnique({
        where: {
            walletAddress: walletAddress
        }
    });
    return user;
}

async function getNFTInfo(tokenId) {
    return await prisma.nft.findUnique({
        where: {
            id: tokenId
        }
    });
}

async function getAuctionInfo(auctionId) {
    let auction = await prisma.auction.findUnique({
        where: {
            id: auctionId
        },
        include: {
            Drop: true,
            Nft: true
        }
    });
    return auction;
}

// fs.readFile("test.html", "utf-8", function(err, body) {
//     sendMail("dante@sage.art", "Sage notification", body);
// });
function exit(code) {
    process.exit(code);
}

main()
.then(() => setTimeout(exit, 2000, 0))
    .catch(error => {
        prisma.$disconnect();
        logger.info(error.stack);
        setTimeout(exit, 2000, 1);
        process.exit(1);
    });
