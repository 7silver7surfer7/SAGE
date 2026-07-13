import '@/styles/index.scss';
import { Analytics } from '@vercel/analytics/react';
import Head from 'next/head';
import Script from 'next/script';
import useTheme from '@/hooks/useTheme';
import { Provider as ReduxProvider } from 'react-redux';
import { SessionProvider } from 'next-auth/react';
import store from '@/store/store';
import type { AppProps } from 'next/app';
import Layout from '@/components/Layout/Layout';
import { createClient, WagmiConfig, configureChains } from 'wagmi';
import { jsonRpcProvider } from 'wagmi/providers/jsonRpc';
import '@rainbow-me/rainbowkit/styles.css';
import {
  RainbowKitProvider,
  connectorsForWallets,
  lightTheme,
  darkTheme,
} from '@rainbow-me/rainbowkit';
import { coinbaseWallet, injectedWallet } from '@rainbow-me/rainbowkit/wallets';
import { useEffect, useState } from 'react';
import { SearchContext } from '@/store/searchContext';
import LandingPage from '@/components/Pages/Landing';
import { robinhood, robinhoodTestnet } from '@/constants/chains';

// import 'react-loader-spinner/dist/loader/css/react-spinner-loader.css';
import 'react-medium-image-zoom/dist/styles.css';
import 'video.js/dist/video-js.css';

// set up connectors

const { chains, provider } = configureChains(
  [robinhoodTestnet, robinhood],
  [jsonRpcProvider({ rpc: (c) => ({ http: c.rpcUrls.default }) })]
);

// RainbowKit 0.7.x — the last line built for this stack (wagmi 0.6 + ethers
// v5); RainbowKit v1/v2 require the wagmi-v2/viem migration. Only two wallets,
// deliberately:
//  - injectedWallet: pure InjectedConnector, auto-detects and shows the
//    installed extension's own name+icon (MetaMask, Brave, Rabby, OKX…).
//  - coinbaseWallet: its own SDK (extension + mobile QR), no WalletConnect.
// Everything else RainbowKit ships in this version (metaMask/brave/rainbow/
// trust…) either duplicates the "injected" connector id — the collision that
// silently disables openConnectModal — or falls back to WalletConnect v1,
// whose bridge servers died in 2023 (dead QR codes). Not worth a broken
// button. (WC v2 for real mobile support is a separate wagmi-v2 upgrade.)
const connectors = connectorsForWallets([
  {
    groupName: 'Connect',
    wallets: [
      injectedWallet({ chains, shimDisconnect: true }),
      coinbaseWallet({ appName: 'SAGE', chains }),
    ],
  },
]);

const wagmiClient = createClient({
  // autoConnect must stay off at creation: reconnecting while React 18 is still
  // hydrating mutates the wagmi store mid-hydration and throws "Hydration failed".
  // We reconnect after mount instead (useEffect below).
  autoConnect: false,
  connectors,
  provider,
});

function App({ Component, pageProps, router }: AppProps) {
  const { theme } = useTheme();
  const [query, setQuery] = useState<string | null>(null);
  const isMaintenanceOn: boolean = process.env.NEXT_PUBLIC_MAINTENANCE_ON === 'true';

  useEffect(() => {
    wagmiClient.autoConnect();
  }, []);

  const themeContent: string = theme === 'dark' ? '#101010' : 'white';
  // RainbowKit modal follows the site theme; accent matches the SAGE green
  const rainbowTheme =
    theme === 'dark'
      ? darkTheme({ accentColor: '#0c9d68', borderRadius: 'medium' })
      : lightTheme({ accentColor: '#0c9d68', borderRadius: 'medium' });
  return (
    <ReduxProvider store={store}>
      <WagmiConfig client={wagmiClient}>
        <RainbowKitProvider chains={chains} theme={rainbowTheme} modalSize='compact'>
        <SessionProvider refetchInterval={0}>
          <SearchContext.Provider value={{ query, setQuery }}>
            <Head>
              <title>SAGE</title>
              <link rel='icon' href='/icons/sage.svg' />
              <meta charSet='utf-8' />
              <meta
                name='viewport'
                content='width=device-width,initial-scale=1,viewport-fit=cover'
              />
              <meta name='theme-color' content={themeContent} />
              <meta
                name='description'
                content='SAGE is a portal into Web3, curating the space of the future.'
              />
            </Head>
            <Script
              strategy='lazyOnload'
              src={`https://www.googletagmanager.com/gtag/js?id=${process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS}`}
            />

            <Script strategy='lazyOnload'>
              {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS}', {
                page_path: window.location.pathname,
                });
              `}
            </Script>
            <Analytics />
            {isMaintenanceOn ? (
              <LandingPage />
            ) : (
              <Layout router={router}>
                <Component {...pageProps} key={router.pathname} />
              </Layout>
            )}
          </SearchContext.Provider>
        </SessionProvider>
        </RainbowKitProvider>
      </WagmiConfig>
    </ReduxProvider>
  );
}

export default App;
