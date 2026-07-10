const fetch = require('node-fetch');
require("dotenv").config();

/**
 * Script to fetch NFT balances for a given tokenId
 */
async function main() {

    const topicSignature = 'TransferSingle(address,address,address,uint256,uint256)'
    const contractAddress = '0xa25bf81aacdb5e610eaf91a889975bba43398cf1';
    const response = await fetch(`https://api.covalenthq.com/v1/1/events/topics/${ethers.utils.id(topicSignature)}/?sender-address=${contractAddress}&starting-block=13735079&ending-block=14500000&page-number=0&page-size=999999999&key=${process.env.COVALENT_KEY}`);
    const json = await response.json();
    const nftTransactions = json.data.items;
    let holders = new Map();

    const tokenId = 1;
    nftTransactions.forEach(nftTransaction => {
        from = nftTransaction.decoded.params[1].value;
        let to = nftTransaction.decoded.params[2].value;
        let id = parseInt(nftTransaction.decoded.params[3].value);
        let amount = parseInt(nftTransaction.decoded.params[4].value);

        if (id == tokenId) {
            if (holders[from] == undefined) {
                holders[from] = 0;
            }
            if (holders[to] == undefined) {
                holders[to] = 0;
            }
            holders[from] -= amount;
            holders[to] += amount;
        }
    });

    let count = 1;
    console.log("#,address,balance");
    for (var key in holders) {
        if (holders[key] > 0) {
            console.log(count + "," + key + "," + holders[key]);
            count++;
        }
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error.stack);
        process.exit(1);
    });