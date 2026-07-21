import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Logotype from '@/components/Logotype';
import LoaderDots from '@/components/LoaderDots';
import ExtCandleChart from '@/components/Dex/ExtCandleChart';
import shortenAddress from '@/utilities/shortenAddress';
import { useGetExtPairQuery, useGetExtCandlesQuery } from '@/store/dexReducer';

/** compact dollars: $1.2M / $45.3K / $980 */
function fmtUsd(usd: number): string {
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(1)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(1)}M`;
  if (usd >= 1e3) return `$${(usd / 1e3).toFixed(1)}K`;
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd > 0) return `$${usd.toPrecision(3)}`;
  return '$0';
}

function fmtPct(v: number | null): string {
  if (v == null) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;

/**
 * Hosted chart page for a FOREIGN-chain pair (anything the global lookup can
 * see that isn't on our chain — Robinhood pairs route to the native
 * /dex/pair page instead). Stats poll DexScreener's pair endpoint through
 * our shared cache; candles come from GeckoTerminal's free OHLCV via our
 * proxy, rendered by our own chart. When a pool has no OHLCV coverage the
 * official DexScreener embed takes the chart slot so the page never shows a
 * dead box — hosting the chart is the default, not a promise.
 */
export default function DexExtPairPage() {
  const router = useRouter();
  const chain = (router.query.chain as string) || '';
  const pair = (router.query.pair as string) || '';
  const [tf, setTf] = useState<(typeof TIMEFRAMES)[number]>('1h');
  const [tabVisible, setTabVisible] = useState(true);
  useEffect(() => {
    const on = () => setTabVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  const { data: pairData, isLoading: pairLoading } = useGetExtPairQuery(
    { chain, pair },
    { skip: !chain || !pair, pollingInterval: tabVisible ? 15_000 : 0 }
  );
  const { data: candleData, isFetching: candlesFetching } = useGetExtCandlesQuery(
    { chain, pair, tf },
    { skip: !chain || !pair, pollingInterval: tabVisible ? 30_000 : 0 }
  );

  const row = pairData?.rows?.[0];
  const candles = candleData?.candles ?? [];
  const embedFallback = Boolean(candleData?.unsupported && !candles.length && row);

  return (
    <div className='dex-pair'>
      <section className='dex-pair__header'>
        <Logotype />
        <div className='dex-pair__subheader'>
          <div className='dex-pair__subheader-content'>
            <h1 className='dex-pair__subheader-label'>
              {row ? `${row.symbol} / ${chain.toUpperCase()}` : 'PAIR'}
            </h1>
            <h2 className='dex-pair__subheader-info'>
              {row ? `${row.name} — ${row.dexId} on ${chain}` : 'FOREIGN-CHAIN PAIR'}
            </h2>
          </div>
        </div>
      </section>
      <section className='dex-pair__body'>
        <button className='dex-pair__back' onClick={() => router.push('/dex')}>
          ← back to screener
        </button>
        {pairLoading && !row ? (
          <LoaderDots />
        ) : !row ? (
          <div className='dex-pair__empty'>
            Pair not found — it may have been delisted upstream.
          </div>
        ) : (
          <>
            <div className='dex-pair__head'>
              <div className='dex-pair__title'>
                {row.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className='dex-ext__badge' src={row.imageUrl} alt={row.symbol} />
                )}
                <b className='dex-pair__symbol'>{row.symbol}</b>
                <span className='dex-pair__name'>{row.name}</span>
                <span className='dex-ext__chain'>{chain.toUpperCase()}</span>
                <span className='dex-ext__chain dex-ext__chain--dex'>{row.dexId}</span>
              </div>
              <div className='dex-pair__addrs'>
                <button
                  className='dex-pair__addr'
                  title='Copy pair address'
                  onClick={() => navigator.clipboard.writeText(row.pairAddress)}
                >
                  pair {shortenAddress(row.pairAddress)} ⧉
                </button>
                <a
                  className='dex-pair__addr dex-ext__out'
                  href={row.url}
                  target='_blank'
                  rel='noreferrer noopener'
                >
                  open on DexScreener ↗
                </a>
              </div>
            </div>

            <div className='dex-pair__stats'>
              <div className='dex-pair__stat'>
                <span className='dex-pair__stat-label'>PRICE</span>
                <span className='dex-pair__stat-value'>{fmtUsd(row.priceUsd)}</span>
                <span className={`dex-pair__stat-sub ${(row.change24h ?? 0) >= 0 ? 'up' : 'down'}`}>
                  {fmtPct(row.change24h)} 24h
                </span>
              </div>
              <div className='dex-pair__stat'>
                <span className='dex-pair__stat-label'>LIQUIDITY</span>
                <span className='dex-pair__stat-value'>{fmtUsd(row.liquidityUsd)}</span>
              </div>
              <div className='dex-pair__stat'>
                <span className='dex-pair__stat-label'>VOLUME 24H</span>
                <span className='dex-pair__stat-value'>{fmtUsd(row.volume24hUsd)}</span>
              </div>
              <div className='dex-pair__stat'>
                <span className='dex-pair__stat-label'>TXNS 24H</span>
                <span className='dex-pair__stat-value'>
                  <span className='up'>{row.txns24h.buys}</span>/
                  <span className='down'>{row.txns24h.sells}</span>
                </span>
              </div>
              <div className='dex-pair__stat'>
                <span className='dex-pair__stat-label'>MCAP</span>
                <span className='dex-pair__stat-value'>
                  {row.mcapUsd ? fmtUsd(row.mcapUsd) : '—'}
                </span>
              </div>
            </div>

            {!embedFallback && (
              <div className='dex-pair__tf'>
                {TIMEFRAMES.map((t) => (
                  <button key={t} data-active={tf === t} onClick={() => setTf(t)}>
                    {t}
                  </button>
                ))}
                {candlesFetching && <span className='dex-ext__refreshing'>…</span>}
              </div>
            )}

            <div className='dex-pair__chart'>
              {embedFallback ? (
                // no OHLCV coverage upstream — the official embed still gives a
                // live chart rather than an empty box
                <iframe
                  className='dex-ext__embed'
                  src={`https://dexscreener.com/${chain}/${row.pairAddress}?embed=1&theme=dark&info=0&trades=0`}
                  title={`${row.symbol} chart`}
                />
              ) : candles.length ? (
                <ExtCandleChart candles={candles} />
              ) : (
                <LoaderDots />
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
