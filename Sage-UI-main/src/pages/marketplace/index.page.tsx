import React, { useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import Logotype from '@/components/Logotype';
import {
  NftCollection,
  useGetMarketplaceCollectionsEnrichedQuery,
} from '@/store/marketplaceReducer';

type View = 'grid' | 'list';

// The preview image now arrives inline on the collection (folded in server-side
// by the enriched list — one request instead of one fetch per card), so this is
// pure presentation: no query, no observer. Renders into the drops-style tile
// media slot (grid) or a compact 48px thumb (list).
function CollectionPreview({
  collection,
  variant,
}: {
  collection: NftCollection;
  variant: View;
}) {
  const [failed, setFailed] = useState(false);
  const img = collection.previewImage;
  const label = (collection.symbol || collection.name || '?').slice(0, 3);
  const fill: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  };

  if (variant === 'list') {
    return (
      <div className='mkt__row-thumb'>
        {img && !failed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt={collection.name || ''} loading='lazy' onError={() => setFailed(true)} />
        ) : (
          <span className='mkt__thumb-fallback'>{label}</span>
        )}
        <style jsx>{`
          .mkt__row-thumb {
            width: 48px;
            height: 48px;
            flex: 0 0 48px;
            border-radius: 8px;
            overflow: hidden;
            background: rgba(127, 127, 127, 0.12);
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .mkt__row-thumb img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
          }
          .mkt__thumb-fallback {
            font-weight: 700;
            opacity: 0.35;
            text-transform: uppercase;
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className='drop-page__grid-item-media-container'>
      {img && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className='drop-page__grid-item-media-src'
          style={fill}
          src={img}
          alt={collection.name || ''}
          loading='lazy'
          onError={() => setFailed(true)}
        />
      ) : (
        <div
          className='drop-page__grid-item-media-src'
          style={{
            ...fill,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            opacity: 0.3,
            textTransform: 'uppercase',
            fontSize: 28,
          }}
        >
          {label}
        </div>
      )}
      <div className='drop-page__grid-item-media-overlay' />
      <div className='drop-page__grid-item-focus'>VIEW COLLECTION</div>
    </div>
  );
}

// Marketplace home: every (non-spam) NFT collection on Robinhood Chain, ordered
// by holders. Uses the /drops/[id] tile template so it matches the drops pages.
function Marketplace() {
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [collections, setCollections] = useState<NftCollection[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [view, setView] = useState<View>('grid');
  // spam is filtered server-side by the enriched list now — no client pass
  const { data, isFetching, isError, refetch } = useGetMarketplaceCollectionsEnrichedQuery(cursor);

  const retriesRef = useRef(0);
  useEffect(() => {
    if (isError && retriesRef.current < 5) {
      const t = setTimeout(() => {
        retriesRef.current += 1;
        refetch();
      }, 1500);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [isError, refetch]);

  useEffect(() => {
    if (!data) return;
    retriesRef.current = 0;
    setCollections((prev) => {
      const seen = new Set(prev.map((c) => c.address.toLowerCase()));
      const merged = [...prev];
      for (const c of data.items) {
        if (!seen.has(c.address.toLowerCase())) merged.push(c);
      }
      return merged;
    });
    setNextCursor(data.nextCursor);
  }, [data]);

  const sorted = useMemo(
    () => [...collections].sort((a, b) => Number(b.holdersCount) - Number(a.holdersCount)),
    [collections]
  );

  const fmt = (n: string | null) => (n ? Number(n).toLocaleString() : '—');

  return (
    <>
      <Head>
        <meta name='robots' content='noindex, nofollow' />
      </Head>
      <div className='drop-page'>
        {/* No dark banner here (marketplace has no per-page hero art), so the
            header uses the normal theme text — black on the light background,
            like the homepage — instead of the drops page's white-over-banner. */}
        <header className='drop-page__header'>
          <div className='drop-page__header-logotype'>
            <Logotype />
          </div>
          <section className='mkt__header-info'>
            <div className='drop-page__header-main-column'>
              <h1 className='drop-page__header-drop-name'>
                <i className='drop-page__header-drop-name-italic'>Marketplace</i>
              </h1>
              <div className='mkt__details'>
                <p className='mkt__detail-item'>
                  <strong>Every NFT on Robinhood Chain</strong>
                </p>
                <p className='mkt__detail-item'>
                  <strong>{fmt(String(sorted.length))} collections</strong>
                </p>
              </div>
            </div>
          </section>
        </header>

        <section className='drop-page__content'>
          <div className='drop-page__drop-info' style={{ width: '100%' }}>
            <div className='mkt__toolbar'>
              <button
                className={`mkt__view-btn ${view === 'grid' ? 'mkt__view-btn--on' : ''}`}
                onClick={() => setView('grid')}
              >
                GRID
              </button>
              <button
                className={`mkt__view-btn ${view === 'list' ? 'mkt__view-btn--on' : ''}`}
                onClick={() => setView('list')}
              >
                LIST
              </button>
            </div>
          </div>

          {isError && collections.length === 0 && (
            <p className='mkt__notice'>The NFT index is temporarily unavailable. Please retry shortly.</p>
          )}

          {view === 'grid' ? (
            <div className='drop-page__grid--base'>
              {sorted.map((c) => (
                <Link key={c.address} href={`/marketplace/${c.address}`}>
                  <a className='drop-page__grid-item--base'>
                    <CollectionPreview collection={c} variant='grid' />
                    <div className='drop-page__grid-item-info'>
                      <div className='drop-page__grid-item-info-left'>
                        <h1 className='drop-page__grid-item-info-drop-name'>
                          {c.type.replace('ERC-', 'ERC')}
                        </h1>
                        <h1 className='drop-page__grid-item-info-game-name'>{c.name || 'Unnamed'}</h1>
                      </div>
                      <div className='drop-page__grid-item-info-right'>
                        <div className='drop-page__grid-item-info-countdown'>
                          {fmt(c.holdersCount)} owners
                        </div>
                      </div>
                    </div>
                  </a>
                </Link>
              ))}
            </div>
          ) : (
            <div className='mkt__list'>
              <div className='mkt__list-head'>
                <span>Collection</span>
                <span className='mkt__col-num'>Owners</span>
                <span className='mkt__col-num mkt__col-hide'>Items</span>
              </div>
              {sorted.map((c) => (
                <Link key={c.address} href={`/marketplace/${c.address}`}>
                  <a className='mkt__row'>
                    <span className='mkt__row-main'>
                      <CollectionPreview collection={c} variant='list' />
                      <span className='mkt__row-name' title={c.name || undefined}>
                        {c.name || 'Unnamed'}
                        <span className='mkt__row-type'>{c.type.replace('ERC-', 'ERC')}</span>
                      </span>
                    </span>
                    <span className='mkt__col-num'>{fmt(c.holdersCount)}</span>
                    <span className='mkt__col-num mkt__col-hide'>{fmt(c.totalSupply)}</span>
                  </a>
                </Link>
              ))}
            </div>
          )}

          <div className='mkt__more'>
            {nextCursor && !isFetching && (
              <button className='mkt__more-btn' onClick={() => setCursor(nextCursor)}>
                LOAD MORE
              </button>
            )}
            {isFetching && <span className='mkt__loading'>loading…</span>}
          </div>
        </section>
      </div>

      <style jsx>{`
        /* .mkt__header-info / .mkt__details / .mkt__detail-item live in
           styles/pages/_marketplace.scss so they can be theme-aware */
        .mkt__toolbar {
          display: flex;
          gap: 8px;
        }
        .mkt__view-btn {
          padding: 8px 20px;
          border-radius: 999px;
          border: 1px solid rgba(127, 127, 127, 0.4);
          background: transparent;
          color: inherit;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.1em;
          cursor: pointer;
        }
        .mkt__view-btn--on {
          background: #6ee7b7;
          border-color: #6ee7b7;
          color: #0e1412;
        }
        .mkt__notice {
          opacity: 0.6;
          padding: 30px;
          text-align: center;
        }
        .mkt__list {
          width: 100%;
          max-width: 1100px;
          margin: 0 auto;
          padding: 0 30px;
        }
        .mkt__list-head,
        .mkt__row {
          display: grid;
          grid-template-columns: 1fr 90px 90px;
          align-items: center;
          gap: 12px;
        }
        .mkt__list-head {
          padding: 8px 14px;
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          opacity: 0.45;
          border-bottom: 1px solid rgba(127, 127, 127, 0.14);
        }
        .mkt__row {
          padding: 10px 14px;
          border-bottom: 1px solid rgba(127, 127, 127, 0.08);
        }
        .mkt__row:hover {
          background: rgba(110, 231, 183, 0.06);
        }
        .mkt__row-main {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
        }
        .mkt__row-name {
          font-weight: 600;
          font-size: 14px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .mkt__row-type {
          font-size: 11px;
          opacity: 0.4;
          font-weight: 400;
          margin-top: 2px;
        }
        .mkt__col-num {
          text-align: right;
          font-size: 13px;
          font-variant-numeric: tabular-nums;
        }
        @media (max-width: 560px) {
          .mkt__list-head,
          .mkt__row {
            grid-template-columns: 1fr 70px;
          }
          .mkt__col-hide {
            display: none;
          }
        }
        .mkt__more {
          display: flex;
          justify-content: center;
          padding: 40px 0;
        }
        .mkt__more-btn {
          padding: 12px 28px;
          border-radius: 999px;
          border: 1px solid rgba(127, 127, 127, 0.4);
          background: transparent;
          color: inherit;
          font-weight: 600;
          letter-spacing: 0.08em;
          cursor: pointer;
        }
        .mkt__loading {
          opacity: 0.5;
          letter-spacing: 0.08em;
        }
      `}</style>
    </>
  );
}

export default Marketplace;
