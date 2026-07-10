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
import { InjectedConnector } from 'wagmi/connectors/injected';
import { jsonRpcProvider } from 'wagmi/providers/jsonRpc';
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

// WalletConnect v1 was removed: its bridge servers were shut down in 2023, so the
// connector could never establish a connection — it only added ~100 kB to every page.
const connectors = [
  new InjectedConnector({
    chains,
  }),
];

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
  return (
    <ReduxProvider store={store}>
      <WagmiConfig client={wagmiClient}>
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
      </WagmiConfig>
    </ReduxProvider>
  );
}

export default App;
