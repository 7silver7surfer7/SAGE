import { Configuration, Parameters } from './types';

var env = process.env.NEXT_PUBLIC_APP_MODE;

const configuration: Configuration = {
  rinkeby: {
    CHAIN_ID: '4',
    NETWORK_NAME: 'Rinkeby',
    LOTTERY_ADDRESS: '0x4732D73D8526E4b05E2dEdaC1E65f7eC1F544686',
    AUCTION_ADDRESS: '0xCa9Fb63e13410Be1aD2AF42DFc9D14E1D70fF902',
    REWARDS_ADDRESS: '0xe15E098CBF9f479Dba9cC7450b59E0e7bf1596B1',
  },
  dev: {
    CHAIN_ID: '4',
    NETWORK_NAME: 'Rinkeby',
    LOTTERY_ADDRESS: '0x4739333048030cBB3860ED411a7129744d833757',
    AUCTION_ADDRESS: '0x857053dd8E42F4f7eB3862ECaE025067013e0def',
    REWARDS_ADDRESS: '0xe15E098CBF9f479Dba9cC7450b59E0e7bf1596B1',
  },
};

export const parameters: Parameters = configuration[env as string];
