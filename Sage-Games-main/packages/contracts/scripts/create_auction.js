const hre = require("hardhat");
const ethers = hre.ethers;
const CONTRACTS = require('../contracts.js');

const auctionAddress = CONTRACTS[hre.network.name]["auctionAddress"];
const nftAddress = CONTRACTS[hre.network.name]["nftAddress"];

async function main() {
    await hre.run('compile');
    //const owner = await ethers.getSigner();
    [owner, addr1, addr2, addr3, ...addrs] = await ethers.getSigners();

    const Auction = await ethers.getContractFactory("Auction");
    const auction = await Auction.attach(auctionAddress);
    let tx = await auction.createCollectionAndAuction(
        1, // NFT id
        ethers.utils.parseEther('1'), // buy now cost in FTM
        ethers.utils.parseEther('0.001'), // minimum cost in FTM
        '0x0000000000000000000000000000000000000000',
        86400, // duration
        nftAddress, // nft contract
        100, // fee
        owner.address, // artist address,
        200,
        'ipfs://bafybeib4cmjiwsekisto2mqivril4du5prsetasd7izormse4rovnqxsze/',
    );
    // get the receipt from tx
    let receipt = await tx.wait();
    const auctionId = receipt.events[1].args[0];
    console.log(receipt);
    console.log(`Auction created with id: ${auctionId}`);

    tx = await auction.bid(auctionId, ethers.utils.parseEther('0.001'), { value: ethers.utils.parseEther('0.001') });
    receipt = await tx.wait();
    console.log(receipt);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error.stack);
        process.exit(1);
    });