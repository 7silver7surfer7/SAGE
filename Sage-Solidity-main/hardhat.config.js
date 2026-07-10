require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-etherscan");
require("hardhat-gas-reporter");
require("@nomiclabs/hardhat-solhint");
require("@typechain/hardhat");
require("dotenv").config();
require("@openzeppelin/hardhat-upgrades");

task("accounts", "Prints the list of accounts", async (args, hre) => {
    const accounts = await hre.ethers.getSigners();
    for (const account of accounts) {
        console.log(account.address);
    }
});

/**
 * @type import('hardhat/config').HardhatUserConfig
 */

// Legacy Ethereum networks (pre-Robinhood-Chain migration). Hardhat validates
// EVERY network entry at config load, so these must not be `undefined` even
// when the env vars are absent (e.g. inside the cron Docker build, which
// ships no .env) — fall back to a placeholder URL and no accounts.
const legacyUrl = process.env.PROVIDER_URL || "http://localhost:8545";
const legacyAccounts = process.env.DEPLOYER_PK ? [process.env.DEPLOYER_PK] : [];

module.exports = {
    networks: {
        mainnet: {
            gasPrice: 10000000000,
            url: legacyUrl,
            accounts: legacyAccounts
        },
        rinkeby: {
            url: legacyUrl,
            accounts: legacyAccounts
        },
        goerli: {
            url: legacyUrl,
            accounts: legacyAccounts
        },
        dev: {
            url: legacyUrl,
            accounts: legacyAccounts,
            chainId: 0xfa2
        },
        robinhood: {
            url: "https://rpc.mainnet.chain.robinhood.com",
            accounts: process.env.DEPLOYER_PK ? [process.env.DEPLOYER_PK] : [],
            chainId: 4663
        },
        robinhoodTestnet: {
            url: "https://rpc.testnet.chain.robinhood.com",
            accounts: process.env.DEPLOYER_PK ? [process.env.DEPLOYER_PK] : [],
            chainId: 46630
        },
        hardhat: {
            gas: 12000000,
            allowUnlimitedContractSize: false,
            timeout: 1800000,
            accounts: {
                count: 100
            }
        },
        localhost: {
            url: "http://localhost:8545"
        }
    },
    etherscan: {
        apiKey: {
            goerli: process.env.ETHERSCAN_KEY,
            mainnet: process.env.ETHERSCAN_KEY,
            // Blockscout accepts any non-empty API key string
            robinhood: "blockscout",
            robinhoodTestnet: "blockscout"
        },
        customChains: [
            {
                network: "robinhood",
                chainId: 4663,
                urls: {
                    apiURL: "https://robinhoodchain.blockscout.com/api",
                    browserURL: "https://robinhoodchain.blockscout.com"
                }
            },
            {
                network: "robinhoodTestnet",
                chainId: 46630,
                urls: {
                    apiURL: "https://explorer.testnet.chain.robinhood.com/api",
                    browserURL: "https://explorer.testnet.chain.robinhood.com"
                }
            }
        ]
    },
    solidity: {
        version: "0.8.14",
        settings: {
            viaIR: false,
            optimizer: {
                enabled: true,
                runs: 200
            }
        }
    },
    gasReporter: {
        enabled: true,
        currency: "USD",
        coinmarketcap: `${process.env.COINMARKETCAP_KEY}`
    }
};
