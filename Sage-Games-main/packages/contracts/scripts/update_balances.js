const fetch = require('node-fetch');
require("dotenv").config();
const hre = require("hardhat");
const createLogger = require("./logs.js");
const BigNumber = require('bignumber.js');

const ethers = hre.ethers;
var abiCoder = ethers.utils.defaultAbiCoder;

const { MerkleTree } = require("merkletreejs");
const keccak256 = require('keccak256');

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const CONTRACTS = require('../contracts.js');
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

let logger;

/**
 * @param {*} assetType 
 * @returns max(blockNumber) for that asset, or null if none is found
 */
async function getLastBlockHeightInDatabase(assetType) {
    const aggregations = await prisma.tokenTransactions.aggregate({
        _max: {
            blockNumber: true,
        },
        where: {
            assetType: assetType.type
        }
    });
    let blockHeight = aggregations._max.blockNumber || 0;
    logger.info(`Last block on db for asset ${assetType.type} is ${blockHeight}`);
    return blockHeight;
}

/**
 * Calls the "Get a block" Covalent API, as defined in 
 * https://www.covalenthq.com/docs/api/#get-/v1/{chain_id}/block_v2/{block_height}/
 *
 * @param {*} chainId 
 * @returns the latest block number on the blockchain
 */
async function getLastBlockHeightInBlockchain(chainId) {
    let targetBlock = "latest";
    let url = `https://api.covalenthq.com/v1/${chainId}/block_v2/${targetBlock}/?key=${process.env.COVALENT_KEY}`;
    let response = await fetch(url);
    let json = await response.json();
    let lastBlock = await json.data.items[0].height - 10; // Do not get the top blocks, in order to prevent chain reorganization
    logger.info(`Last block on chain ${chainId} is ${lastBlock}`);
    return lastBlock;
}

async function getLastBlockInspected(assetType) {
    return assetType.lastBlockInspected || 0;
}

async function getLatestTransactionsFromAllBlockchains(rewardRateTypes) {
    let allTransactions = [];
    for (var rewardRate of rewardRateTypes) {
        let startingBlock = await getLastBlockInspected(rewardRate);
        if (startingBlock == 0) {
            startingBlock = await getLastBlockHeightInDatabase(rewardRate) + 1;
        }
        if (startingBlock < rewardRate.startingBlock) {
            startingBlock = rewardRate.startingBlock;
        }
        let endingBlock = await getLastBlockHeightInBlockchain(rewardRate.chainId);
        let chainTransactions = await getTransactionsFromBlockchain(rewardRate, startingBlock, endingBlock);
        allTransactions.push(...chainTransactions);
    }
    return allTransactions;
}

/**
 * Calls the "Get Log events by contract address" Covalent API, as defined in 
 * https://www.covalenthq.com/docs/api/#get-/v1/{chain_id}/events/address/{address}/
 * 
 * @param {*} asset
 * @param {*} startingBlock 
 * @param {*} endingBlock 
 * @returns 
 */
async function getTransactionsFromBlockchain(asset, startingBlock, endingBlock) {
    let transactions = [];
    if (startingBlock == endingBlock) {
        return transactions;
    }
    let chainId = asset.chainId;
    let contractAddress = asset.contract;
    const CHUNK_SIZE = 100000;
    for (let iStart = startingBlock; iStart < endingBlock; iStart += CHUNK_SIZE) {
        let iEnd = iStart + CHUNK_SIZE - 1;
        if (iEnd > endingBlock) {
            iEnd = endingBlock;
        }
        logger.info(`Fetching events on chain ${chainId} contract ${contractAddress} from block ${iStart} to block ${iEnd}`);
        let url = `https://api.covalenthq.com/v1/${chainId}/events/topics/${TRANSFER_TOPIC}/?sender-address=${contractAddress}&starting-block=${iStart}&ending-block=${iEnd}&page-number=0&page-size=999999999&key=${process.env.COVALENT_KEY}`;
        let result = await fetch(url);
        let resultJson = await result.json();
        if (resultJson.error) {
            logger.error(`Error fetching events: ${resultJson.error_message}`);
            //using a timeout to avoid the script to exit before the error is logged
            setTimeout(exit, 2000, 1);
        }
        let mappedTransactions = resultJson.data.items.map(item => {
            return {
                txHash: item.tx_hash,
                assetType: asset.type,
                blockTimestamp: Date.parse(item.block_signed_at) / 1000, // Converting to unix timestamp
                blockNumber: item.block_height,
                from: item.decoded.params[0].value,
                to: item.decoded.params[1].value,
                value: item.decoded.params[2].value
            };
        });
        // store the transactions in the database
        let dbResult = await prisma.tokenTransactions.createMany({
            data: mappedTransactions,
        });
        // store the last block number inspected in the DB
        await prisma.rewardType.upsert({
            where: {
                type: asset.type
            },
            update: {
                lastBlockInspected: iEnd,
            },
            create: {
                type: asset.type,
                lastBlockInspected: iEnd,
                rewardRate: asset.rewardRate,
                chainId: parseInt(asset.chainId),
                contract: asset.contract,
                startingBlock: asset.startingBlock,
            },
        });

        // transactions.push(...mappedTransactions);
        logger.info(`${mappedTransactions.length} transactions in block range`);
    }
    return transactions;
}

/**
 * Calculates user's points based on the transactions they made, stored on the DB
 * @param {*} address 
 * @param {*} assetType 
 * @param {*} begin 
 * @param {*} end 
 * @returns points earned based on assetType between begin and end
 */
async function getUserPointsAtTimestamp(address, assetType, begin, end) {
    let assetBalance = await getUserBalanceAtTimestamp(address, assetType, begin);
    let refTimestamp = begin;
    let points = BigNumber(0);
    let limit = BigNumber(assetType.positionSizeLimit);
    let rewardRate = BigNumber(assetType.rewardRate);

    let userTransactions = await getUserTransactions(address, assetType, begin + 1, end);

    for (transaction of userTransactions) {
        if (transaction.from != transaction.to) {
            points = points.plus(BigNumber.minimum(assetBalance, limit).multipliedBy(rewardRate).multipliedBy(transaction.blockTimestamp - refTimestamp));
            refTimestamp = transaction.blockTimestamp;
            if (transaction.from === address) {
                assetBalance = assetBalance.minus(BigNumber(transaction.value));
            } else {
                assetBalance = assetBalance.plus(BigNumber(transaction.value));
            }
        }
    }
    points = points.plus(BigNumber.minimum(assetBalance, limit).multipliedBy(rewardRate).multipliedBy(end - refTimestamp));
    return points.dp(0, 1);
}

async function getUserTransactions(address, assetType, begin, end) {
    return await prisma.tokenTransactions.findMany({
        select: {
            blockNumber: true,
            blockTimestamp: true,
            from: true,
            to: true,
            value: true,
        },
        where: {
            OR: [{
                from: {
                    equals: address.toLowerCase()
                }
            }, {
                to: {
                    equals: address.toLowerCase()
                }
            },],
            assetType: {
                equals: assetType.type
            },
            blockTimestamp: {
                gte: begin,
                lte: end
            }
        },
        orderBy: {
            blockNumber: "asc"
        }
    });
}
/**
 * Reconstructs the user's balance at a given timestamp, based on transfer events stored in the DB
 * @param {*} address 
 * @param {*} assetType 
 * @param {*} timestamp 
 * @returns the user's balance at the given timestamp
 */
async function getUserBalanceAtTimestamp(address, assetType, timestamp) {
    let userTransactions = await getUserTransactions(address, assetType, 0, timestamp);
    // define a bigint variable to store the user's balance
    let balance = BigNumber(0);
    for (transaction of userTransactions) {
        if (transaction.from != transaction.to) {
            if (transaction.from === address) {
                balance = balance.minus(BigNumber(transaction.value));
            } else {
                balance = balance.plus(BigNumber(transaction.value));
            }
        }
    }
    return balance;
}

const buf2hex = x => '0x' + x.toString('hex');

async function main() {
    await hre.run('compile');
    logger = createLogger(`urn_scripts_${hre.network.name}`, `update_balances_${hre.network.name}`);
    logger.info(`Started update_balances job on ${hre.network.name}`);

    const publishResults = process.argv.slice(2)[0];
    if (publishResults) {
        logger.info('Publishing results');
    }

    let rewardRateTypes = await getRewardRates();

    await getLatestTransactionsFromAllBlockchains(rewardRateTypes);

    if (publishResults) {
        const Rewards = await ethers.getContractFactory("Rewards");
        rewardsAddress = CONTRACTS[hre.network.name]["rewardsAddress"];
        rewardsContract = await Rewards.attach(rewardsAddress);

        let leaves = new Array();

        dbUsers = await prisma.user.findMany({
            select: {
                walletAddress: true,
                createdAt: true,
            }
        });
        for (user of dbUsers) {
            if (isValidAddress(user.walletAddress)) {
                let earnedPoints = await getUserEarnedPoints(rewardRateTypes, user);
                // push each address-points pair to be a leaf in the Merkle tree
                leaves.push({
                    address: user.walletAddress,
                    points: earnedPoints,
                });
            } else {
                logger.error(`Error: invalid address ${user.walletAddress}`);
            }
        }

        logger.info(`Publishing rewards`);
        let hashedLeaves = leaves.map(leaf => getEncodedLeaf(leaf));
        const tree = new MerkleTree(hashedLeaves, keccak256, { sortPairs: true });

        const root = tree.getHexRoot().toString('hex');
        logger.info(`Storing Merkle tree root in the contract: ${root}`);
        const wallet = await ethers.getSigner();
        const nonce = await ethers.provider.getTransactionCount(wallet.address);
        const storedRoot = await rewardsContract.pointsMerkleRoot();
        if (storedRoot != root) {
            const tx = await rewardsContract.setPointsMerkleRoot(root, {
                nonce: nonce
            });

            //await rewardsContract.setPointsMerkleRoot(root, { nonce: getNonce() });

            // generate proofs for each reward
            // store each proof in the DB so it can be easily queried when users claim points
            // it needs to be run inside a transaction (all leafs of the tree update at the same time or roll back)
            let updates = new Array();
            for (index in leaves) {
                leaf = leaves[index];
                proof = tree.getProof(getEncodedLeaf(leaf)).map(x => buf2hex(x.data)).toString();
                logger.info(`Address: ${leaf.address} Points: ${leaf.points} Proof: ${proof}`)

                updates.push(prisma.earnedPoints.upsert({
                    where: {
                        address: leaf.address
                    },
                    update: {
                        proof: proof,
                        totalPointsEarned: leaf.points.toNumber(),
                        updatedAt: new Date()
                    },
                    create: {
                        proof: proof,
                        totalPointsEarned: leaf.points.toNumber(),
                        address: leaf.address,
                    },
                }));
            }
            await prisma.$transaction(updates);
        } else {
            logger.info(`Merkle tree root already stored in the contract: ${storedRoot}`);
        }
    }
    await prisma.$disconnect();
    logger.info('Update points finished successfully');
}

function isValidAddress(address) {
    try {
        ethers.utils.getAddress(address);
    } catch (e) { return false; }
    return true;
}

async function getUserEarnedPoints(rewardRateTypes, user) {
    let earnedPoints = new BigNumber(0);
    // for each asset ($ASH on Ethereum, liquidity) calculate the user's points
    for (let rewardRateType of rewardRateTypes) {
        earnedPoints = earnedPoints.plus(await getUserPointsAtTimestamp(user.walletAddress, rewardRateType, Date.parse(user.createdAt) / 1000, parseInt(Date.now() / 1000)));
    }
    if (earnedPoints == 0 && (hre.network.name != "fantom")) {
        logger.info(`This is a testnet and ${user.walletAddress} has 0 points. Adding some test points`);
        earnedPoints = BigNumber(150);

    }
    return earnedPoints;
}

async function getRewardRates() {
    return await prisma.rewardType.findMany({
        select: {
            contract: true,
            lastBlockInspected: true,
            rewardRate: true,
            startingBlock: true,
            chainId: true,
            type: true,
            positionSizeLimit: true,
        },
    });
}

function getEncodedLeaf(leaf) {
    logger.info(`Encoding leaf: ${leaf.address} ${leaf.points}`);
    return keccak256(abiCoder.encode(["address", "uint256"],
        [leaf.address, leaf.points.toNumber()]));
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
