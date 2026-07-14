import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import LoaderDots from '@/components/LoaderDots';
import SocialShell from '@/components/Social/SocialShell';
import VerifiedBadge from '@/components/Social/VerifiedBadge';
import { PfpImage } from '@/components/Media/BaseMedia';
import shortenAddress from '@/utilities/shortenAddress';
import { transformTitle } from '@/utilities/strings';
import { useGetTokensQuery } from '@/store/socialReducer';

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

/**
 * The pump.fun-style token board: big square art cards, sorted by MARKET CAP
 * so the heavy hitters lead — infinite scroll digs down to the cheap end.
 */
export default function TokensPage() {
  const router = useRouter();
  const [cursor, setCursor] = useState<number | undefined>(undefined);
  const { data, isFetching } = useGetTokensQuery({ cursor }, { pollingInterval: 30_000 });
  const sentinel = useRef<HTMLDivElement>(null);

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

  return (
    <SocialShell>
      <div className='social'>
        <header className='social__header social__header--row'>
          <div>
            <h1 className='social__title'>TOKENS</h1>
            <p className='social__subtitle'>
              creator coins on the pump.fun curve — sorted by market cap
            </p>
          </div>
          <button className='social-dm__new' onClick={() => router.push('/social/launch/token')}>
            🚀 Launch yours
          </button>
        </header>
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
                    <div className='pump-card__art pump-card__art--ph'>
                      ${t.symbol.slice(0, 5)}
                    </div>
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
                    {t.creator.username
                      ? transformTitle(t.creator.username)
                      : shortenAddress(t.creator.address)}
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
        ) : (
          <div className='social__empty'>
            No coins on the curve yet — launch the first one. 🚀
          </div>
        )}
      </div>
    </SocialShell>
  );
}
