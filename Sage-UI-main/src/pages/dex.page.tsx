import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Logotype from '@/components/Logotype';
import LoaderDots from '@/components/LoaderDots';
import SearchIcon from '@/components/Icons/SearchIcon';
import Sparkline from '@/components/Dex/Sparkline';
import { useGetDexScreenerQuery, useLookupDexQuery, DexRow } from '@/store/dexReducer';

const WATCHLIST_KEY = 'dex-watchlist';

type Tab = 'all' | 'new' | 'graduated' | 'curve' | 'watchlist';
type Sort = 'trending' | 'volume' | 'mcap' | 'liquidity' | 'change24h' | 'age';

/** compact dollars: $1.2M / $45.3K / $980 */
function fmt(usd: number): string {
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(1)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(1)}M`;
  if (usd >= 1e3) return `$${(usd / 1e3).toFixed(1)}K`;
  return `$${Math.round(usd)}`;
}

/** per-token price — tiny numbers, 3 significant figures */
function fmtPrice(usd: number): string {
  if (!usd) return '$0';
  return `$${usd.toPrecision(3)}`;
}

function fmtPct(v: number | null): string {
  if (v == null) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function ageOf(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function PctCell({ value }: { value: number | null }) {
  const dir = value == null ? '' : value >= 0 ? ' up' : ' down';
  return <td className={`dex-page__cell dex-page__cell--num dex-page__cell--pct${dir}`}>{fmtPct(value)}</td>;
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'new', label: 'New' },
  { id: 'graduated', label: 'Graduated' },
  { id: 'curve', label: 'Curve' },
  { id: 'watchlist', label: '⭐ Watchlist' },
];

/**
 * Live DexScreener-style board over every SAGE Social creator coin — curve
 * and graduated pool alike — polling the server-computed screener snapshot.
 */
export default function DexPage() {
  const router = useRouter();
  const { data, isLoading } = useGetDexScreenerQuery(undefined, { pollingInterval: 5000 });
  const [search, setSearch] = useState('');
  // global lookup rides the same search box, debounced — any token on any
  // chain via DexScreener's public API (including Robinhood-chain tokens
  // that never launched here)
  const [globalQ, setGlobalQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setGlobalQ(search.trim()), 450);
    return () => clearTimeout(t);
  }, [search]);
  const { data: globalData, isFetching: globalLoading } = useLookupDexQuery(globalQ, {
    skip: globalQ.length < 2,
  });
  const [tab, setTab] = useState<Tab>('all');
  const [sort, setSort] = useState<Sort>('trending');
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [flashes, setFlashes] = useState<Record<string, 'up' | 'down'>>({});
  const prevPrices = useRef<Record<string, number>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(WATCHLIST_KEY);
      if (raw) setWatchlist(JSON.parse(raw));
    } catch {
      // corrupt/blocked storage — start with an empty watchlist
    }
  }, []);

  const toggleWatch = (address: string) => {
    setWatchlist((w) => {
      const next = w.includes(address) ? w.filter((a) => a !== address) : [...w, address];
      try {
        localStorage.setItem(WATCHLIST_KEY, JSON.stringify(next));
      } catch {
        // storage blocked — keep in-memory state only
      }
      return next;
    });
  };

  // flash rows whose price moved since the previous poll
  useEffect(() => {
    if (!data) return undefined;
    const moved: Record<string, 'up' | 'down'> = {};
    for (const r of data.rows) {
      const prev = prevPrices.current[r.tokenAddress];
      if (prev !== undefined && prev !== r.priceUsd) {
        moved[r.tokenAddress] = r.priceUsd > prev ? 'up' : 'down';
      }
      prevPrices.current[r.tokenAddress] = r.priceUsd;
    }
    if (!Object.keys(moved).length) return undefined;
    setFlashes((f) => ({ ...f, ...moved }));
    const t = setTimeout(() => setFlashes({}), 1000);
    return () => clearTimeout(t);
  }, [data]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const now = Date.now();
    const filtered = (data?.rows ?? []).filter((r) => {
      if (tab === 'new' && now - new Date(r.createdAt).getTime() >= 86400_000) return false;
      if (tab === 'graduated' && !r.graduated) return false;
      if (tab === 'curve' && r.graduated) return false;
      if (tab === 'watchlist' && !watchlist.includes(r.tokenAddress)) return false;
      if (
        q &&
        !r.name.toLowerCase().includes(q) &&
        !r.symbol.toLowerCase().includes(q) &&
        !r.tokenAddress.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
    const by: Record<Sort, (a: DexRow, b: DexRow) => number> = {
      trending: (a, b) => b.trending - a.trending,
      volume: (a, b) => b.volume24hUsd - a.volume24hUsd,
      mcap: (a, b) => b.mcapUsd - a.mcapUsd,
      liquidity: (a, b) => b.liquidityUsd - a.liquidityUsd,
      change24h: (a, b) => (b.change24h ?? -Infinity) - (a.change24h ?? -Infinity),
      age: (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    };
    return [...filtered].sort(by[sort]);
  }, [data, search, tab, sort, watchlist]);

  return (
    <div className='dex-page'>
      <section className='dex-page__header'>
        <Logotype />
        <div className='dex-page__subheader'>
          <div className='dex-page__subheader-content'>
            <h1 className='dex-page__subheader-label'>DEX SCREENER</h1>
            <h2 className='dex-page__subheader-info'>
              EVERY TOKEN ON THE CURVE AND THE POOL — LIVE.
            </h2>
          </div>
        </div>
      </section>
      <section className='dex-page__board'>
        <div className='dex-page__controls'>
          <div className='dex-page__search'>
            <span className='dex-page__search-icon'>
              <SearchIcon size={15} />
            </span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder='Search name, symbol, address'
            />
            {search && (
              <button className='dex-page__search-clear' onClick={() => setSearch('')}>
                ✕
              </button>
            )}
          </div>
          <div className='dex-page__tabs'>
            {TABS.map((t) => (
              <button
                key={t.id}
                className={`dex-page__tab${tab === t.id ? ' dex-page__tab--active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <select
            className='dex-page__sort'
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
          >
            <option value='trending'>Trending</option>
            <option value='volume'>Volume 24h</option>
            <option value='mcap'>MCap</option>
            <option value='liquidity'>Liquidity</option>
            <option value='change24h'>24h %</option>
            <option value='age'>Age</option>
          </select>
        </div>
        {isLoading ? (
          <LoaderDots />
        ) : rows.length ? (
          <div className='dex-page__table-wrap'>
            <table className='dex-page__table'>
              <thead>
                <tr>
                  <th className='dex-page__th dex-page__th--rank'>#</th>
                  <th className='dex-page__th'>TOKEN</th>
                  <th className='dex-page__th dex-page__th--num'>PRICE</th>
                  <th className='dex-page__th dex-page__th--num'>5M</th>
                  <th className='dex-page__th dex-page__th--num'>1H</th>
                  <th className='dex-page__th dex-page__th--num'>24H</th>
                  <th className='dex-page__th dex-page__th--num'>TXNS</th>
                  <th className='dex-page__th dex-page__th--num'>VOLUME</th>
                  <th className='dex-page__th dex-page__th--num'>LIQUIDITY</th>
                  <th className='dex-page__th dex-page__th--num'>MCAP</th>
                  <th className='dex-page__th dex-page__th--spark'>LAST 24H</th>
                  <th className='dex-page__th dex-page__th--star' />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const flash = flashes[r.tokenAddress];
                  const watched = watchlist.includes(r.tokenAddress);
                  return (
                    <tr
                      key={r.tokenAddress}
                      className={`dex-page__row${flash ? ` flash-${flash}` : ''}`}
                      onClick={() =>
                        router.push(
                          r.source === 'chain' && r.pairAddress
                            ? `/dex/pair/${r.pairAddress}`
                            : `/social/token/${r.tokenAddress}`
                        )
                      }
                    >
                      <td className='dex-page__cell dex-page__cell--rank'>{i + 1}</td>
                      <td className='dex-page__cell dex-page__cell--token'>
                        {r.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img className='dex-page__badge' src={r.imageUrl} alt={r.name} width={24} height={24} />
                        ) : (
                          <span className='dex-page__badge dex-page__badge--ph'>
                            {r.symbol.slice(0, 2)}
                          </span>
                        )}
                        <b className='dex-page__symbol'>{r.symbol}</b>
                        <span className='dex-page__name'>{r.name}</span>
                        <span className='dex-page__age'>{ageOf(r.createdAt)}</span>
                        {r.source === 'chain' ? (
                          <span className='dex-page__source'>CHAIN</span>
                        ) : (
                          r.graduated && <span className='dex-page__grad'>🎓</span>
                        )}
                        {(
                          [
                            [r.links.website, '🌐'],
                            [r.links.twitter, '𝕏'],
                            [r.links.telegram, '✈️'],
                            [r.links.discord, '💬'],
                          ] as const
                        ).map(
                          ([href, icon]) =>
                            href && (
                              <a
                                key={icon}
                                className='dex-page__social'
                                href={href}
                                target='_blank'
                                rel='noreferrer noopener'
                                onClick={(e) => e.stopPropagation()}
                              >
                                {icon}
                              </a>
                            )
                        )}
                      </td>
                      <td className='dex-page__cell dex-page__cell--num dex-page__cell--price'>
                        {fmtPrice(r.priceUsd)}
                      </td>
                      <PctCell value={r.change5m} />
                      <PctCell value={r.change1h} />
                      <PctCell value={r.change24h} />
                      <td className='dex-page__cell dex-page__cell--num dex-page__cell--txns'>
                        <span className='up'>{r.txns24h.buys}</span>/<span className='down'>{r.txns24h.sells}</span>
                      </td>
                      <td className='dex-page__cell dex-page__cell--num'>{fmt(r.volume24hUsd)}</td>
                      <td className='dex-page__cell dex-page__cell--num'>{fmt(r.liquidityUsd)}</td>
                      <td className='dex-page__cell dex-page__cell--num'>
                        {/* chain rows: supply unknown, mcapUsd 0 means "unknown", not $0 */}
                        {r.source === 'chain' ? '—' : fmt(r.mcapUsd)}
                      </td>
                      <td className='dex-page__cell dex-page__cell--spark'>
                        <Sparkline points={r.spark} positive={(r.change24h ?? 0) >= 0} />
                      </td>
                      <td className='dex-page__cell dex-page__cell--star'>
                        <button
                          className={`dex-page__star${watched ? ' dex-page__star--active' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleWatch(r.tokenAddress);
                          }}
                          aria-label={watched ? 'Remove from watchlist' : 'Add to watchlist'}
                        >
                          {watched ? '★' : '☆'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className='dex-page__empty'>
            {globalQ.length >= 2 && (globalLoading || (globalData?.rows.length ?? 0) > 0)
              ? 'Nothing local — results from everywhere below.'
              : 'No tokens match.'}
          </div>
        )}

        {/* every token everywhere: any chain, any dex, via DexScreener */}
        {globalQ.length >= 2 && (
          <div className='dex-page__global'>
            <div className='dex-page__global-head'>
              EVERYWHERE — ALL CHAINS <span>via DexScreener</span>
            </div>
            {globalLoading && !globalData ? (
              <LoaderDots />
            ) : (globalData?.rows.length ?? 0) === 0 ? (
              <div className='dex-page__empty'>No matches anywhere for “{globalQ}”.</div>
            ) : (
              <div className='dex-page__table-wrap'>
                <table className='dex-page__table'>
                  <thead>
                    <tr>
                      <th className='dex-page__th'>TOKEN</th>
                      <th className='dex-page__th'>CHAIN / DEX</th>
                      <th className='dex-page__th dex-page__th--num'>PRICE</th>
                      <th className='dex-page__th dex-page__th--num'>5M</th>
                      <th className='dex-page__th dex-page__th--num'>1H</th>
                      <th className='dex-page__th dex-page__th--num'>24H</th>
                      <th className='dex-page__th dex-page__th--num'>TXNS</th>
                      <th className='dex-page__th dex-page__th--num'>VOLUME</th>
                      <th className='dex-page__th dex-page__th--num'>LIQUIDITY</th>
                      <th className='dex-page__th dex-page__th--num'>MCAP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {globalData!.rows.map((r) => (
                      <tr
                        key={`${r.chainId}:${r.pairAddress}`}
                        className='dex-page__row'
                        onClick={() => window.open(r.url, '_blank', 'noopener')}
                      >
                        <td className='dex-page__cell dex-page__cell--token'>
                          {r.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img className='dex-page__badge' src={r.imageUrl} alt={r.name} width={24} height={24} />
                          ) : (
                            <span className='dex-page__badge dex-page__badge--ph'>
                              {r.symbol.slice(0, 2).toUpperCase()}
                            </span>
                          )}
                          <b className='dex-page__symbol'>{r.symbol}</b>
                          <span className='dex-page__name'>{r.name}</span>
                        </td>
                        <td className='dex-page__cell'>
                          <span className='dex-page__chain'>{r.chainId}</span>
                          <span className='dex-page__name'>{r.dexId}</span>
                        </td>
                        <td className='dex-page__cell dex-page__cell--num dex-page__cell--price'>
                          {fmtPrice(r.priceUsd)}
                        </td>
                        <PctCell value={r.change5m} />
                        <PctCell value={r.change1h} />
                        <PctCell value={r.change24h} />
                        <td className='dex-page__cell dex-page__cell--num dex-page__cell--txns'>
                          <span className='up'>{r.txns24h.buys}</span>/<span className='down'>{r.txns24h.sells}</span>
                        </td>
                        <td className='dex-page__cell dex-page__cell--num'>{fmt(r.volume24hUsd)}</td>
                        <td className='dex-page__cell dex-page__cell--num'>{fmt(r.liquidityUsd)}</td>
                        <td className='dex-page__cell dex-page__cell--num'>{fmt(r.mcapUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
