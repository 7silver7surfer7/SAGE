import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import { useSigner } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import Logotype from '@/components/Logotype';
import LoaderDots from '@/components/LoaderDots';
import SearchIcon from '@/components/Icons/SearchIcon';
import VerifiedBadge from '@/components/Social/VerifiedBadge';
import { LaunchModal } from '@/components/Social/TokenPanel';
import { PfpImage } from '@/components/Media/BaseMedia';
import shortenAddress from '@/utilities/shortenAddress';
import { transformTitle } from '@/utilities/strings';
import { useGetTokensQuery } from '@/store/socialReducer';
import useSAGEAccount from '@/hooks/useSAGEAccount';

/** $190M / $3.5K / $980 — pump.fun-style compact mcap */
function fmtMcap(usd: number): string {
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(1)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(1)}M`;
  if (usd >= 1e3) return `$${(usd / 1e3).toFixed(1)}K`;
  return `$${Math.round(usd)}`;
}

function ageOf(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** debounce a fast-changing value — avoids a server round-trip per keystroke */
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

/**
 * Public, no-invite-needed creator-coin board — the same pump.fun-style curve
 * as the SAGE Social launcher, just reachable by anyone from the main site
 * nav instead of being locked behind the invite-only social app. Launching
 * and trading a coin was never actually invite-gated at the contract or API
 * level (only posting/DMs are); this page is what makes that true in the UI.
 */
export default function TokensPage() {
  const router = useRouter();
  const { isSignedIn, walletAddress, userData } = useSAGEAccount();
  const { data: signer } = useSigner();
  const { openConnectModal } = useConnectModal();
  const addr = walletAddress || (userData as any)?.walletAddress || '';
  const [launchOpen, setLaunchOpen] = useState(false);
  const [cursor, setCursor] = useState<number | undefined>(undefined);
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 300);
  const { data, isFetching } = useGetTokensQuery(
    { cursor, q: q || undefined },
    { pollingInterval: q ? undefined : 30_000 }
  );
  const sentinel = useRef<HTMLDivElement>(null);

  // a fresh search string starts its own paging from the top
  useEffect(() => {
    setCursor(undefined);
  }, [q]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !isFetching && data?.nextCursor != null) {
        setCursor(data.nextCursor);
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [data?.nextCursor, isFetching]);

  const onLaunchClick = () => {
    if (!addr || !isSignedIn) {
      toast.info('Connect your wallet to launch a coin');
      return;
    }
    if (!signer) {
      // session cookie survives reloads but the wallet connection doesn't —
      // reopen the connect modal instead of showing a "connect your wallet"
      // message to someone who (correctly) believes they're already signed in
      toast.info('Reconnect your wallet to sign transactions');
      openConnectModal?.();
      return;
    }
    setLaunchOpen(true);
  };

  return (
    <div className='tokens-page'>
      <section className='tokens-page__header'>
        <Logotype />
        <div className='tokens-page__subheader'>
          <div className='tokens-page__subheader-content'>
            <h1 className='tokens-page__subheader-label'>TOKENS</h1>
            <h2 className='tokens-page__subheader-info'>
              CREATOR COINS ON A BONDING CURVE — LAUNCH FREE, TRADE INSTANTLY.
            </h2>
          </div>
          <button className='tokens-page__launch-btn' onClick={onLaunchClick}>
            🚀 New token
          </button>
        </div>
      </section>
      <section className='tokens-page__board-section'>
        <div className='pump-search'>
          <span className='pump-search__icon'>
            <SearchIcon size={15} />
          </span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder='Search name, symbol, address'
          />
          {search && (
            <button className='pump-search__clear' onClick={() => setSearch('')}>
              ✕
            </button>
          )}
        </div>
        {isFetching && !data ? (
          <LoaderDots />
        ) : data?.tokens.length ? (
          <>
            <div className='pump-board'>
              {data.tokens.map((t) => (
                <button
                  key={t.tokenAddress}
                  className='pump-card'
                  onClick={() => router.push(`/social/token/${t.tokenAddress}`)}
                >
                  {t.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className='pump-card__art' src={t.imageUrl} alt={t.name} />
                  ) : (
                    <div className='pump-card__art pump-card__art--ph'>${t.symbol.slice(0, 5)}</div>
                  )}
                  <b className='pump-card__name'>{t.name}</b>
                  <span className='pump-card__sym'>${t.symbol}</span>
                  <span className='pump-card__mcap'>
                    {fmtMcap(t.mcapUsd)} <small>MC</small>
                  </span>
                  <span className='pump-card__foot'>
                    <span className='pump-card__avatar'>
                      <PfpImage src={t.creator.profilePicture} />
                    </span>
                    {t.creator.username ? transformTitle(t.creator.username) : shortenAddress(t.creator.address)}
                    {t.creator.verified && <VerifiedBadge size={11} />}
                    <span className='pump-card__age'>🌱 {ageOf(t.createdAt)}</span>
                  </span>
                </button>
              ))}
            </div>
            {data.nextCursor != null && (
              <div ref={sentinel} className='social__loadmore'>
                {isFetching ? <LoaderDots /> : ' '}
              </div>
            )}
          </>
        ) : q ? (
          <div className='social__empty'>No coins match "{q}".</div>
        ) : (
          <div className='social__empty'>No coins on the curve yet — launch the first one. 🚀</div>
        )}
      </section>
      {launchOpen && <LaunchModal onClose={() => setLaunchOpen(false)} />}
    </div>
  );
}
