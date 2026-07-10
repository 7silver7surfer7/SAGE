// import WalletLink from "walletlink";
import WalletConnectProvider from '@walletconnect/web3-provider';
import Web3Modal from 'web3modal';

const providerOptions = {
  walletconnect: {
    package: WalletConnectProvider, // required
    options: {
      rpc: {
        4: 'https://rinkeby.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161',
      },
    },
  },
};

type AppWeb3Modal = any;

let web3Modal: AppWeb3Modal;
if (typeof window !== 'undefined') {
  web3Modal = new Web3Modal({
    // network: process.env.NETWORK_NAME, // optional
    cacheProvider: true,
    providerOptions, // required
  });
}

export default web3Modal;
