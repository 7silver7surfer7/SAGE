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
module.exports = {
  networks: {
    mainnet: {
      url: "http://127.0.0.1:8545",
      accounts: [process.env.DEPLOYER_PK],
    },
    rinkeby: {
      url: process.env.PROVIDER_URL,
      accounts: [process.env.DEPLOYER_PK],
    },
    fantomtestnet: {
      url: process.env.PROVIDER_URL,
      accounts: [process.env.DEPLOYER_PK],
      chainId: 0xfa2,
    },
    dev: {
      url: process.env.PROVIDER_URL,
      accounts: [process.env.DEPLOYER_PK],
      chainId: 0xfa2,
    },
    fantom: {
      url: process.env.PROVIDER_URL,
      accounts: [process.env.DEPLOYER_PK],
      chainId: 0xfa,
    },
    hardhat: {
      gas: 12000000,
      allowUnlimitedContractSize: false,
      timeout: 1800000,
      accounts: {
        count: 100,
      },
    },
    localhost: {
      url: "http://localhost:8545",
    }
  },
  etherscan: {
    apiKey: {
      opera: process.env.FTMSCAN_KEY,
      rinkeby: process.env.ETHERSCAN_KEY,
    },
  },
  solidity: {
    version: "0.8.14",
    settings: {
      viaIR: true,
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  gasReporter: {
    enabled: true,
    currency: "USD",
    coinmarketcap: `${process.env.COINMARKETCAP_KEY}`,
  },
};
