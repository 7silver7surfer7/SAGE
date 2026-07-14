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
import { metaMaskWallet, coinbaseWallet, braveWallet } from '@rainbow-me/rainbowkit/wallets';
import { useEffect, useState } from 'react';
import { trackPageview } from '@/utilities/analyticsBeacon';
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

// RainbowKit 0.7.x — the last line built for this stack (wagmi 0.6 + ethers v5;
// v1/v2 need the wagmi-v2/viem migration). Each wallet has a proper name + icon
// + install detection, and — critically — a DISTINCT connector id
// (walletConnect / coinbaseWallet / injected). Two wallets sharing the
// "injected" id (the classic braveWallet + injectedWallet mistake) silently
// nulls openConnectModal, so braveWallet is the ONLY injected-id entry here.
//  - metaMaskWallet: "MetaMask" (fox). Injected when present; only users
//    WITHOUT it see the (WC-v1) QR fallback + a "Get MetaMask" prompt.
//  - coinbaseWallet: own SDK (extension + mobile QR), no WalletConnect.
//  - braveWallet: shows only in the Brave browser (its built-in wallet).
// No standalone injectedWallet — it renders as a scary generic "Injected
// Wallet". Broad mobile (WC v2) is a separate wagmi-v2 job.
const connectors = connectorsForWallets([
  {
    groupName: 'Connect',
    wallets: [
      metaMaskWallet({ chains, shimDisconnect: true }),
      coinbaseWallet({ appName: 'SAGE', chains }),
      braveWallet({ chains, shimDisconnect: true }),
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

/**
 * Deploy seam self-heal: a tab opened before a deploy holds HTML that
 * references old hashed chunks the new revision no longer serves. When that
 * bites (ChunkLoadError / failed dynamic import), reload once to pick up the
 * new build — guarded per-path in sessionStorage so a genuinely broken chunk
 * can't reload-loop. Registered at MODULE scope (not inside React) so it
 * keeps working even while the component tree is crashing or remounting.
 */
function recoverFromChunkError(err: any) {
  const msg = String((err as any)?.message || (err as any)?.reason?.message || err || '');
  if (
    !/ChunkLoadError|Loading chunk .* failed|Failed to fetch dynamically imported module|Importing a module script failed/i.test(
      msg
    )
  )
    return;
  const key = `chunk-reload:${window.location.pathname}`;
  if (sessionStorage.getItem(key)) return; // already tried once here
  sessionStorage.setItem(key, '1');
  window.location.reload();
}
if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) => recoverFromChunkError(e.error || e.message));
  window.addEventListener('unhandledrejection', (e) => recoverFromChunkError(e.reason));
}

function App({ Component, pageProps, router }: AppProps) {
  const { theme } = useTheme();
  const [query, setQuery] = useState<string | null>(null);
  const isMaintenanceOn: boolean = process.env.NEXT_PUBLIC_MAINTENANCE_ON === 'true';

  useEffect(() => {
    wagmiClient.autoConnect();
  }, []);

  // Deploy seam self-heal: register the routeChangeError leg here (needs the
  // router); the window-level legs live at module scope below so they survive
  // React tree crashes/remounts.
  useEffect(() => {
    const onRouteError = (err: any) => recoverFromChunkError(err);
    router.events.on('routeChangeError', onRouteError);
    return () => router.events.off('routeChangeError', onRouteError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // first-party visitor analytics: one beacon on load + one per route change
  useEffect(() => {
    trackPageview(window.location.pathname);
    const onRoute = (url: string) => trackPageview(url);
    router.events.on('routeChangeComplete', onRoute);
    return () => router.events.off('routeChangeComplete', onRoute);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
