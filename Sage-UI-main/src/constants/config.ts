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

// ── Robinhood mainnet as a TRADING venue ───────────────────────────────────
// The agent always trades on mainnet, whatever NEXT_PUBLIC_APP_MODE the build
// was made with — the same reasoning as the price constants above. Routing a
// buy through `parameters` instead is what broke the first live order: a
// staging build resolved SAGE to the mainnet address but signed against chain
// 46630, where 0x1456… has no code, so ethers failed with a bare
// `call revert exception` that told the user nothing. Testnet cannot be the
// fallback either — SAGE was never launched on the testnet factory.
export const TRADE_CHAIN_ID = SAGE_PRICE_CHAIN_ID;
export const TRADE_CHAIN_NAME = 'Robinhood Chain';
export const TRADE_RPC_URL = SAGE_PRICE_RPC_URL;
export const TRADE_ROUTER_ADDRESS = SAGE_PRICE_ROUTER_ADDRESS;
// The CHAIN-WIDE Uniswap v2 router, for tokens SAGE did not launch.
// SageSwapRouter only resolves pairs through its own curve factory, so it
// answers "not graduated" for every token minted elsewhere on Robinhood —
// Cash Cat (0x020bfc65…) is real, has a live WETH pair, and was unreachable.
// Discovered from the Swap senders on that pair; its factory() matches
// UNISWAP_FACTORY_ADDRESS below.
export const TRADE_DEX_ROUTER_ADDRESS = '0x89e5DB8B5aA49aA85AC63f691524311AEB649eba';
export const TRADE_WETH_ADDRESS = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73';
// The chain-wide pair factory behind that router — what the indexer sweeps
// when asked for the trading chain rather than the build's own.
export const TRADE_DEX_FACTORY_ADDRESS = '0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f';
// The MAINNET NFT launcher. The agent mints on the same chain it trades on, so
// this cannot come from `parameters`: a localhost build resolved the testnet
// launcher (0x72D0945…) and sent a mint to it on mainnet, where it has no
// code. Calling a codeless address does not revert — it silently succeeds — so
// the edition never deployed and the receipt carried no event.
export const TRADE_NFT_LAUNCHER_ADDRESS = '0xFb409D31eaEB48e47F57134CC0e83b871eb7819e';

// Where a claim link in a PUBLIC tweet must point. Never `parameters.APP_URL`:
// on a localhost build that is http://localhost:3005/, and a reply carrying it
// would be a dead link for everyone who reads it. Same reasoning as the trade
// constants above — the audience is the public internet, not this build.
// Now the APEX. This pointed at testnet.sageart.xyz while /agent 404'd on
// production — the note said to move it the day /agent shipped there, and
// 2026-07-25 is that day: /agent serves 200 and ANTHROPIC_API_KEY finally
// reached the production runtime.
//
// Leaving it on testnet became actively wrong the moment the mention bot moved
// to Cloud Scheduler, because the claim row is written to whatever database the
// POLLER talked to. The poller now runs on production, so a testnet link sends
// the reader to a site that does not have their claim — a dead link under the
// brand's own byline, which is the exact failure this constant exists to stop.
export const PUBLIC_SITE_URL = 'https://sageart.xyz/';

// -- Uniswap v4 on Robinhood mainnet ---------------------------------------
// Every venue above speaks v2 (getPair/getReserves). v4 has neither: pools are
// singleton state inside a PoolManager, keyed by a PoolKey. So a v4 token reads
// as "no market" to all of them, which is exactly why the new SAGE looked
// unlisted while holding real liquidity -- and v4 is where this chain's volume
// actually is (1,112 swaps in a recent window against a handful on v2).
// Verified: the quoter and StateView both report poolManager() == V4_POOL_MANAGER.
export const V4_POOL_MANAGER = '0x8366a39CC670B4001A1121B8F6A443A643e40951';
export const V4_QUOTER = '0x51f88773169B5598a047fe514f13835E610b69D1';
export const V4_STATE_VIEW = '0xF3334192D15450CdD385c8B70e03f9A6bD9E673b';
export const V4_UNIVERSAL_ROUTER = '0x8876789976dEcBfCbBbe364623C63652db8C0904';

// The SECOND SAGE token -- a Doppler launch trading on v4, not on the bonding
// curve. Deliberately NOT wired into ASHTOKEN_ADDRESS or points accrual:
// repointing those before holders migrate would strand the 284 holders of the
// original token. Listed here so the site can price and link it meanwhile.
export const SAGE_V2_TOKEN_ADDRESS = '0xE21a2b120FAcF995bC8bF6b1843f409E568beBA3';

// The token Pixels accrue from. Pinned, NOT read from `parameters`: that
// resolves the TESTNET address on a localhost or staging build, and an accrual
// job pointed at a token with no holders pays nobody while appearing to work —
// the same class of bug that sent a mint to a codeless address.
export const PIXELS_TOKEN_ADDRESS = SAGE_V2_TOKEN_ADDRESS;

// The token Pixels USED to accrue from. During the migration window a holder
// still earns on it, so the 284 wallets holding it do not hit a cliff the day
// the cutover ships. See pixelsLedger: the two balances are compared, never
// summed, so nobody earns from both.
export const PIXELS_LEGACY_TOKEN_ADDRESS = SAGE_PRICE_TOKEN_ADDRESS;

// When legacy accrual stops. A fixed instant, not "two weeks from deploy":
// the date has to be announceable and identical on every instance, and a
// deploy-relative window would silently restart on every redeploy.
//
// VALIDATED AND FAIL-LOUD, because the failure was silent and total. This read
// `new Date(process.env.X || default)` with no check, and an unparseable
// override makes `now < PIXELS_MIGRATION_ENDS_AT` FALSE — an Invalid Date
// compares false against everything. So one typo in an env var reads as "the
// window already closed", everywhere, instantly, and every legacy holder's
// accrual drops to zero with nothing logged. That is the single worst outcome
// this constant can produce, and it was the default behaviour of a typo. A
// deploy that refuses to boot is strictly better: it fails where someone is
// watching.
//
// NEXT_PUBLIC_ so the BROWSER sees an override too. A bare `process.env.X` is
// not inlined into the client bundle (there is no `env` block in
// next.config.js), so useSAGEAccount kept evaluating the hardcoded date while
// the server honoured the override — the two disagreeing about whether legacy
// tokens still earn. The old name is still read for the server, so an existing
// deployment does not change meaning on upgrade.
const PIXELS_MIGRATION_DEFAULT = '2026-08-08T00:00:00Z';
const pixelsMigrationRaw =
  process.env.NEXT_PUBLIC_PIXELS_MIGRATION_ENDS_AT ||
  process.env.PIXELS_MIGRATION_ENDS_AT ||
  PIXELS_MIGRATION_DEFAULT;
const pixelsMigrationEnd = new Date(pixelsMigrationRaw);
if (Number.isNaN(pixelsMigrationEnd.getTime())) {
  throw new Error(
    `PIXELS_MIGRATION_ENDS_AT is not a valid ISO-8601 instant: ${JSON.stringify(pixelsMigrationRaw)}. ` +
      `Refusing to start — an unparseable value silently closes the migration window and zeroes ` +
      `every legacy holder's accrual.`
  );
}
export const PIXELS_MIGRATION_ENDS_AT = pixelsMigrationEnd;
// Candidate factories, newest first. A token's curve state lives in the
// storage of whichever factory launched it and can never be migrated, so
// resolution WALKS this list instead of assuming the current one — that is
// what makes an arbitrary token resolvable, not just SAGE.
export const TRADE_FACTORY_ADDRESSES = [
  '0xcF7BF8EB756849dc46f7eD26a7D5F4CA17616Cde', // current — LP-to-treasury, 2026-07-19
  '0x6a22f6647b00022928bb103E66fA0a6659f7A64F', // pre-2026-07-19
  SAGE_PRICE_FACTORY_ADDRESS, // original — SAGE graduated here
];

// The chain-wide DEX product (screener, pair pages, ext charts, indexer
// sweeps) ships dark: every surface gates on this BUILD-TIME flag, off
// unless the build sets NEXT_PUBLIC_DEX_ENABLED=true (deploy scripts pass
// it through when exported). Turning it off is the product call of
// 2026-07-21 — the code stays built, tested and committed so one env var
// re-lights it; nothing needs re-reverting or rebuilding.
export const DEX_ENABLED = process.env.NEXT_PUBLIC_DEX_ENABLED === 'true';

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
    OPENEDITION_VOUCHER_ADDRESS: '0x224EC65Cd5F65a60D05399798d05b5D2daFa0705', // voucher-gated OE, 2026-07-22
    COLLECTION_ADDRESS: '0xd592dB71A8f8DBae57d6D6eC5a209E674B36eEc6', // one-tx collection-drop deploy (createCollectionWithNewNft + DedicatedNftDeployer), 2026-07-14
    ASHTOKEN_ADDRESS: '0x5498Ab846Bc64819eB4Fa8c1A76d7DDef594AA0B', // SAGE token (Robinhood testnet deployment)
    SOCIAL_COLLECTS_ADDRESS: '0x78cBa250326a19891f67581e2bD8e0D1A11Eb07e',
    SOCIAL_TOKEN_FACTORY_ADDRESS: '0x3297f9CEe3e0858325e826CbFF8FDE04Ee36DC49', // v9: dynamic mcap-tiered fees
    WHITELIST_FACTORY_ADDRESS: '0x6837736F51e0FF4FE25d2B55195583EcafA9AE2a', // EIP-1167 clones, 2026-07-22
    // chain-wide dex indexer (reads every pair, not just our launches)
    UNISWAP_FACTORY_ADDRESS: '0xDfB9F8A7eF56C39C1eaE28f502b754321A82a625',
    WETH_ADDRESS: '0xC433C2fb24456290625217e297D9C5db1762a82f',
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
    OPENEDITION_VOUCHER_ADDRESS: '0x224EC65Cd5F65a60D05399798d05b5D2daFa0705', // voucher-gated OE, 2026-07-22
    COLLECTION_ADDRESS: '0xd592dB71A8f8DBae57d6D6eC5a209E674B36eEc6', // one-tx collection-drop deploy (createCollectionWithNewNft + DedicatedNftDeployer), 2026-07-14
    ASHTOKEN_ADDRESS: '0x5498Ab846Bc64819eB4Fa8c1A76d7DDef594AA0B', // SAGE token (Robinhood testnet deployment)
    SOCIAL_COLLECTS_ADDRESS: '0x78cBa250326a19891f67581e2bD8e0D1A11Eb07e',
    SOCIAL_TOKEN_FACTORY_ADDRESS: '0x3297f9CEe3e0858325e826CbFF8FDE04Ee36DC49', // v9: dynamic mcap-tiered fees
    WHITELIST_FACTORY_ADDRESS: '0x6837736F51e0FF4FE25d2B55195583EcafA9AE2a', // EIP-1167 clones, 2026-07-22
    // chain-wide dex indexer (reads every pair, not just our launches)
    UNISWAP_FACTORY_ADDRESS: '0xDfB9F8A7eF56C39C1eaE28f502b754321A82a625',
    WETH_ADDRESS: '0xC433C2fb24456290625217e297D9C5db1762a82f',
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
    OPENEDITION_VOUCHER_ADDRESS: '0x224EC65Cd5F65a60D05399798d05b5D2daFa0705', // voucher-gated OE, 2026-07-22
    COLLECTION_ADDRESS: '0xd592dB71A8f8DBae57d6D6eC5a209E674B36eEc6', // one-tx collection-drop deploy (createCollectionWithNewNft + DedicatedNftDeployer), 2026-07-14
    ASHTOKEN_ADDRESS: '0x5498Ab846Bc64819eB4Fa8c1A76d7DDef594AA0B', // SAGE token (Robinhood testnet deployment)
    SOCIAL_COLLECTS_ADDRESS: '0x78cBa250326a19891f67581e2bD8e0D1A11Eb07e',
    SOCIAL_TOKEN_FACTORY_ADDRESS: '0x3297f9CEe3e0858325e826CbFF8FDE04Ee36DC49', // v9: dynamic mcap-tiered fees
    WHITELIST_FACTORY_ADDRESS: '0x6837736F51e0FF4FE25d2B55195583EcafA9AE2a', // EIP-1167 clones, 2026-07-22
    // chain-wide dex indexer (reads every pair, not just our launches)
    UNISWAP_FACTORY_ADDRESS: '0xDfB9F8A7eF56C39C1eaE28f502b754321A82a625',
    WETH_ADDRESS: '0xC433C2fb24456290625217e297D9C5db1762a82f',
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
    OPENEDITION_VOUCHER_ADDRESS: '0xD2145cB292A3570Da725276939D61FC546b8A5c8', // voucher-gated OE (mainnet), 2026-07-22
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
    WHITELIST_FACTORY_ADDRESS: '0xa025C60C8efbC10085AE89CA5e9994385BA44284', // EIP-1167 clones, 2026-07-22
    // chain-wide dex indexer: the canonical Uniswap V2 factory this chain's
    // whole ecosystem trades on (17.5k pairs at index time) + its WETH
    UNISWAP_FACTORY_ADDRESS: '0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f',
    WETH_ADDRESS: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
    SAGE_SWAP_ROUTER_ADDRESS: '0x9ae6208E6dad5AF7A48a87A621b921AbCC43F06d', // audit fix: fee cap, 2026-07-15
    SAGE_POINTS_ADDRESS: '0x78cBa250326a19891f67581e2bD8e0D1A11Eb07e', // v3: checkpoint accrual (fixes phantom identical-points + flash-farm); seeded with each holder's credit-from-purchase so no zero-window, 2026-07-16
    SOCIAL_COLLECT_MINTER_ADDRESS: '0x1CB82fD07576B38d4bD1E2fcE6C49e9f8472c34B', // buyer-pays-gas voucher mints, 2026-07-20
    SOCIAL_NFT_LAUNCHER_ADDRESS: '0xFb409D31eaEB48e47F57134CC0e83b871eb7819e', // SAGE Social (mainnet, 2026-07-15)
    SOCIAL_FAUCET_ADDRESS: '', // deferred — new mainnet users bring their own ETH for gas
    APP_URL: 'https://sageart.xyz/',
  },
};

export const parameters: Parameters = configuration[env as string];
