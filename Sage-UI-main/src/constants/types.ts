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
  COLLECTION_ADDRESS: string;
  REWARDS_ADDRESS: string;
  ASHTOKEN_ADDRESS: string;
  NFTFACTORY_ADDRESS: string;
  MARKETPLACE_ADDRESS: string;
  STORAGE_ADDRESS: string;
  // SAGE Social collects: the platform SageNFT posts are minted into when
  // collected. Empty string = collecting disabled on this network.
  SOCIAL_COLLECTS_ADDRESS: string;
  APP_URL: string;
}

export interface Configuration {
  [environment: string]: Parameters;
}
