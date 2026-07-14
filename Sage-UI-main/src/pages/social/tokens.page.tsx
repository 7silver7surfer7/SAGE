import { useRouter } from 'next/router';
import LoaderDots from '@/components/LoaderDots';
import SocialShell from '@/components/Social/SocialShell';
import VerifiedBadge from '@/components/Social/VerifiedBadge';
import { PfpImage } from '@/components/Media/BaseMedia';
import shortenAddress from '@/utilities/shortenAddress';
import { transformTitle } from '@/utilities/strings';
import { useGetTokensQuery } from '@/store/socialReducer';

/**
 * The pump.fun-style token board: every creator coin launched on the curve,
 * newest first. Each tile opens the token's full trading page (chart, buy/
 * sell, holders, trades).
 */
export default function TokensPage() {
  const router = useRouter();
  const { data, isFetching } = useGetTokensQuery(undefined, { pollingInterval: 30_000 });

  return (
    <SocialShell>
      <div className='social'>
        <header className='social__header social__header--row'>
          <div>
            <h1 className='social__title'>TOKENS</h1>
            <p className='social__subtitle'>
              creator coins on the pump.fun curve — tap one to trade
            </p>
          </div>
          <button className='social-dm__new' onClick={() => router.push('/social/launch/token')}>
            🚀 Launch yours
          </button>
        </header>
        {isFetching && !data ? (
          <LoaderDots />
        ) : data?.tokens.length ? (
          <div className='social-tokens'>
            {data.tokens.map((t) => (
              <button
                key={t.tokenAddress}
                className='social-tokens__tile'
                onClick={() => router.push(`/social/token/${t.tokenAddress}`)}
              >
                {t.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className='social-tokens__art' src={t.imageUrl} alt={t.name} />
                ) : (
                  <div className='social-tokens__art social-tokens__art--ph'>
                    ${t.symbol.slice(0, 5)}
                  </div>
                )}
                <div className='social-tokens__meta'>
                  <b>
                    {t.name} <span className='social-tokens__sym'>${t.symbol}</span>
                  </b>
                  {t.description && (
                    <span className='social-tokens__desc'>{t.description}</span>
                  )}
                  <span className='social-tokens__creator'>
                    by{' '}
                    {t.creator.username
                      ? transformTitle(t.creator.username)
                      : shortenAddress(t.creator.address)}
                    {t.creator.verified && <VerifiedBadge size={11} />}
                  </span>
                </div>
                <span className='social-tokens__avatar'>
                  <PfpImage src={t.creator.profilePicture} />
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className='social__empty'>
            No coins on the curve yet — launch the first one. 🚀
          </div>
        )}
      </div>
    </SocialShell>
  );
}
