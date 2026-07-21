import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import Logotype from '@/components/Logotype';
import LoaderDots from '@/components/LoaderDots';
import CandleChart from '@/components/Social/CandleChart';
import shortenAddress from '@/utilities/shortenAddress';
import { useGetDexPairDetailQuery } from '@/store/dexReducer';

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function ageOf(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** compact amounts: 1.2M / 45.3K / 0.0123 — for ETH and token quantities */
function fmtAmt(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  if (n >= 1) return n.toFixed(2);
  if (n > 0) return n.toPrecision(3);
  return '0';
}

/** compact dollars: $1.2M / $45.3K / $980 */
function fmtUsd(usd: number): string {
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(1)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(1)}M`;
  if (usd >= 1e3) return `$${(usd / 1e3).toFixed(1)}K`;
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd > 0) return `$${usd.toPrecision(3)}`;
  return '$0';
}

/**
 * Detail page for a CHAIN-indexed Uniswap pair (tokens that trade on this
 * chain but were never launched on SAGE Social). Mirrors /social/token/[address]
 * conventions — visibility-gated 10s poll, CandleChart, trades tape — inside
 * the plain main-site chrome that /dex uses (no SocialShell).
 */
export default function DexPairPage() {
  const router = useRouter();
  const address = (router.query.address as string) || '';
  // pause the poll while the tab is hidden — parked tabs are pure server cost
  // (RTK 1.6 predates skipPollingIfUnfocused, so hand-roll like the token page)
  const [tabVisible, setTabVisible] = useState(true);
  useEffect(() => {
    const on = () => setTabVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  const { data, isFetching, error } = useGetDexPairDetailQuery(address, {
    skip: !address,
    pollingInterval: tabVisible ? 10_000 : 0,
  });
  const [bucketS, setBucketS] = useState(60); // 1m default, matching the token page

  // seed the chart from the indexed swaps, oldest -> newest
  const series = useMemo(
    () =>
      [...(data?.swaps ?? [])]
        .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))
        .map((s) => ({ t: s.createdAt, price: s.priceEth })),
    [data?.swaps]
  );
  const tradePoints = useMemo(
    () =>
      (data?.swaps ?? []).map((s) => ({
        side: s.side,
        ethAmount: s.ethAmount,
        createdAt: s.createdAt,
      })),
    [data?.swaps]
  );
  const txns24h = useMemo(() => {
    const cutoff = Date.now() - 86400_000;
    let buys = 0;
    let sells = 0;
    for (const s of data?.swaps ?? []) {
      if (new Date(s.createdAt).getTime() < cutoff) continue;
      if (s.side === 'buy') buys += 1;
      else sells += 1;
    }
    return { buys, sells };
  }, [data?.swaps]);

  const copy = (value: string, label: string) => {
    navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  };

  const pair = data?.pair;
  const ethUsd = data?.ethUsd || 0;

  return (
    <div className='dex-pair'>
      <section className='dex-pair__header'>
        <Logotype />
        <div className='dex-pair__subheader'>
          <div className='dex-pair__subheader-content'>
            <h1 className='dex-pair__subheader-label'>PAIR</h1>
            <h2 className='dex-pair__subheader-info'>
              INDEXED STRAIGHT FROM THE CHAIN — LIVE.
            </h2>
          </div>
        </div>
      </section>
      <section className='dex-pair__body'>
        <button className='dex-pair__back' onClick={() => router.back()}>
          ← back
        </button>

        {isFetching && !data && !error ? (
          <LoaderDots />
        ) : !pair ? (
          <div className='dex-pair__empty'>
            Pair not found — our index covers WETH-quoted pairs; this one may use a
            different quote token.{' '}
            <a
              className='dex-ext__out'
              href={`https://dexscreener.com/robinhood/${address}`}
              target='_blank'
              rel='noreferrer noopener'
            >
              Try DexScreener ↗
            </a>
          </div>
        ) : (
          <>
            <div className='dex-pair__head'>
              <h1 className='dex-pair__title'>
                <b className='dex-pair__symbol'>{pair.baseSymbol}</b>
                <span className='dex-pair__name'>{pair.baseName}</span>
                <span className='dex-pair__quote'>/ WETH</span>
              </h1>
              <div className='dex-pair__addrs'>
                <button
                  className='dex-pair__addr'
                  title='Copy token address'
                  onClick={() => copy(pair.baseToken, 'Token address')}
                >
                  token {pair.baseToken.slice(0, 6)}…{pair.baseToken.slice(-4)} ⧉
                </button>
                <button
                  className='dex-pair__addr'
                  title='Copy pair address'
                  onClick={() => copy(pair.pairAddress, 'Pair address')}
                >
                  pair {pair.pairAddress.slice(0, 6)}…{pair.pairAddress.slice(-4)} ⧉
                </button>
              </div>
            </div>

            <div className='dex-pair__stats'>
              <div className='dex-pair__stat'>
                <span className='dex-pair__stat-label'>Price</span>
                <b className='dex-pair__stat-value'>
                  {pair.priceEth ? pair.priceEth.toPrecision(3) : '0'} <em>ETH/1M</em>
                </b>
                <small className='dex-pair__stat-sub'>
                  {ethUsd ? `${fmtUsd((pair.priceEth / 1e6) * ethUsd)} / token` : '—'}
                </small>
              </div>
              <div className='dex-pair__stat'>
                <span className='dex-pair__stat-label'>Liquidity</span>
                <b className='dex-pair__stat-value'>
                  {fmtAmt(pair.liquidityEth)} <em>ETH</em>
                </b>
                <small className='dex-pair__stat-sub'>
                  {ethUsd ? fmtUsd(pair.liquidityEth * ethUsd) : '—'}
                </small>
              </div>
              <div className='dex-pair__stat'>
                <span className='dex-pair__stat-label'>Age</span>
                <b className='dex-pair__stat-value'>{ageOf(pair.createdAt)}</b>
                <small className='dex-pair__stat-sub'>
                  {new Date(pair.createdAt).toLocaleDateString()}
                </small>
              </div>
              <div className='dex-pair__stat'>
                <span className='dex-pair__stat-label'>24h txns</span>
                <b className='dex-pair__stat-value'>
                  <span className='up'>{txns24h.buys}</span>/<span className='down'>{txns24h.sells}</span>
                </b>
                <small className='dex-pair__stat-sub'>buys / sells</small>
              </div>
            </div>

            {/* timeframe switcher, same granularities as the token page */}
            <div className='dex-pair__tf'>
              {[
                [60, '1m'],
                [300, '5m'],
                [900, '15m'],
                [3600, '1h'],
              ].map(([sec, label]) => (
                <button
                  key={sec}
                  data-active={bucketS === sec}
                  onClick={() => setBucketS(sec as number)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className='dex-pair__chart'>
              <CandleChart
                series={series}
                trades={tradePoints}
                tokenAddress={pair.baseToken}
                bucketS={bucketS}
                // chart in USD market cap terms like the token page; raw ETH
                // if the price feed is down
                scaleFactor={ethUsd ? 1000 * ethUsd : 1}
                pairAddress={pair.pairAddress}
              />
            </div>

            <div className='dex-pair__trades'>
              <h4 className='dex-pair__trades-title'>Trades</h4>
              {data!.swaps.length ? (
                <div className='dex-pair__table-wrap'>
                  <table className='dex-pair__table'>
                    <thead>
                      <tr>
                        <th className='dex-pair__th'>SIDE</th>
                        <th className='dex-pair__th'>TRADER</th>
                        <th className='dex-pair__th dex-pair__th--num'>ETH</th>
                        <th className='dex-pair__th dex-pair__th--num'>TOKENS</th>
                        <th className='dex-pair__th dex-pair__th--num'>PRICE ETH/1M</th>
                        <th className='dex-pair__th dex-pair__th--num'>AGE</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data!.swaps.map((s, i) => (
                        <tr key={i} className='dex-pair__row'>
                          <td
                            className={`dex-pair__cell dex-pair__side ${
                              s.side === 'buy' ? 'up' : 'down'
                            }`}
                          >
                            {s.side}
                          </td>
                          <td className='dex-pair__cell dex-pair__trader'>
                            {shortenAddress(s.trader)}
                          </td>
                          <td className='dex-pair__cell dex-pair__cell--num'>
                            {fmtAmt(s.ethAmount)}
                          </td>
                          <td className='dex-pair__cell dex-pair__cell--num'>
                            {fmtAmt(s.tokenAmount)}
                          </td>
                          <td className='dex-pair__cell dex-pair__cell--num'>
                            {s.priceEth ? s.priceEth.toPrecision(3) : '0'}
                          </td>
                          <td className='dex-pair__cell dex-pair__cell--num dex-pair__ago'>
                            {timeAgo(s.createdAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className='dex-pair__empty'>No swaps indexed yet.</div>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
