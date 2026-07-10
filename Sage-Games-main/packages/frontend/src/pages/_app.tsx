import '../styles/index.scss';
import 'react-loader-spinner/dist/loader/css/react-spinner-loader.css';
import { Provider as ReduxProvider } from 'react-redux';
import { SessionProvider } from 'next-auth/react';
import store from '../store/store';
import type { AppProps } from 'next/app';
import MaintenancePage from '@/components/MaintenancePage';
import { AnimatePresence } from 'framer-motion';
import Layout from '@/components/Layout';
import { createClient, Provider as WagmiProvider, chain } from 'wagmi';
import { MetaMaskConnector } from 'wagmi/connectors/metaMask';
import { WalletConnectConnector } from 'wagmi/connectors/walletConnect';
import { CoinbaseWalletConnector } from 'wagmi/connectors/coinbaseWallet';
import { ApolloClient, ApolloProvider, InMemoryCache } from '@apollo/client';

// set up connectors
const connectors = [
  new MetaMaskConnector({
    chains: [chain.mainnet, chain.rinkeby],
  }),
  new WalletConnectConnector({
    options: {
      qrcode: true,
    },
  }),
  new CoinbaseWalletConnector({
    options: {
      appName: 'wagmi.sh',
    },
  }),
];

const wagmiClient = createClient({
  connectors,
  autoConnect: true,
});

const apolloClient = new ApolloClient({
  uri: 'https://api.studio.thegraph.com/query/28124/urndrops/v0.0.10',
  cache: new InMemoryCache(),
});

function App({ Component, pageProps, router }: AppProps) {
  if (process.env.NEXT_PUBLIC_MAINTENANCE_ON === 'true') return <MaintenancePage />;

  return (
    <ReduxProvider store={store}>
      <WagmiProvider client={wagmiClient}>
        <SessionProvider session={pageProps.session} refetchInterval={0}>
          <ApolloProvider client={apolloClient}>
            <AnimatePresence>
              <Layout router={router}>
                <Component {...pageProps} />
              </Layout>
            </AnimatePresence>
          </ApolloProvider>
        </SessionProvider>
      </WagmiProvider>
    </ReduxProvider>
  );
}

export default App;
