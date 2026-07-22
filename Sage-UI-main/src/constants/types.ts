import { chain } from 'wagmi';

type networks = keyof typeof chain | 'robinhood' | 'robinhoodTestnet';

export interface Parameters {
  CHAIN_ID: string;
  NETWORK_NAME: networks;
  RPC_URL: string;
  SUBGRAPH_URL: string;
  MEDIUM_URL: string;
  LOTTERY_ADDRESS: string;
  AUCTION_ADDRESS: string;
  OPENEDITION_ADDRESS: string;
  // Voucher-gated OpenEdition (gas-free gating via batchMintWithVoucher).
  // Empty = feature not deployed on this network; gated drops fall back to
  // the whitelist path on OPENEDITION_ADDRESS.
  OPENEDITION_VOUCHER_ADDRESS: string;
  COLLECTION_ADDRESS: string;
  REWARDS_ADDRESS: string;
  ASHTOKEN_ADDRESS: string;
  NFTFACTORY_ADDRESS: string;
  MARKETPLACE_ADDRESS: string;
  STORAGE_ADDRESS: string;
  // SAGE Social collects: the platform SageNFT posts are minted into when
  // collected. Empty string = collecting disabled on this network.
  SOCIAL_COLLECTS_ADDRESS: string;
  // SAGE Social pump.fun-style token launchpad + buyer-paid voucher minter.
  // Empty string = feature disabled on this network.
  SOCIAL_TOKEN_FACTORY_ADDRESS: string;
  // EIP-1167 clone factory for per-drop SageWhitelists; empty = full deploys
  WHITELIST_FACTORY_ADDRESS: string;
  UNISWAP_FACTORY_ADDRESS: string;
  WETH_ADDRESS: string;
  SAGE_POINTS_ADDRESS: string;
  SAGE_SWAP_ROUTER_ADDRESS: string;
  SOCIAL_COLLECT_MINTER_ADDRESS: string;
  SOCIAL_NFT_LAUNCHER_ADDRESS: string;
  // Once-a-day SAGE drip. Empty string = feature disabled on this network.
  SOCIAL_FAUCET_ADDRESS: string;
  APP_URL: string;
}

export interface Configuration {
  [environment: string]: Parameters;
}
