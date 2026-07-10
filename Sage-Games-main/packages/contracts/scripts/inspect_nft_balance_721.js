const fetch = require('node-fetch');
const hre = require("hardhat");
const ethers = hre.ethers;
require("dotenv").config();

/**
 * Script to fetch NFT balances for a given tokenId
 */
async function main() {

    // ethereum Meme VIP
    const contractAddress = '0x85f06f0dc7ac62f006ab09227e81709b7c39f50c';

    const card2022 = '0x4D5f049e729a7dF85096D3cb2d5F3FC9b9E8EaF8';

    // define abi for the ERC-721 ownerOf function
    const abi = [
        {
            "inputs": [
                {
                    "internalType": "uint256",
                    "name": "tokenId",
                    "type": "uint256"
                }
            ],
            "name": "ownerOf",
            "outputs": [
                {
                    "internalType": "address",
                    "name": "",
                    "type": "address"
                }
            ],
            "stateMutability": "view",
            "type": "function"
        }
    ];

    // define contract instance
    const memeVip = new ethers.Contract(card2022, abi, ethers.provider.getSigner());

    // print block number 
    const blockNumber = await ethers.provider.getBlockNumber();
    console.log("blockNumber: " + blockNumber);

    console.log("token_id,owner_address");
    // iterate token ids and fetch owner of each token
    for (let i = 1; i <= 3555; i++) {
        const owner = await memeVip.ownerOf(i);
        console.log(i + "," + owner);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error.stack);
        process.exit(1);
    });