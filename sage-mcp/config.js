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
    openEdition: env('SAGE_OPENEDITION_ADDRESS', '0x652595ffD447513DcA1B5e532618Af60C8791E60'),
    lottery: env('SAGE_LOTTERY_ADDRESS', '0x7a7264BbDc1751C507f31cd5cec6e2b150F3725E'),
    auction: env('SAGE_AUCTION_ADDRESS', '0x2ee616D15f09eBB6d3D8c0Fe3F5eE42A461230bD'),
    rewards: env('SAGE_REWARDS_ADDRESS', '0x5349d0cdCA3954CEfaa69eD00A6C370E1c5818FC'),
  },

  // DEX chain (where ETH -> SAGE swaps happen and pixel-earning SAGE is held)
  dex: {
    rpcUrl: env('SAGE_MAINNET_RPC', 'https://rpc.mainnet.chain.robinhood.com'),
    chainId: Number(env('SAGE_MAINNET_CHAIN_ID', '4663')),
    sageToken: env('SAGE_MAINNET_TOKEN', '0x08deaa8250beAeD65366fbbde0088E76261637bA'),
    weth: env('SAGE_WETH_ADDRESS', '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73'),
    pair: env('SAGE_PAIR_ADDRESS', '0x4a22349287bCda8FC97E42de9D9e0de5b9Fc5F38'),
  },

  dexscreenerUrl: 'https://api.dexscreener.com/latest/dex/tokens',
};
