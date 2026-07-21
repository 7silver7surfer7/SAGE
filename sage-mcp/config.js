// All values overridable via env; defaults target the live Robinhood Chain
// deployments: marketplace contracts on TESTNET (46630), SAGE/WETH DEX pair
// on MAINNET (4663) — the only chain with a market, and the balance that
// earns pixels fastest.
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

// load sage-mcp/.env regardless of the client's working directory (Claude
// Desktop launches the server from an arbitrary cwd). Env vars already set by
// the MCP client config take precedence — dotenv does not override them.
loadEnv({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '.env') });

const env = (key, fallback) => process.env[key] ?? fallback;

export const config = {
  // the agent's wallet. Required for any transaction tool; read-only tools
  // work without it.
  agentPrivateKey: env('SAGE_AGENT_PRIVATE_KEY', ''),

  // the SAGE web app (drops catalog + pixels API, authenticated via SIWE).
  // Default is the live deployment; point at http://localhost:3005 for dev.
  siteUrl: env('SAGE_SITE_URL', 'https://sageart.xyz').replace(/\/$/, ''),

  // marketplace chain (where Auction/Lottery/OpenEdition contracts live)
  marketplace: {
    rpcUrl: env('SAGE_MARKETPLACE_RPC', 'https://rpc.testnet.chain.robinhood.com'),
    chainId: Number(env('SAGE_MARKETPLACE_CHAIN_ID', '46630')),
    sageToken: env('SAGE_TOKEN_ADDRESS', '0x5498Ab846Bc64819eB4Fa8c1A76d7DDef594AA0B'),
    openEdition: env('SAGE_OPENEDITION_ADDRESS', '0xAd99C2cE69473f9Eb44e7b1bf54940377FaC29b9'),
    lottery: env('SAGE_LOTTERY_ADDRESS', '0x7a7264BbDc1751C507f31cd5cec6e2b150F3725E'),
    auction: env('SAGE_AUCTION_ADDRESS', '0x2ee616D15f09eBB6d3D8c0Fe3F5eE42A461230bD'),
    // SageCollection is a SINGLETON — one contract hosts every collection-style
    // drop (id'd by collectionId), unlike OpenEdition/Auction/Lottery which are
    // also singletons keyed by their own ids. Same shape, just note it here
    // since it's easy to assume (wrongly) that each drop gets its own address.
    collection: env('SAGE_COLLECTION_ADDRESS', '0xd592dB71A8f8DBae57d6D6eC5a209E674B36eEc6'),
    rewards: env('SAGE_REWARDS_ADDRESS', '0x5349d0cdCA3954CEfaa69eD00A6C370E1c5818FC'),
  },

  // DEX chain (where ETH -> SAGE swaps happen and pixel-earning SAGE is held)
  dex: {
    rpcUrl: env('SAGE_MAINNET_RPC', 'https://rpc.mainnet.chain.robinhood.com'),
    chainId: Number(env('SAGE_MAINNET_CHAIN_ID', '4663')),
    // New pump.fun-style bonding-curve SAGE token (launched via SocialTokenFactory,
    // replaces the old fixed-supply token), 2026-07-15.
    sageToken: env('SAGE_MAINNET_TOKEN', '0x14561006002e8f76E68EC69e6A32527730bb73c8'),
    weth: env('SAGE_WETH_ADDRESS', '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73'),
    // Pre-graduation: SAGE trades on its own bonding curve, no pair exists.
    // Post-graduation: a real Uniswap v2 pair exists and SageSwapRouter
    // resolves it internally (_pairFor) — no separate pair address needed here.
    factory: env('SAGE_TOKEN_FACTORY_ADDRESS', '0xeF0c6F3461A373B4b6703EeBc5d44bF3885a200f'),
    router: env('SAGE_SWAP_ROUTER_ADDRESS', '0x9ae6208E6dad5AF7A48a87A621b921AbCC43F06d'),
  },

  dexscreenerUrl: 'https://api.dexscreener.com/latest/dex/tokens',
};
