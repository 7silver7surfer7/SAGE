
const { assert } = require("chai");

const hre = require("hardhat");
const { MerkleTree } = require("merkletreejs");
const keccak256 = require('keccak256');
const createLogger = require("./logs.js");

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const ethers = hre.ethers;

const CONTRACTS = require('../contracts.js');

var abiCoder = ethers.utils.defaultAbiCoder;
let logger;
let lotteryContract;

async function main() {
    await hre.run('compile');
    logger = createLogger(`urn_scripts_${hre.network.name}`, `lottery_inspection_${hre.network.name}`);
    logger.info(`Starting the game inspection script on ${hre.network.name}`);

    const Lottery = await ethers.getContractFactory("Lottery");
    const Auction = await ethers.getContractFactory("Auction");

    if (hre.network.name == "hardhat") {
        await hardhatTests(Lottery);
    } else {
        lotteryAddress = CONTRACTS[hre.network.name]["lotteryAddress"];
        lotteryContract = await Lottery.attach(lotteryAddress);

        auctionAddress = CONTRACTS[hre.network.name]["auctionAddress"];
        auctionContract = await Auction.attach(auctionAddress);
    }

    await updateLotteries();
    await updateAuctions();

    await prisma.$disconnect();
    logger.info('Game inspection script finished successfully');
}

async function updateAuctions() {
    logger.info('Searching for auctions that require action');
    let auctions = await fetchApprovedAuctions();

    const now = Math.floor(Date.now() / 1000);
    for (const auction of auctions) {
        if (auction.claimedAt != null) {
            continue;
        }
        let primarySplitterAddress = auction.Drop.PrimarySplitter?.splitterAddress;
        if (auction.Drop.primarySplitterId != null && primarySplitterAddress == null) {
            auction.Drop.PrimarySplitter.splitterAddress = await deploySplitter(auction.dropId, auction.Drop.primarySplitterId);
        }

        let secondarySplitterAddress = auction.Drop.SecondarySplitter?.splitterAddress;
        if (auction.Drop.secondarySplitterId != null && secondarySplitterAddress == null) {
            auction.Drop.SecondarySplitter.splitterAddress = await deploySplitter(auction.dropId, auction.Drop.secondarySplitterId);
        }
        const endTime = Math.floor(auction.endTime / 1000);
        if (auction.blockchainCreatedAt == null) {
            if (auction.endTime < now) {
                // ignore an auction with an expired end time
                continue;
            }
            await createAuction(auction, CONTRACTS[hre.network.name]["nftAddress"]);
        } else {
            // if we're past endTime, inspect the lottery and take the required actions
            if (now >= endTime) {
                await updateAuctionInfo(auction);
            }
        }
    }
}

async function updateAuctionInfo(auction) {

    let blockchainAuction = await auctionContract.getAuction(auction.id);
    if (blockchainAuction.highestBidder != auction.highestBidder) {
        logger.info(`Updating auction #${auction.id} with highest bidder ${auction.highestBidder}`);
        await prisma.auction.update({
            where: {
                id: auction.id
            },
            data: {
                winnerAddress: blockchainAuction.highestBidder,
            }
        });
    }
}

async function updateLotteries() {
    logger.info('Searching for lotteries that require action');
    let lotteries = await fetchApprovedLotteries();

    const now = Math.floor(Date.now() / 1000);
    for (const lottery of lotteries) {
        if (lottery.prizesAwardedAt != null) {
            continue;
        }
        let primarySplitterAddress = lottery.Drop.PrimarySplitter?.splitterAddress;
        if (lottery.Drop.primarySplitterId != null && primarySplitterAddress == null) {
            lottery.Drop.PrimarySplitter.splitterAddress = await deploySplitter(lottery.dropId, lottery.Drop.primarySplitterId);
        }

        let secondarySplitterAddress = lottery.Drop.SecondarySplitter?.splitterAddress;
        if (lottery.Drop.secondarySplitterId != null && secondarySplitterAddress == null) {
            lottery.Drop.SecondarySplitter.splitterAddress = await deploySplitter(lottery.dropId, lottery.Drop.secondarySplitterId);
        }

        if (lottery.blockchainCreatedAt == null) {
            if (lottery.endTime < now) {
                // ignore a lottery with an expired end time
                continue;
            }

            await createLottery(lottery, CONTRACTS[hre.network.name]["nftAddress"]);
        } else {
            const endTime = Math.floor(lottery.endTime / 1000);
            // if we're past endTime, inspect the lottery and take the required actions
            if (now >= endTime) {
                await inspectLotteryState(lottery);
            }
        }
    }
}

async function fetchApprovedLotteries() {
    return await prisma.lottery.findMany({
        where: {
            Drop: {
                approvedAt: {
                    not: null
                },
            },
        },
        include: {
            Drop: {
                include: {
                    PrimarySplitter: true,
                    SecondarySplitter: true,
                    Artist: true,
                },
            },
        }
    });
}

async function fetchApprovedAuctions() {
    return await prisma.auction.findMany({
        where: {
            Drop: {
                approvedAt: {
                    not: null
                },
            },
        },
        include: {
            Drop: {
                include: {
                    PrimarySplitter: true,
                    SecondarySplitter: true,
                    Artist: true,
                },
            },
        }
    });
}


async function getTotalAmountOfPrizes(lotteryId, numberOfTicketsSold) {
    prizes = await lotteryContract.getPrizes(lotteryId);
    var totalPrizes = 0;
    // iterate the prize array getting the number of prizes for each entry
    for (let i = 0; i < prizes.length; i++) {
        totalPrizes += prizes[i].numberOfEditions;
    }
    if (totalPrizes > numberOfTicketsSold) {
        totalPrizes = numberOfTicketsSold;
    }
    return totalPrizes;
}

async function inspectLotteryState(lottery) {
    const blockNum = await ethers.provider.getBlockNumber();
    const block = await ethers.provider.getBlock(blockNum);
    lotteryInfo = await lotteryContract.getLotteryInfo(lottery.id);
    numberOfTicketsSold = lotteryInfo.numberOfTicketsSold;

    // if the lottery has finished but still has the status of "open"
    if (lotteryInfo.status == 0 && lotteryInfo.closeTime < block.timestamp) {
        if (numberOfTicketsSold > 0) {
            logger.info(`Lottery #${lottery.id} is closed, requesting random number.`);
            await lotteryContract.requestRandomNumber(lottery.id);
        } else { // there were no tickets sold
            logger.info(`Lottery #${lottery.id} was canceled. Closed without participants.`);
            await lotteryContract.cancelLottery(lottery.id);
        }
        return;
    }

    // if the lottery is completed
    if (lotteryInfo.status == 3) {
        if (numberOfTicketsSold > 0) {
            // check if there are prizeProofs stored in the DB for that lottery
            // if there aren't any, create the proofs
            logger.info(`Lottery #${lottery.id} is closed but has no prizes yet`);

            var ticketArray = await lotteryContract.getLotteryTickets(lottery.id, 0, numberOfTicketsSold - 1, { gasLimit: 500000000 });
            // map the ticket struct array to an array with only the ticket owner addresses
            var tickets = ticketArray.map(x => x.owner);

            logger.info(`A total of ${numberOfTicketsSold} tickets for lottery ${lottery.id}`);

            defaultPrizeId = lotteryInfo.defaultPrizeId;

            randomSeed = await lotteryContract.randomSeeds(lottery.id);
            logger.info(`Random seed stored for this lottery: ${randomSeed}`);

            logger.info(`Getting prize info`);
            let totalPrizes = await getTotalAmountOfPrizes(lottery.id, numberOfTicketsSold);

            logger.info(`Total prizes: ${totalPrizes}`);
            var prizesAwarded = 0;

            logger.info(`Lottery #${lottery.id} starting prize distribution`);
            const winnerTicketNumbers = new Set();
            var leaves = new Array();

            for (prizeIndex in prizes) {
                for (i = 0; i < prizes[prizeIndex].numberOfEditions; i++) {
                    if (prizesAwarded == totalPrizes) {
                        break;
                    }
                    hashOfSeed = keccak256(abiCoder.encode(['uint256', 'uint256'], [randomSeed, prizesAwarded]));

                    // convert hash into a number
                    randomPosition = ethers.BigNumber.from(hashOfSeed).mod(numberOfTicketsSold);
                    logger.info(`Generated random position ${randomPosition}`);
                    while (winnerTicketNumbers.has(randomPosition)) {
                        logger.info(`${randomPosition} already won a prize, checking next position in array`);
                        randomPosition++;
                        randomPosition = randomPosition % numberOfTicketsSold;
                    }
                    winnerTicketNumbers.add(randomPosition);
                    prizesAwarded++;
                    logger.info(`Awarded prize ${prizesAwarded} of ${totalPrizes} to winner: ${tickets[randomPosition]}`);

                    var leaf = {
                        lotteryId: Number(lottery.id), winnerAddress: tickets[randomPosition], nftId: prizes[prizeIndex].prizeId.toNumber(), ticketNumber: randomPosition.toNumber(), proof: "", createdAt: new Date()
                    };
                    leaves.push(leaf);
                }
            }

            // if lottery has defaultPrize, distribute it to all participants who did not win a prize above
            if (defaultPrizeId != 0) {
                for (i = 0; i < tickets.length; i++) {
                    if (!winnerTicketNumbers.has(i)) {
                        var leaf = {
                            lotteryId: Number(lottery.id), winnerAddress: tickets[i], nftId: defaultPrizeId.toNumber(), ticketNumber: i, proof: "", createdAt: new Date()
                        };
                        winnerTicketNumbers.add(i);
                        leaves.push(leaf);
                    }
                }
            }
            logger.info(`All prizes awarded. Building the merkle tree`);
            hashedLeaves = leaves.map(leaf => getEncodedLeaf(lottery.id, leaf));
            const tree = new MerkleTree(hashedLeaves, keccak256, { sortPairs: true });

            const root = tree.getHexRoot().toString('hex');
            logger.info(`Storing the Merkle tree root in the contract: ${root}`);
            await lotteryContract.setPrizeMerkleRoot(lottery.id, root);

            // generate and store proofs for each winner
            await generateAndStoreProofs(leaves, tree, lottery.id);

            await prisma.lottery.update({
                where: {
                    id: lottery.id
                },
                data: {
                    prizesAwardedAt: new Date(),
                }
            });

            logger.info(`Lottery #${lottery.id} had ${leaves.length} prizes distributed.`);
        }
    }
}

async function generateAndStoreProofs(leaves, tree, lotteryId) {
    for (index in leaves) {
        leaf = leaves[index];
        leaf.proof = tree.getProof(getEncodedLeaf(lotteryId, leaf)).map(x => buf2hex(x.data)).toString();
        logger.info(`NFT id: ${leaf.nftId} Winner: ${leaf.winnerAddress} Ticket Number: ${leaf.ticketNumber} Proof: ${leaf.proof}`);
    }
    // store proofs on the DB so they can be easily queried
    if (hre.network.name != "hardhat") {
        created = await prisma.prizeProof.createMany({ data: leaves });
        logger.info(`${created.count} Proofs created in the DB.`);
    }
}

async function hardhatTests(Lottery) {
    // if running on the hardhat network, deploy the contracts and initialize 
    let owner = await ethers.getSigner();
    const Rewards = await ethers.getContractFactory('Rewards');
    const Nft = await ethers.getContractFactory("NFT");
    const rewards = await Rewards.deploy(owner.address);
    const lottery = await hre.upgrades.deployProxy(Lottery, [rewards.address, owner.address])

    nft = await Nft.deploy("Urn", "URN", owner.address);
    MockRNG = await ethers.getContractFactory("MockRNG");
    mockRng = await MockRNG.deploy(lottery.address);
    await lottery.setRandomGenerator(mockRng.address);
    // get current timestamp
    const blockNumber = await ethers.provider.getBlockNumber();
    const block = await ethers.provider.getBlock(blockNumber);

    // await lottery.createNewLottery(0, 1, block.timestamp, block.timestamp + 1100,
    //     nft.address, 0, owner.address, "ipfs://path/");
    // await lottery.addPrizes(1, [1, 2], [1, 1000]);
    // accounts = await ethers.getSigners();
    // for (i = 0; i < 100; i++) {
    //     logger.info(`Buying ticket with account ${i}`);
    //     await lottery.connect(accounts[i]).buyTickets(1, 1, false, { value: 1 });
    // }
    // await ethers.provider.send("evm_increaseTime", [1500]); // long wait, enough to be after the end of the lottery
    // await ethers.provider.send("evm_mine", []);
    // await lottery.requestRandomNumber(1);
    // await mockRng.fulfillRequest(1, 1);
}

function exit(code) {
    process.exit(code);
}

main()
    .then(() => setTimeout(exit, 2000, 0))
    .catch((error) => {
        prisma.$disconnect();
        logger.error(error.stack);
        setTimeout(exit, 2000, 1);
    });

function getEncodedLeaf(lotteryId, leaf) {
    logger.info(`Encoding leaf: ${leaf.winnerAddress} ${leaf.nftId}`);
    return keccak256(abiCoder.encode(["uint256", "address", "uint256", "uint256"],
        [lotteryId, leaf.winnerAddress, leaf.nftId, leaf.ticketNumber]));
}

async function deploySplitter(dropId, splitId) {
    let owner = await ethers.getSigner();
    let splitEntries = await prisma.splitEntry.findMany({
        where: {
            splitterId: splitId
        }
    });
    if (splitEntries.length == 0) {
        logger.error(`No split addresses found for Drop #${dropId}`);
        return null;
    }
    let splitAddress;
    if (splitEntries.length == 1) {
        logger.info(`Only one split address found for Drop #${dropId}. No splitter needed.`);
        splitAddress = splitEntries[0].destinationAddress;
    } else {
        logger.info(`Deploying splitter for splitId #${splitId}`);
        let destinations = new Array();
        let weights = new Array();
        for (i = 0; i < splitEntries.length; i++) {
            destinations.push(splitEntries[i].destinationAddress);
            weights.push(parseInt(splitEntries[i].percent * 100));// royalty percentage using basis points. 1% = 100
        }
        const Splitter = await ethers.getContractFactory("Splitter");
        const splitter = await Splitter.deploy(owner.address, destinations, weights);
        splitAddress = splitter.address;
        logger.info(`Splitter deployed to ${splitAddress}`);
    }
    await prisma.splitter.update({
        where: { id: splitId },
        data: { splitterAddress: splitAddress }
    });
    return splitAddress;
}

async function createLottery(lottery, nftContractAddress) {
    logger.info("Creating lottery for drop #id: " + lottery.dropId);
    const Nft = await ethers.getContractFactory("NFT");
    const nft = await Nft.attach(nftContractAddress);

    let royaltyAddress = lottery.Drop.secondarySplitterId != null ? lottery.Drop.SecondarySplitter.splitterAddress : lottery.Drop.artistAddress;
    let primarySalesDestination = lottery.Drop.primarySplitterId != null ? lottery.Drop.PrimarySplitter.splitterAddress : lottery.Drop.artistAddress;

    // percentage in basis points (200 = 2.00%)
    let royaltyPercentageBasisPoints = parseInt(lottery.Drop.royaltyPercentage * 100);
    let collectionExists = await nft.collectionExists(lottery.dropId);
    if (!collectionExists) {
        await nft.createCollection(
            lottery.dropId,
            royaltyAddress,
            royaltyPercentageBasisPoints,
            "https://" + lottery.Drop.dropMetadataCid + ".ipfs.dweb.link/",
            primarySalesDestination);
        logger.info("Collection created");
    } else {
        logger.info("Collection already exists");
    }

    let startTime = parseInt(new Date(lottery.startTime).getTime() / 1000);
    let endTime = parseInt(new Date(lottery.endTime).getTime() / 1000);

    const tx = await lotteryContract.createNewLottery(
        lottery.id,
        lottery.dropId,
        lottery.vipCostPerTicketPoints,
        ethers.utils.parseEther(lottery.vipCostPerTicketCoins.toString()),
        lottery.memberCostPerTicketPoints,
        ethers.utils.parseEther(lottery.memberCostPerTicketCoins.toString()),
        ethers.utils.parseEther(lottery.nonMemberCostPerTicketCoins.toString()),
        startTime,
        endTime,
        nftContractAddress,
        lottery.isRefundable,
        lottery.defaultPrizeId || 0
    );
    logger.info("Lottery created");

    if (lottery.maxTickets > 0) {
        logger.info("Setting max tickets to " + lottery.maxTickets);
        await lotteryContract.setMaxTickets(lottery.id, lottery.maxTickets);
    }
    if (lottery.maxTicketsPerUser > 0) {
        logger.info("Setting max tickets per user to " + lottery.maxTicketsPerUser);
        await lotteryContract.setMaxTicketsPerUser(lottery.id, lottery.maxTicketsPerUser);
    }

    lottery.blockchainCreatedAt = new Date();
    await prisma.lottery.update({
        where: {
            id: lottery.id
        },
        data: {
            blockchainCreatedAt: lottery.blockchainCreatedAt,
            isLive: true,
        }
    });
    await addPrizes(lottery);

    logger.info(`Lottery created with drop id: ${lottery.dropId} | startTime: ${lottery.startTime} | endTime: ${lottery.endTime} | maxTickets: ${lottery.maxTickets} | 
    CreatedBy: ${lottery.Drop.artistAddress} | defaultPrizeId: ${lottery.defaultPrizeId} | royaltyPercentageBasePoints: ${royaltyPercentageBasisPoints} | metadataIpfsPath: ${lottery.Drop.dropMetadataCid}`);
}

async function createAuction(auction, nftContractAddress) {
    logger.info("Creating auction for drop #id: " + auction.dropId);
    const Nft = await ethers.getContractFactory("NFT");
    const nft = await Nft.attach(nftContractAddress);

    let royaltyAddress = auction.Drop.secondarySplitterId != null ? auction.Drop.SecondarySplitter.splitterAddress : auction.Drop.artistAddress;
    let primarySalesDestination = auction.Drop.primarySplitterId != null ? auction.Drop.PrimarySplitter.splitterAddress : auction.Drop.artistAddress;

    // percentage in basis points (200 = 2.00%)
    let royaltyPercentageBasisPoints = parseInt(auction.Drop.royaltyPercentage * 100);
    let collectionExists = await nft.collectionExists(auction.dropId);
    if (!collectionExists) {
        await nft.createCollection(
            auction.dropId,
            royaltyAddress,
            royaltyPercentageBasisPoints,
            "https://" + auction.Drop.dropMetadataCid + ".ipfs.dweb.link/",
            primarySalesDestination);
        logger.info("Collection created");
    } else {
        logger.info("Collection already exists");
    }

    let startTime = parseInt(new Date(auction.startTime).getTime() / 1000);
    let endTime = parseInt(new Date(auction.endTime).getTime() / 1000);
    if (auction.buyNowPrice == null || auction.buyNowPrice == "") {
        auction.buyNowPrice = '0';
    }
    let buyNowPrice = ethers.utils.parseEther(auction.buyNowPrice);
    let minimumPrice = ethers.utils.parseEther(auction.minimumPrice);
    if (auction.erc20Address == null || auction.erc20Address == "") {
        auction.erc20Address = "0x0000000000000000000000000000000000000000";
    }
    const tx = await auctionContract.createAuction(
        auction.dropId,
        auction.id,
        auction.nftId,
        buyNowPrice,
        minimumPrice,
        auction.erc20Address,
        startTime,
        endTime,
        nftContractAddress
    );

    auction.blockchainCreatedAt = new Date();
    await prisma.auction.update({
        where: {
            id: auction.id
        },
        data: {
            blockchainCreatedAt: auction.blockchainCreatedAt,
            isLive: true,
        }
    });

    logger.info(`auction created with id: ${auction.id}`);
}

const buf2hex = x => '0x' + x.toString('hex');

async function addPrizes(lottery) {
    let prizes = await prisma.nft.findMany({
        where: {
            lotteryId: lottery.id
        },
        orderBy: {
            numberOfEditions: "asc"
        }
    });
    let prizeIds = Array();
    let prizeAmounts = Array();
    for (prize of prizes) {
        if (prize.numberOfEditions > 0) {
            prizeIds.push(prize.id);
            prizeAmounts.push(prize.numberOfEditions);
        }
    }
    if (prizeIds.length > 0) {
        await lotteryContract.addPrizes(parseInt(lottery.id), prizeIds, prizeAmounts);
    }
}

