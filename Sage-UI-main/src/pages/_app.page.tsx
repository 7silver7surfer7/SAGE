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
import { createClient, WagmiConfig, configureChains, Chain } from 'wagmi';
import { InjectedConnector } from 'wagmi/connectors/injected';
import { CoinbaseWalletConnector } from 'wagmi/connectors/coinbaseWallet';
import { jsonRpcProvider } from 'wagmi/providers/jsonRpc';
import { useEffect, useState } from 'react';
import { SearchContext } from '@/store/searchContext';
import LandingPage from '@/components/Pages/Landing';
import { robinhood, robinhoodTestnet } from '@/constants/chains';
import { parameters } from '@/constants/config';

// import 'react-loader-spinner/dist/loader/css/react-spinner-loader.css';
import 'react-medium-image-zoom/dist/styles.css';
import 'video.js/dist/video-js.css';

// set up connectors

const { chains, provider } = configureChains(
  [robinhoodTestnet, robinhood],
  [jsonRpcProvider({ rpc: (c) => ({ http: c.rpcUrls.default }) })]
);

/**
 * Injected connector pinned to ONE specific provider. With several wallet
 * extensions installed they all fight over window.ethereum (the winner is
 * whichever injected last), but each also registers itself in
 * window.ethereum.providers — pinning gives the user one button per wallet
 * instead of a lottery. wagmi 0.6's InjectedConnector has no getProvider
 * option, hence the subclass: every internal access goes through the
 * overridable getProvider().
 */
class TargetedInjectedConnector extends InjectedConnector {
  private targetProvider: any;
  constructor(chains: Chain[], targetProvider: any, name: string) {
    super({ chains, options: { name, shimDisconnect: true } });
    this.targetProvider = targetProvider;
  }
  async getProvider() {
    return this.targetProvider;
  }
}

function walletFlagName(p: any): string {
  if (p?.isRabby) return 'Rabby';
  if (p?.isBraveWallet) return 'Brave Wallet';
  if (p?.isCoinbaseWallet) return 'Coinbase Wallet';
  if (p?.isOkxWallet) return 'OKX Wallet';
  if (p?.isZerion) return 'Zerion';
  if (p?.isTrust) return 'Trust Wallet';
  if (p?.isPhantom) return 'Phantom';
  if (p?.isMetaMask) return 'MetaMask'; // last — many wallets fake this flag
  return 'Browser Wallet';
}

// WalletConnect v1 was removed: its bridge servers were shut down in 2023, so the
// connector could never establish a connection — it only added ~100 kB to every page.
// (WalletConnect v2 needs a wagmi upgrade + a cloud projectId — not wired yet.)
function buildConnectors() {
  const injected: InjectedConnector[] = [];
  const multi =
    typeof window !== 'undefined' ? (window as any).ethereum?.providers : undefined;
  if (Array.isArray(multi) && multi.length > 1) {
    const seen = new Set<string>();
    for (const p of multi) {
      const name = walletFlagName(p);
      if (seen.has(name)) continue; // some wallets register twice
      seen.add(name);
      injected.push(new TargetedInjectedConnector(chains, p, name));
    }
  } else {
    injected.push(new InjectedConnector({ chains }));
  }
  return [
    ...injected,
    // works with the Coinbase extension AND as a QR/deep link into the
    // Coinbase mobile app — the first non-extension path since WC v1 died
    new CoinbaseWalletConnector({
      chains,
      options: {
        appName: 'SAGE',
        jsonRpcUrl: parameters.RPC_URL,
        chainId: Number(parameters.CHAIN_ID),
      },
    }),
  ];
}

const connectors = buildConnectors();

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
