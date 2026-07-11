import { Configuration, Parameters } from './types';

export const DEFAULT_PROFILE_PICTURE = '/branding/sage-icon.svg';
export const OPTIMIZED_IMAGE_WIDTH = 487;

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
    MARKETPLACE_ADDRESS: '0x1c07c5262652f822eB73c862f1E1FfD7A0A7469E',
    STORAGE_ADDRESS: '0x43E26D8B5c559DECb09d65F325e1405589775BA2',
    NFTFACTORY_ADDRESS: '0x21e8Bb18193Db10ddecACE141EDE66882c08D991',
    LOTTERY_ADDRESS: '0x7a7264BbDc1751C507f31cd5cec6e2b150F3725E',
    REWARDS_ADDRESS: '0x5349d0cdCA3954CEfaa69eD00A6C370E1c5818FC',
    AUCTION_ADDRESS: '0x2ee616D15f09eBB6d3D8c0Fe3F5eE42A461230bD',
    OPENEDITION_ADDRESS: '0x652595ffD447513DcA1B5e532618Af60C8791E60', // deployed 2026-07-09
    ASHTOKEN_ADDRESS: '0x5498Ab846Bc64819eB4Fa8c1A76d7DDef594AA0B', // SAGE token (Robinhood testnet deployment)
    APP_URL: 'http://localhost:3005/',
  },
  dev: {
    CHAIN_ID: '46630',
    NETWORK_NAME: 'robinhoodTestnet',
    RPC_URL: 'https://rpc.testnet.chain.robinhood.com',
    SUBGRAPH_URL: '',
    MEDIUM_URL: 'https://api.rss2json.com/v1/api.json?rss_url=https://medium.com/feed/@SAGE_WEB3',
    MARKETPLACE_ADDRESS: '0x1c07c5262652f822eB73c862f1E1FfD7A0A7469E',
    STORAGE_ADDRESS: '0x43E26D8B5c559DECb09d65F325e1405589775BA2',
    NFTFACTORY_ADDRESS: '0x21e8Bb18193Db10ddecACE141EDE66882c08D991',
    LOTTERY_ADDRESS: '0x7a7264BbDc1751C507f31cd5cec6e2b150F3725E',
    REWARDS_ADDRESS: '0x5349d0cdCA3954CEfaa69eD00A6C370E1c5818FC',
    AUCTION_ADDRESS: '0x2ee616D15f09eBB6d3D8c0Fe3F5eE42A461230bD',
    OPENEDITION_ADDRESS: '0x652595ffD447513DcA1B5e532618Af60C8791E60', // deployed 2026-07-09
    ASHTOKEN_ADDRESS: '0x5498Ab846Bc64819eB4Fa8c1A76d7DDef594AA0B', // SAGE token (Robinhood testnet deployment)
    APP_URL: 'https://sage-dev.vercel.app/',
  },
  staging: {
    CHAIN_ID: '46630',
    NETWORK_NAME: 'robinhoodTestnet',
    RPC_URL: 'https://rpc.testnet.chain.robinhood.com',
    SUBGRAPH_URL: '',
    MEDIUM_URL: 'https://api.rss2json.com/v1/api.json?rss_url=https://medium.com/feed/@SAGE_WEB3',
    MARKETPLACE_ADDRESS: '0x1c07c5262652f822eB73c862f1E1FfD7A0A7469E',
    STORAGE_ADDRESS: '0x43E26D8B5c559DECb09d65F325e1405589775BA2',
    NFTFACTORY_ADDRESS: '0x21e8Bb18193Db10ddecACE141EDE66882c08D991',
    LOTTERY_ADDRESS: '0x7a7264BbDc1751C507f31cd5cec6e2b150F3725E',
    REWARDS_ADDRESS: '0x5349d0cdCA3954CEfaa69eD00A6C370E1c5818FC',
    AUCTION_ADDRESS: '0x2ee616D15f09eBB6d3D8c0Fe3F5eE42A461230bD',
    OPENEDITION_ADDRESS: '0x652595ffD447513DcA1B5e532618Af60C8791E60', // deployed 2026-07-09
    ASHTOKEN_ADDRESS: '0x5498Ab846Bc64819eB4Fa8c1A76d7DDef594AA0B', // SAGE token (Robinhood testnet deployment)
    APP_URL: 'https://sage-staging.vercel.app/',
  },
  production: {
    CHAIN_ID: '4663',
    NETWORK_NAME: 'robinhood',
    RPC_URL: 'https://rpc.mainnet.chain.robinhood.com',
    SUBGRAPH_URL: '',
    MEDIUM_URL: 'https://api.rss2json.com/v1/api.json?rss_url=https://medium.com/feed/@SAGE_WEB3',
    MARKETPLACE_ADDRESS: '',
    STORAGE_ADDRESS: '',
    NFTFACTORY_ADDRESS: '',
    LOTTERY_ADDRESS: '',
    REWARDS_ADDRESS: '',
    AUCTION_ADDRESS: '',
    OPENEDITION_ADDRESS: '', // fill after SAGEOpenEdition deploy
    ASHTOKEN_ADDRESS: '0x08deaa8250beAeD65366fbbde0088E76261637bA', // SAGE token (live on Robinhood mainnet)
    APP_URL: 'https://www.sage.art/',
  },
};

export const parameters: Parameters = configuration[env as string];
