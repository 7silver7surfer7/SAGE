const { assert } = require("chai");

const hre = require("hardhat");
const { MerkleTree } = require("merkletreejs");
const keccak256 = require("keccak256");
const createLogger = require("./logs.js");

const sendEmail = require("../util/email.js");
const baseUrl = process.env.BASE_URL;

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const ethers = hre.ethers;

const CONTRACTS = require("../contracts.js");

var abiCoder = ethers.utils.defaultAbiCoder;
let logger;
let lotteryContract;
let lotteryAddress;
let auctionAddress;
let rngContract;

async function main() {
    await hre.run("compile");
    logger = createLogger(
        `sage_scripts_${hre.network.name}`,
        `lottery_inspection_${hre.network.name}`
    );
    logger.info(`Starting the game inspection script on ${hre.network.name}`);

    const Lottery = await ethers.getContractFactory("Lottery");
    const Auction = await ethers.getContractFactory("Auction");
    const SageRNG = await ethers.getContractFactory("SageRNG");

    if (hre.network.name == "hardhat") {
        await hardhatTests(Lottery);
    } else {
        lotteryAddress = CONTRACTS[hre.network.name]["lotteryAddress"];
        lotteryContract = await Lottery.attach(lotteryAddress);

        auctionAddress = CONTRACTS[hre.network.name]["auctionAddress"];
        auctionContract = await Auction.attach(auctionAddress);

        // SageRNG replaces Chainlink VRF on Robinhood Chain: randomness is
        // NOT auto-fulfilled — the operator (RNG owner) must call fulfill()
        // after the lottery's requestRandomNumber(), or draws stall forever.
        rngContract = await SageRNG.attach(
            CONTRACTS[hre.network.name]["randomnessAddress"]
        );
    }

    await updateLotteries();
    await updateAuctions();
    await payRefunds();

    await prisma.$disconnect();
    logger.info("Game inspection script finished successfully");
}

async function payRefunds() {
    logger.info("Checking pending refunds");

    let pendingRefunds = await prisma.refund.findMany({
        where: {
            txHash: null
        }
    });

    for (const pendingRefund of pendingRefunds) {
        gasPrice = ethers.utils.formatUnits(
            await ethers.provider.getGasPrice(),
            "gwei"
        );
        if (gasPrice < 100) {
            let pendingAmount = (
                pendingRefund.refundableTokens *
                ethers.BigNumber.from("1000000000000000000")
            ).toString();
            logger.info(
                "Gas at " +
                    gasPrice +
                    " gwei. Sending " +
                    pendingRefund.refundableTokens +
                    " ASH refund to " +
                    pendingRefund.buyer
            );
            let tx = await lotteryContract.refund(
                pendingRefund.buyer,
                pendingRefund.lotteryId,
                pendingAmount
            );
            let receipt = await tx.wait(1);
            const block = await ethers.provider.getBlock(receipt.blockNumber);
            await prisma.refund.update({
                where: {
                    id: pendingRefund.id
                },
                data: {
                    txHash: tx.hash,
                    blockTimestamp: block.timestamp
                }
            });

            let user = await getUserInfo(pendingRefund.buyer);
            let link;
            if (hre.network.name == "goerli") {
                link = `https://goerli.etherscan.io/tx/${tx.hash}`;
            } else {
                `https://etherscan.io/tx/${tx.hash}`;
            }
            sendEmail(
                user,
                "You received a SAGE refund!", // subject
                "We just sent you a refund", // header
                "Your ticket was not selected for minting, so we sent you a refund!", // message
                null, // no img
                link, // link
                "Check Etherscan", // action
                logger
            );
        }
    }
}

async function updateAuctions() {
    logger.info("Searching for auctions that require action");
    let auctions = await fetchApprovedAuctions();

    const now = Math.floor(Date.now() / 1000);
    for (const auction of auctions) {
        if (auction.claimedAt != null) {
            continue;
        }

        if (auction.contractAddress != null) {
            let auctionInfo = await auctionContract.getAuction(auction.id);
            const endTime = auctionInfo.endTime;
            // if we're past endTime, inspect the auction and take the required actions
            if (
                endTime > 0 &&
                now >= endTime &&
                auction.winnerAddress == null
            ) {
                await updateAuctionInfo(auction);
            }
        }
    }
}

async function updateAuctionInfo(auction) {
    let blockchainAuction = await auctionContract.getAuction(auction.id);
    if (blockchainAuction.highestBidder != auction.winnerAddress) {
        logger.info(
            `Updating auction #${auction.id} with highest bidder ${blockchainAuction.highestBidder}`
        );
        await prisma.auction.update({
            where: {
                id: auction.id
            },
            data: {
                winnerAddress: blockchainAuction.highestBidder
            }
        });
    }
}

async function updateLotteries() {
    logger.info("Searching for lotteries that require action");
    let lotteries = await fetchApprovedLotteries();

    const now = Math.floor(Date.now() / 1000);
    for (const lottery of lotteries) {
        if (lottery.prizesAwardedAt != null || lottery.status == 1) {
            // skip if prizes awarded or lottery was cancelled
            continue;
        }

        if (lottery.contractAddress != null) {
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
                }
            }
        },
        include: {
            Drop: {
                include: {
                    NftContract: true
                }
            }
        }
    });
}

async function fetchApprovedAuctions() {
    return await prisma.auction.findMany({
        where: {
            Drop: {
                approvedAt: {
                    not: null
                }
            }
        },
        include: {
            Drop: {
                include: {
                    NftContract: true
                }
            }
        }
    });
}

async function inspectLotteryState(lottery) {
    const now = Math.floor(Date.now() / 1000);
    lotteryInfo = await lotteryContract.getLotteryInfo(lottery.id);
    numberOfTicketsSold = lotteryInfo.numberOfTicketsSold;

    // if the lottery has finished but still has the status of "open"
    if (lotteryInfo.status == 0 && lotteryInfo.closeTime < now) {
        if (numberOfTicketsSold > 0) {
            logger.info(
                `Lottery #${lottery.id} is closed, requesting random number.`
            );
            await lotteryContract.requestRandomNumber(lottery.id);
        } else {
            // there were no tickets sold
            logger.info(
                `Lottery #${lottery.id} was canceled. Closed without participants.`
            );
            await lotteryContract.cancelLottery(lottery.id);
        }
        return;
    }

    // status 2 = Closed: randomness requested but not yet delivered. With
    // Chainlink VRF this resolved by itself; SageRNG needs the operator to
    // call fulfill(). MIN_DELAY_BLOCKS must pass after the request so the
    // entropy block isn't controllable — if it's too early this run, the
    // next cron run picks it up.
    if (lotteryInfo.status == 2) {
        const request = await rngContract.requests(lottery.id);
        if (request.fulfilled) {
            logger.info(
                `Lottery #${lottery.id} randomness already fulfilled, waiting for state to settle.`
            );
            return;
        }
        if (request.blockNumber == 0) {
            logger.info(
                `Lottery #${lottery.id} is Closed but RNG has no request - needs manual inspection.`
            );
            return;
        }
        const currentBlock = await ethers.provider.getBlockNumber();
        const minDelay = Number(await rngContract.MIN_DELAY_BLOCKS());
        if (currentBlock <= Number(request.blockNumber) + minDelay) {
            logger.info(
                `Lottery #${lottery.id} RNG requested at block ${request.blockNumber}, too early to fulfill (current ${currentBlock}).`
            );
            return;
        }
        const operatorSeed = ethers.BigNumber.from(
            ethers.utils.randomBytes(32)
        );
        logger.info(`Lottery #${lottery.id} fulfilling randomness.`);
        const tx = await rngContract.fulfill(lottery.id, operatorSeed);
        await tx.wait(1);
        logger.info(`Lottery #${lottery.id} randomness fulfilled: ${tx.hash}`);
        return;
    }

    // if the lottery is completed
    if (lotteryInfo.status == 3) {
        if (numberOfTicketsSold > 0) {
            // check if there are prizeProofs stored in the DB for that lottery
            // if there aren't any, create the proofs

            logger.info(
                `Lottery #${lottery.id} is closed but has no prizes yet`
            );

            var tickets = await lotteryContract.getLotteryTickets(
                lottery.id,
                0,
                numberOfTicketsSold - 1,
                { gasLimit: 500000000 }
            );

            logger.info(
                `A total of ${numberOfTicketsSold} tickets for lottery ${lottery.id}`
            );

            randomSeed = await lotteryContract.randomSeeds(lottery.id);
            logger.info(`Random seed stored for this lottery: ${randomSeed}`);

            logger.info(`Getting prize info`);
            let prizes = await prisma.nft.findMany({
                where: {
                    lotteryId: lottery.id
                },
                orderBy: {
                    id: "asc"
                }
            });
            console.log("Prizes length: " + prizes.length);

            let totalPrizes =
                prizes.length > numberOfTicketsSold
                    ? numberOfTicketsSold
                    : prizes.length;
            if (totalPrizes == 0) {
                logger.info(`No prizes for lottery #${lottery.id}`);
                return;
            }
            logger.info(`Total prizes: ${totalPrizes}`);
            var prizesAwarded = 0;

            logger.info(`Lottery #${lottery.id} starting prize distribution`);
            const winnerTicketNumbers = new Set();
            var leaves = new Array();

            for (let i = 0; i < totalPrizes; i++) {
                hashOfSeed = keccak256(
                    abiCoder.encode(
                        ["uint256", "uint256"],
                        [randomSeed, prizesAwarded]
                    )
                );

                // convert hash into a number
                let randomBigNumber = ethers.BigNumber.from(hashOfSeed).mod(
                    numberOfTicketsSold
                );
                let randomPosition = randomBigNumber.toNumber();
                logger.info(`Generated random position ${randomPosition}`);
                while (winnerTicketNumbers.has(randomPosition)) {
                    logger.info(
                        `${randomPosition} already won a prize, checking next position in array`
                    );
                    randomPosition++;
                    randomPosition = randomPosition % numberOfTicketsSold;
                }
                winnerTicketNumbers.add(randomPosition);
                prizesAwarded++;
                logger.info(
                    `Awarded prize ${prizesAwarded} of ${totalPrizes} to winner: ${tickets[randomPosition]}`
                );

                if (prizes.length > 1) {
                    // means more than one edition will be awarded
                    const editionLabel = ` ${prizesAwarded}/${totalPrizes}`;
                    const nftName = prizes[i].name + editionLabel;
                    const nftData = { ...prizes[i], name: nftName };
                    // create new metadata on arweave
                    var metadataPath = await createMetadataOnArweave(nftData);
                    // update database
                    await prisma.nft.update({
                        where: {
                            id: prizes[i].id
                        },
                        data: {
                            name: nftName,
                            metadataPath
                        }
                    });
                } else {
                    // use existing metadata and do not change nft name
                    var metadataPath = prizes[i].metadataPath;
                }
                var leaf = {
                    lotteryId: Number(lottery.id),
                    winnerAddress: tickets[randomPosition],
                    ticketNumber: randomPosition,
                    nftId: prizes[i].id,
                    uri: metadataPath,
                    proof: "",
                    createdAt: new Date()
                };
                leaves.push(leaf);
                //}
            }

            logger.info(`All prizes awarded. Building the merkle tree`);
            hashedLeaves = leaves.map(leaf => getEncodedLeaf(lottery.id, leaf));
            const tree = new MerkleTree(hashedLeaves, keccak256, {
                sortPairs: true
            });

            const root = tree.getHexRoot().toString("hex");
            const storedMerkleRoot = await lotteryContract.prizeMerkleRoots(
                lottery.id
            );
            if (root == storedMerkleRoot) {
                logger.info(`Merkle root stored: ${storedMerkleRoot}`);
            } else {
                logger.info(
                    `Storing the Merkle tree root in the contract: ${root}`
                );
                await lotteryContract.setPrizeMerkleRoot(lottery.id, root);
            }
            // generate and store proofs for each winner
            let hasProof = await prisma.prizeProof.findMany({
                where: {
                    lotteryId: lottery.id
                }
            });
            if (hasProof.length == 0) {
                await generateAndStoreProofs(leaves, tree, lottery.id);
            }
            await prisma.lottery.update({
                where: {
                    id: lottery.id
                },
                data: {
                    prizesAwardedAt: new Date()
                }
            });

            await createRefundRecords(
                lotteryInfo,
                tickets,
                winnerTicketNumbers
            );

            await sendEmailNotificationsToWinners(leaves);

            logger.info(
                `Lottery #${lottery.id} had ${leaves.length} prizes distributed.`
            );
        }
    }
}

async function createMetadataOnArweave(nftData) {
    const Arweave = require("arweave");

    // init Arweave
    const { computePrimes } = await import("jwk-rsa-compute-primes");
    const arweaveJwk = computePrimes(
        JSON.parse(process.env.ARWEAVE_JSON_JWK || "")
    );
    const arweave = Arweave.init({
        host: "arweave.net",
        port: 443,
        protocol: "https",
        timeout: 120000
    });

    // create NFT metadata
    const jsonData = JSON.stringify({
        name: nftData.name,
        description: nftData.description,
        image: nftData.arweavePath
    });

    // send arweave transaction — chunked uploader, NOT transactions.post():
    // post()'s response goes unchecked and a silently failed data upload
    // leaves an accepted tx header with no data behind it (permanently
    // 0-byte metadata URL). The uploader throws on failure instead.
    const tx = await arweave.createTransaction({ data: jsonData }, arweaveJwk);
    tx.addTag("Content-Type", "application/json");
    await arweave.transactions.sign(tx, arweaveJwk);
    const uploader = await arweave.transactions.getUploader(tx);
    while (!uploader.isComplete) {
        await uploader.uploadChunk();
    }
    if (uploader.lastResponseError) {
        throw new Error(
            `Arweave upload of prize metadata '${nftData.name}' failed: ` +
                `${uploader.lastResponseError} (http ${uploader.lastResponseStatus})`
        );
    }
    console.log(
        `NFT '${nftData.name}' metadata saved with Arweave ID ${tx.id}`
    );

    // retrieve & display arweave balance
    const address = await arweave.wallets.jwkToAddress(arweaveJwk);
    var balance = await arweave.wallets.getBalance(address);
    balance = arweave.ar.winstonToAr(balance);
    console.log(`Arweave balance for wallet ${address} is ${balance}`);

    return `https://arweave.net/${tx.id}`;
}

async function createRefundRecords(lotteryInfo, tickets, winnerTicketNumbers) {
    const ticketCost =
        ethers.BigNumber.from(lotteryInfo.ticketCostTokens) /
        1000000000000000000;
    if (ticketCost == 0) {
        return;
    }
    var refunds = new Map();
    for (let i = 0; i < tickets.length; i++) {
        var refund = {
            lotteryId: lotteryInfo.lotteryID.toNumber(),
            buyer: tickets[i],
            refundableTokens: 0
        };
        if (!winnerTicketNumbers.has(i)) {
            if (!refunds.has(tickets[i])) {
                refunds.set(tickets[i], refund);
            }
            let value = refunds.get(tickets[i]).refundableTokens;
            refund.refundableTokens = value + ticketCost;
            refunds.set(tickets[i], refund);
        }
    }
    const refundsArray = Array.from(refunds.values());
    await prisma.refund.createMany({
        data: refundsArray
    });
    logger.info("Created refund records");

    for (refund of refundsArray) {
        let user = await getUserInfo(refund.buyer);
        sendEmail(
            user,
            "A refund from SAGE", // subject
            "", // header
            "You have a refund for your non-winning tickets. SAGE will send the funds in batches soon. If you prefer, you can head to SAGE and claim them now.", // message
            null, // no img
            `${baseUrl}profile?notifications`, // link
            "Claim refund", // action
            logger
        );
    }
}

async function generateAndStoreProofs(leaves, tree, lotteryId) {
    for (index in leaves) {
        leaf = leaves[index];
        leaf.proof = tree
            .getProof(getEncodedLeaf(lotteryId, leaf))
            .map(x => buf2hex(x.data))
            .toString();
        logger.info(
            `NFT id: ${leaf.nftId} Winner: ${leaf.winnerAddress} URI: ${leaf.uri} Proof: ${leaf.proof}`
        );
    }
    // store proofs on the DB so they can be easily queried
    if (hre.network.name != "hardhat") {
        created = await prisma.prizeProof.createMany({ data: leaves });
        logger.info(`${created.count} Proofs created in the DB.`);
    }
}

async function getUserInfo(walletAddress) {
    return await prisma.user.findUnique({ where: { walletAddress } });
}

async function getNFTInfo(id) {
    return await prisma.nft.findUnique({ where: { id } });
}

async function sendEmailNotificationsToWinners(leaves) {
    for (const leaf of leaves) {
        const winner = await getUserInfo(leaf.winnerAddress);
        const nft = await getNFTInfo(leaf.nftId);
        sendEmail(
            winner,
            "You won a SAGE NFT prize!", // subject
            "Sage NFT Game Prize", // header
            "Your ticket was selected for minting an NFT!", // message
            nft, // img
            `${baseUrl}profile?notifications`, // link
            "Claim NFT", // action
            logger
        );
    }
}

async function hardhatTests(Lottery) {
    // if running on the hardhat network, deploy the contracts and initialize
    let owner = await ethers.getSigner();
    const Rewards = await ethers.getContractFactory("Rewards");
    const Nft = await ethers.getContractFactory("NFT");
    const rewards = await Rewards.deploy(owner.address);
    const lottery = await hre.upgrades.deployProxy(Lottery, [
        rewards.address,
        owner.address
    ]);

    nft = await Nft.deploy("Urn", "URN", owner.address);
    MockRNG = await ethers.getContractFactory("MockRNG");
    mockRng = await MockRNG.deploy(lottery.address);
    await lottery.setRandomGenerator(mockRng.address);
    // get current timestamp
    const blockNumber = await ethers.provider.getBlockNumber();
    const block = await ethers.provider.getBlock(blockNumber);

    // await lottery.createLottery(0, 1, block.timestamp, block.timestamp + 1100,
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
    .catch(error => {
        prisma.$disconnect();
        logger.error(error.stack);
        setTimeout(exit, 2000, 1);
    });

function getEncodedLeaf(lotteryId, leaf) {
    logger.info(`Encoding leaf: ${leaf.winnerAddress} ${leaf.nftId} ${leaf.ticketNumber} ${leaf.uri}`);
    return keccak256(
        abiCoder.encode(
            ["uint256", "address", "uint256", "string"],
            [lotteryId, leaf.winnerAddress, leaf.ticketNumber, leaf.uri]
        )
    );
}

const buf2hex = x => "0x" + x.toString("hex");
