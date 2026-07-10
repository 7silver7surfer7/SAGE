export interface Parameters {
  CHAIN_ID: string;
  NETWORK_NAME: string;
  LOTTERY_ADDRESS: string;
  AUCTION_ADDRESS: string;
  REWARDS_ADDRESS: string;
}

export interface Configuration {
  [environment: string]: Parameters;
}
