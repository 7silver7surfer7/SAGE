const ethers = require('ethers');
const BigNumber = require('bignumber.js');
const AWS = require('aws-sdk'); 
var ddb = new AWS.DynamoDB({apiVersion: '2012-08-10'});

const WEB3_ENDPOINT = 'https://cloudflare-eth.com';

const getTokenMetadata = async (address) => {
    const abi = ['function totalSupply() view returns (uint256 totalSupply)'];

    const { JsonRpcProvider } = ethers.providers;
    const provider = new JsonRpcProvider(WEB3_ENDPOINT);
    const contract = new ethers.Contract(address, abi, provider);

    const someResponse = await contract.totalSupply();
    const someNum = BigNumber(someResponse._hex);

    return someNum.shiftedBy(-18).toFixed(2).toString();
};

exports.handler = async (event) => {
    const currentMemeInuBalance = await getTokenMetadata('0x74b988156925937bd4e082f0ed7429da8eaea8db');
    console.log("Current Meme INU balance to put into db: " + currentMemeInuBalance);

    const putParams = {
        TableName: 'memex-token-total-supplies',
        Item: {
            'tokenName': {S: "memeInu"},
            'totalSupply': {S: currentMemeInuBalance }
        }
    }

    console.log({putParams});
    
    try {
        console.log("Attempting to save...");
        ddb.putItem(putParams, function(err, data) {
          if (err) {
            console.log("Error while trying to put: " + err);
            return { error: err }
          } else {
            console.log("Successfully updated memeInu total supply value.");
            return { statusCode: 200 }
          }
        });
    } catch (err) {
      console.log("Some error: " + err);
      return { error: err }
    }
};
