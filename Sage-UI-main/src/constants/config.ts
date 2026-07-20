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
// this token. SAGE is a pump.fun-style bonding-curve token launched via
// SocialTokenFactory (2026-07-15) — price is read from the curve's own
// spotPriceWei() pre-graduation, or SageSwapRouter's poolPriceWei() once it
// graduates to a real Uniswap v2 pair (see getSagePriceUsd() in sagePrice.ts,
// which mirrors the exact dual-source logic token/[address].page.tsx already
// uses for every OTHER social token), converted to USD via the live ETH/USD rate.
export const SAGE_PRICE_TOKEN_ADDRESS = '0x14561006002e8f76E68EC69e6A32527730bb73c8';
export const SAGE_PRICE_RPC_URL = 'https://rpc.mainnet.chain.robinhood.com';
export const SAGE_PRICE_CHAIN_ID = 4663;
export const SAGE_PRICE_FACTORY_ADDRESS = '0xeF0c6F3461A373B4b6703EeBc5d44bF3885a200f';
export const SAGE_PRICE_ROUTER_ADDRESS = '0x9ae6208E6dad5AF7A48a87A621b921AbCC43F06d';

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
    MARKETPLACE_ADDRESS: '0x7315fa4dcAA74E1EFa7c121E0848f42c7D746dC1', // security fix: chainId binding + unchecked-transfer redeploy, 2026-07-14
    STORAGE_ADDRESS: '0x43E26D8B5c559DECb09d65F325e1405589775BA2',
    NFTFACTORY_ADDRESS: '0xfCd2BC43D09e10a5f2C6f015533C607b5cd62D0D',
    LOTTERY_ADDRESS: '0x7a7264BbDc1751C507f31cd5cec6e2b150F3725E',
    REWARDS_ADDRESS: '0x5349d0cdCA3954CEfaa69eD00A6C370E1c5818FC',
    AUCTION_ADDRESS: '0x2ee616D15f09eBB6d3D8c0Fe3F5eE42A461230bD',
    OPENEDITION_ADDRESS: '0x7BaBf8b8043527D7a5dfB50F32dEe97898Db5091', // security fix: spoofable-artist-check redeploy, 2026-07-15
    COLLECTION_ADDRESS: '0xd592dB71A8f8DBae57d6D6eC5a209E674B36eEc6', // one-tx collection-drop deploy (createCollectionWithNewNft + DedicatedNftDeployer), 2026-07-14
    ASHTOKEN_ADDRESS: '0x5498Ab846Bc64819eB4Fa8c1A76d7DDef594AA0B', // SAGE token (Robinhood testnet deployment)
    SOCIAL_COLLECTS_ADDRESS: '0x78cBa250326a19891f67581e2bD8e0D1A11Eb07e',
    SOCIAL_TOKEN_FACTORY_ADDRESS: '0x3297f9CEe3e0858325e826CbFF8FDE04Ee36DC49', // v9: dynamic mcap-tiered fees
    SAGE_SWAP_ROUTER_ADDRESS: '0x38C76b9CA63F3A450D2A8C366a775eb93914C73F', // v2: dynamic tiers + creator fees
    SAGE_POINTS_ADDRESS: '0x2CbBc5f92B1b0bc7Dea43b894C94B59B3a8e2d36', // streaming pixels
    SOCIAL_COLLECT_MINTER_ADDRESS: '0x802F87090FAdf9Cb8Af06fB079fa159Ebf58e554',
    SOCIAL_NFT_LAUNCHER_ADDRESS: '0x72D094516679CC800D25FeBBC9a48B98ccDb1C67', // SAGE Social (testnet, 2026-07-13)
    SOCIAL_FAUCET_ADDRESS: '', // hidden per user request 2026-07-15 — contract (0xcFF533bfA8374EE359e646dAFeb1c76664A64136) still deployed+funded, just unlinked
    APP_URL: 'http://localhost:3005/',
  },
  dev: {
    CHAIN_ID: '46630',
    NETWORK_NAME: 'robinhoodTestnet',
    RPC_URL: 'https://rpc.testnet.chain.robinhood.com',
    SUBGRAPH_URL: '',
    MEDIUM_URL: 'https://api.rss2json.com/v1/api.json?rss_url=https://medium.com/feed/@SAGE_WEB3',
    MARKETPLACE_ADDRESS: '0x7315fa4dcAA74E1EFa7c121E0848f42c7D746dC1', // security fix: chainId binding + unchecked-transfer redeploy, 2026-07-14
    STORAGE_ADDRESS: '0x43E26D8B5c559DECb09d65F325e1405589775BA2',
    NFTFACTORY_ADDRESS: '0xfCd2BC43D09e10a5f2C6f015533C607b5cd62D0D',
    LOTTERY_ADDRESS: '0x7a7264BbDc1751C507f31cd5cec6e2b150F3725E',
    REWARDS_ADDRESS: '0x5349d0cdCA3954CEfaa69eD00A6C370E1c5818FC',
    AUCTION_ADDRESS: '0x2ee616D15f09eBB6d3D8c0Fe3F5eE42A461230bD',
    OPENEDITION_ADDRESS: '0x7BaBf8b8043527D7a5dfB50F32dEe97898Db5091', // security fix: spoofable-artist-check redeploy, 2026-07-15
    COLLECTION_ADDRESS: '0xd592dB71A8f8DBae57d6D6eC5a209E674B36eEc6', // one-tx collection-drop deploy (createCollectionWithNewNft + DedicatedNftDeployer), 2026-07-14
    ASHTOKEN_ADDRESS: '0x5498Ab846Bc64819eB4Fa8c1A76d7DDef594AA0B', // SAGE token (Robinhood testnet deployment)
    SOCIAL_COLLECTS_ADDRESS: '0x78cBa250326a19891f67581e2bD8e0D1A11Eb07e',
    SOCIAL_TOKEN_FACTORY_ADDRESS: '0x3297f9CEe3e0858325e826CbFF8FDE04Ee36DC49', // v9: dynamic mcap-tiered fees
    SAGE_SWAP_ROUTER_ADDRESS: '0x38C76b9CA63F3A450D2A8C366a775eb93914C73F', // v2: dynamic tiers + creator fees
    SAGE_POINTS_ADDRESS: '0x2CbBc5f92B1b0bc7Dea43b894C94B59B3a8e2d36', // streaming pixels
    SOCIAL_COLLECT_MINTER_ADDRESS: '0x802F87090FAdf9Cb8Af06fB079fa159Ebf58e554',
    SOCIAL_NFT_LAUNCHER_ADDRESS: '0x72D094516679CC800D25FeBBC9a48B98ccDb1C67', // SAGE Social (testnet, 2026-07-13)
    SOCIAL_FAUCET_ADDRESS: '', // hidden per user request 2026-07-15 — contract (0xcFF533bfA8374EE359e646dAFeb1c76664A64136) still deployed+funded, just unlinked
    APP_URL: 'https://sage-dev.vercel.app/',
  },
  staging: {
    CHAIN_ID: '46630',
    NETWORK_NAME: 'robinhoodTestnet',
    RPC_URL: 'https://rpc.testnet.chain.robinhood.com',
    SUBGRAPH_URL: '',
    MEDIUM_URL: 'https://api.rss2json.com/v1/api.json?rss_url=https://medium.com/feed/@SAGE_WEB3',
    MARKETPLACE_ADDRESS: '0x7315fa4dcAA74E1EFa7c121E0848f42c7D746dC1', // security fix: chainId binding + unchecked-transfer redeploy, 2026-07-14
    STORAGE_ADDRESS: '0x43E26D8B5c559DECb09d65F325e1405589775BA2',
    NFTFACTORY_ADDRESS: '0xfCd2BC43D09e10a5f2C6f015533C607b5cd62D0D',
    LOTTERY_ADDRESS: '0x7a7264BbDc1751C507f31cd5cec6e2b150F3725E',
    REWARDS_ADDRESS: '0x5349d0cdCA3954CEfaa69eD00A6C370E1c5818FC',
    AUCTION_ADDRESS: '0x2ee616D15f09eBB6d3D8c0Fe3F5eE42A461230bD',
    OPENEDITION_ADDRESS: '0x7BaBf8b8043527D7a5dfB50F32dEe97898Db5091', // security fix: spoofable-artist-check redeploy, 2026-07-15
    COLLECTION_ADDRESS: '0xd592dB71A8f8DBae57d6D6eC5a209E674B36eEc6', // one-tx collection-drop deploy (createCollectionWithNewNft + DedicatedNftDeployer), 2026-07-14
    ASHTOKEN_ADDRESS: '0x5498Ab846Bc64819eB4Fa8c1A76d7DDef594AA0B', // SAGE token (Robinhood testnet deployment)
    SOCIAL_COLLECTS_ADDRESS: '0x78cBa250326a19891f67581e2bD8e0D1A11Eb07e',
    SOCIAL_TOKEN_FACTORY_ADDRESS: '0x3297f9CEe3e0858325e826CbFF8FDE04Ee36DC49', // v9: dynamic mcap-tiered fees
    SAGE_SWAP_ROUTER_ADDRESS: '0x38C76b9CA63F3A450D2A8C366a775eb93914C73F', // v2: dynamic tiers + creator fees
    SAGE_POINTS_ADDRESS: '0x2CbBc5f92B1b0bc7Dea43b894C94B59B3a8e2d36', // streaming pixels
    SOCIAL_COLLECT_MINTER_ADDRESS: '0x802F87090FAdf9Cb8Af06fB079fa159Ebf58e554',
    SOCIAL_NFT_LAUNCHER_ADDRESS: '0x72D094516679CC800D25FeBBC9a48B98ccDb1C67', // SAGE Social (testnet, 2026-07-13)
    SOCIAL_FAUCET_ADDRESS: '', // hidden per user request 2026-07-15 — contract (0xcFF533bfA8374EE359e646dAFeb1c76664A64136) still deployed+funded, just unlinked
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
    MARKETPLACE_ADDRESS: '0x5aC7DB61278fFd8F19f6d93957Cd47263C62c3Bf', // audit fix: royaltyInfo() reentrancy, 2026-07-15
    STORAGE_ADDRESS: '0x43E26D8B5c559DECb09d65F325e1405589775BA2',
    NFTFACTORY_ADDRESS: '0x2DEEe3E67ed5044e85c934979aAD9CC8fcc8F740', // audit fix round 3: SageNFT withdraw() reentrancy guard + constructor share bound, 2026-07-15
    LOTTERY_ADDRESS: '0xfF1dF77766c5dbc3C440a8d70782406B32C0Fb54', // same contract — UUPS-upgraded in place with audit fixes, 2026-07-15
    REWARDS_ADDRESS: '0x652595ffD447513DcA1B5e532618Af60C8791E60',
    AUCTION_ADDRESS: '0x83Eac0DCfd0bC5D52Edf4e631CdDb6C0e6438E03', // same contract — UUPS-upgraded in place with audit fixes, 2026-07-15
    OPENEDITION_ADDRESS: '0x78cA991872839Bfa6223A41039E3895ce8eefF5D', // audit fix: unchecked transferFrom, 2026-07-15
    COLLECTION_ADDRESS: '0xc9821B48922111fBe9067f4f63bdD0A6599aC81C', // audit fix: was still on the old SAGE token, 2026-07-15. The old address (0x2c25d0...) stays valid forever for collection #1 (sold out 100/100) via its own stored CollectionMint.contractAddress row.
    // New pump.fun-style bonding-curve SAGE token, launched via SocialTokenFactory
    // (creator = the treasury multisig, permanent). Replaces the old fixed-supply
    // token as the platform's sole SAGE currency, 2026-07-15.
    ASHTOKEN_ADDRESS: '0x14561006002e8f76E68EC69e6A32527730bb73c8',
    SOCIAL_COLLECTS_ADDRESS: '0x8d78D5E9cb3F367B43b377E947E9f0854c93db5A', // SAGE Social (mainnet, 2026-07-15)
    // LP-to-treasury factory (2026-07-19): graduation now mints LP to the
    // treasury multisig instead of burning it to 0xdEaD. The burn design
    // ("nobody can rug the pool") also meant nobody could ever collect the
    // 0.30% Uniswap LP fee — SAGE's own pool paid ~$1.2k of unclaimable fees
    // on its first $400k of volume before this was caught. FUTURE launches
    // use this. The existing SAGE token stays on the ORIGINAL factory
    // (0xeF0c6F34…, still in SAGE_PRICE_FACTORY_ADDRESS) — its curve state
    // lives there and can't be moved, so socialToken.ts / social.page.ts
    // route SAGE's own trades back to it via factoryAddressForToken(). The
    // prior "audit round 3" factory (0x6a22f664…) is now superseded for new
    // launches but stays live for any token that already graduated on it.
    SOCIAL_TOKEN_FACTORY_ADDRESS: '0xcF7BF8EB756849dc46f7eD26a7D5F4CA17616Cde', // LP-to-treasury, 2026-07-19
    SAGE_SWAP_ROUTER_ADDRESS: '0x9ae6208E6dad5AF7A48a87A621b921AbCC43F06d', // audit fix: fee cap, 2026-07-15
    SAGE_POINTS_ADDRESS: '0x78cBa250326a19891f67581e2bD8e0D1A11Eb07e', // v3: checkpoint accrual (fixes phantom identical-points + flash-farm); seeded with each holder's credit-from-purchase so no zero-window, 2026-07-16
    SOCIAL_COLLECT_MINTER_ADDRESS: '0x1CB82fD07576B38d4bD1E2fcE6C49e9f8472c34B', // buyer-pays-gas voucher mints, 2026-07-20
    SOCIAL_NFT_LAUNCHER_ADDRESS: '0xFb409D31eaEB48e47F57134CC0e83b871eb7819e', // SAGE Social (mainnet, 2026-07-15)
    SOCIAL_FAUCET_ADDRESS: '', // deferred — new mainnet users bring their own ETH for gas
    APP_URL: 'https://sageart.xyz/',
  },
};

export const parameters: Parameters = configuration[env as string];
