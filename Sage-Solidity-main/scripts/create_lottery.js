const hre = require("hardhat");
const ethers = hre.ethers;
const BigNumber = require('bignumber.js');
const CONTRACTS = require('../contracts.js');

const lotteryAddress = CONTRACTS[hre.network.name]["lotteryAddress"];
const nftAddress = CONTRACTS[hre.network.name]["nftAddress"];

async function main() {
    await hre.run('compile');
    //const owner = await ethers.getSigner();
    [owner, addr1, addr2, addr3, ...addrs] = await ethers.getSigners();

    const Lottery = await ethers.getContractFactory("Lottery");
    const lottery = await Lottery.attach(lotteryAddress);
    const tx = await lottery.createNewLottery(
        0, // cost in Pixels
        ethers.utils.parseEther('0.001'), // cost in FTM
        parseInt(Date.now() / 1000), //start 
        parseInt(Date.now() / 1000 + 86400 * 30), // end
        nftAddress, // nft contract
        0, // max participants
        owner.address, // artist address,
        0,
        200,
        'ipfs://bafybeib4cmjiwsekisto2mqivril4du5prsetasd7izormse4rovnqxsze/',
        {
            gasLimit: 4000000,
        });
    // get the receipt from tx
    const receipt = await tx.wait();
    const lotteryId = receipt.events[1].args[0];
    console.log(receipt);
    console.log(`Lottery created with id: ${lotteryId}`);

    await lottery.buyTickets(lotteryId, 1, false, { value: ethers.utils.parseEther('0.001'), gasLimit: 4000000 });
    //await lottery.buyTickets(lotteryId, 5, false, {value: ethers.utils.parseEther('0.005'), gasLimit: 4000000});
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error.stack);
        process.exit(1);
    });