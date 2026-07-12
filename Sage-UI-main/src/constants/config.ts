import { Configuration, Parameters } from './types';

export const DEFAULT_PROFILE_PICTURE = '/branding/sage-icon.svg';
export const OPTIMIZED_IMAGE_WIDTH = 487;

// On-chain currency sentinels shared by every game contract: address(0) means
// the SAGE ERC-20, this constant means native ETH. A drop's DB `currency`
// column ("SAGE" | "ETH") maps to these at deploy time.
export const NATIVE_CURRENCY_SENTINEL = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
export type DropCurrency = 'SAGE' | 'ETH';
export const currencyAddressFor = (currency?: string | null) =>
  currency === 'ETH'
    ? NATIVE_CURRENCY_SENTINEL
    : '0x0000000000000000000000000000000000000000';
export const isEthCurrency = (currency?: string | null) => currency === 'ETH';

// USD price lookups must always use the MAINNET token: the testnet deployment
// in ASHTOKEN_ADDRESS has no DEX pair, so it has no price.
// NOTE: DexScreener does NOT index Robinhood Chain, so it returns no pairs for
// this token. Price is read straight from the on-chain SAGE/WETH Uniswap-v2
// pair on Robinhood mainnet (see /api/sage-price) and converted to USD via the
// live ETH/USD rate.
export const SAGE_PRICE_TOKEN_ADDRESS = '0x08deaa8250beAeD65366fbbde0088E76261637bA';
export const SAGE_PRICE_RPC_URL = 'https://rpc.mainnet.chain.robinhood.com';
export const SAGE_PRICE_CHAIN_ID = 4663;
// SAGE/WETH Uniswap-v2 pair and the wrapped-native token on Robinhood mainnet.
export const SAGE_PRICE_PAIR_ADDRESS = '0x4a22349287bCda8FC97E42de9D9e0de5b9Fc5F38';
export const SAGE_PRICE_WETH_ADDRESS = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73';

var env = process.env.NEXT_PUBLIC_APP_MODE;

// SAGE runs on Robinhood Chain.
// Contract addresses are empty until the Sage-Solidity suite is deployed to the
// corresponding network (see Sage-Solidity-main, `npx hardhat run scripts/deploy.js
// --network robinhoodTestnet|robinhood`), then filled in here.
const configuration: Configuration = {
  localhost: {
    CHAIN_ID: '46630',
    NETWORK_NAME: 'robinhoodTestnet',
    RPC_URL: 'https://rpc.testnet.chain.robinhood.com',
    SUBGRAPH_URL: '',
    MEDIUM_URL: 'https://api.rss2json.com/v1/api.json?rss_url=https://medium.com/feed/@SAGE_WEB3',
    MARKETPLACE_ADDRESS: '0x5812c7B4ce6386fD6A49Cc62c0457f47c3927FFd',
    STORAGE_ADDRESS: '0x43E26D8B5c559DECb09d65F325e1405589775BA2',
    NFTFACTORY_ADDRESS: '0x21e8Bb18193Db10ddecACE141EDE66882c08D991',
    LOTTERY_ADDRESS: '0x7a7264BbDc1751C507f31cd5cec6e2b150F3725E',
    REWARDS_ADDRESS: '0x5349d0cdCA3954CEfaa69eD00A6C370E1c5818FC',
    AUCTION_ADDRESS: '0x2ee616D15f09eBB6d3D8c0Fe3F5eE42A461230bD',
    OPENEDITION_ADDRESS: '0x33d2739244f69Ed71DCC877a30691D2A5dc9b11e',
    COLLECTION_ADDRESS: '0x5aC7DB61278fFd8F19f6d93957Cd47263C62c3Bf', // SageCollection (ETH-currency redeploy 2026-07-11)
    ASHTOKEN_ADDRESS: '0x5498Ab846Bc64819eB4Fa8c1A76d7DDef594AA0B', // SAGE token (Robinhood testnet deployment)
    APP_URL: 'http://localhost:3005/',
  },
  dev: {
    CHAIN_ID: '46630',
    NETWORK_NAME: 'robinhoodTestnet',
    RPC_URL: 'https://rpc.testnet.chain.robinhood.com',
    SUBGRAPH_URL: '',
    MEDIUM_URL: 'https://api.rss2json.com/v1/api.json?rss_url=https://medium.com/feed/@SAGE_WEB3',
    MARKETPLACE_ADDRESS: '0x5812c7B4ce6386fD6A49Cc62c0457f47c3927FFd',
    STORAGE_ADDRESS: '0x43E26D8B5c559DECb09d65F325e1405589775BA2',
    NFTFACTORY_ADDRESS: '0x21e8Bb18193Db10ddecACE141EDE66882c08D991',
    LOTTERY_ADDRESS: '0x7a7264BbDc1751C507f31cd5cec6e2b150F3725E',
    REWARDS_ADDRESS: '0x5349d0cdCA3954CEfaa69eD00A6C370E1c5818FC',
    AUCTION_ADDRESS: '0x2ee616D15f09eBB6d3D8c0Fe3F5eE42A461230bD',
    OPENEDITION_ADDRESS: '0x33d2739244f69Ed71DCC877a30691D2A5dc9b11e',
    COLLECTION_ADDRESS: '0x5aC7DB61278fFd8F19f6d93957Cd47263C62c3Bf', // SageCollection (ETH-currency redeploy 2026-07-11)
    ASHTOKEN_ADDRESS: '0x5498Ab846Bc64819eB4Fa8c1A76d7DDef594AA0B', // SAGE token (Robinhood testnet deployment)
    APP_URL: 'https://sage-dev.vercel.app/',
  },
  staging: {
    CHAIN_ID: '46630',
    NETWORK_NAME: 'robinhoodTestnet',
    RPC_URL: 'https://rpc.testnet.chain.robinhood.com',
    SUBGRAPH_URL: '',
    MEDIUM_URL: 'https://api.rss2json.com/v1/api.json?rss_url=https://medium.com/feed/@SAGE_WEB3',
    MARKETPLACE_ADDRESS: '0x5812c7B4ce6386fD6A49Cc62c0457f47c3927FFd',
    STORAGE_ADDRESS: '0x43E26D8B5c559DECb09d65F325e1405589775BA2',
    NFTFACTORY_ADDRESS: '0x21e8Bb18193Db10ddecACE141EDE66882c08D991',
    LOTTERY_ADDRESS: '0x7a7264BbDc1751C507f31cd5cec6e2b150F3725E',
    REWARDS_ADDRESS: '0x5349d0cdCA3954CEfaa69eD00A6C370E1c5818FC',
    AUCTION_ADDRESS: '0x2ee616D15f09eBB6d3D8c0Fe3F5eE42A461230bD',
    OPENEDITION_ADDRESS: '0x33d2739244f69Ed71DCC877a30691D2A5dc9b11e',
    COLLECTION_ADDRESS: '0x5aC7DB61278fFd8F19f6d93957Cd47263C62c3Bf', // SageCollection (ETH-currency redeploy 2026-07-11)
    ASHTOKEN_ADDRESS: '0x5498Ab846Bc64819eB4Fa8c1A76d7DDef594AA0B', // SAGE token (Robinhood testnet deployment)
    APP_URL: 'https://sage-staging.vercel.app/',
  },
  production: {
    // Robinhood MAINNET suite — deployed + Blockscout-verified 2026-07-12
    // (Sage-Solidity-main/contracts.js robinhood block is the source of truth)
    CHAIN_ID: '4663',
    NETWORK_NAME: 'robinhood',
    RPC_URL: 'https://rpc.mainnet.chain.robinhood.com',
    SUBGRAPH_URL: '',
    MEDIUM_URL: 'https://api.rss2json.com/v1/api.json?rss_url=https://medium.com/feed/@SAGE_WEB3',
    MARKETPLACE_ADDRESS: '0x7da23353e7280d5074949eEaE765c08ABb373634',
    STORAGE_ADDRESS: '0x43E26D8B5c559DECb09d65F325e1405589775BA2',
    NFTFACTORY_ADDRESS: '0x2F529790849Ce3B6dFb226e76CcB36040df3F3Fd',
    LOTTERY_ADDRESS: '0xfF1dF77766c5dbc3C440a8d70782406B32C0Fb54',
    REWARDS_ADDRESS: '0x652595ffD447513DcA1B5e532618Af60C8791E60',
    AUCTION_ADDRESS: '0x83Eac0DCfd0bC5D52Edf4e631CdDb6C0e6438E03',
    OPENEDITION_ADDRESS: '0x2ee616D15f09eBB6d3D8c0Fe3F5eE42A461230bD',
    COLLECTION_ADDRESS: '0x2c25d08251a0a1B6Ef954811a177D85482a82373',
    ASHTOKEN_ADDRESS: '0x08deaa8250beAeD65366fbbde0088E76261637bA', // SAGE token (live on Robinhood mainnet)
    APP_URL: 'https://sageart.xyz/',
  },
};

export const parameters: Parameters = configuration[env as string];
