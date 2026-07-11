import React, { useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Logotype from '@/components/Logotype';
import shortenAddress from '@/utilities/shortenAddress';
import {
  NftItem,
  useGetMarketplaceCollectionQuery,
  useGetMarketplaceCollectionItemsQuery,
  useGetCollectionPreviewQuery,
} from '@/store/marketplaceReducer';

// Reuses the drops-page tile shell (drop-page__grid-item-*) so the marketplace
// matches /drops/[id] exactly. NFT media is on arbitrary external hosts, so a
// plain <img>/<video> (not BaseMedia's Arweave proxy) fills the media slot.
function TileMedia({ item, focusText }: { item: NftItem; focusText: string }) {
  const [failed, setFailed] = useState(false);
  const isVideo = item.mediaType === 'video' || !!item.animationUrl;
  const src = isVideo ? item.animationUrl || item.imageUrl : item.imageUrl;
  const fill: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  };
  return (
    <div className='drop-page__grid-item-media-container'>
      {!src || failed ? (
        <div
          className='drop-page__grid-item-media-src'
          style={{ ...fill, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.3 }}
        >
          no image
        </div>
      ) : isVideo && item.animationUrl ? (
        <video
          className='drop-page__grid-item-media-src'
          style={fill}
          src={item.animationUrl}
          poster={item.imageUrl || undefined}
          muted
          loop
          playsInline
          autoPlay
          onError={() => setFailed(true)}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className='drop-page__grid-item-media-src'
          style={fill}
          src={src}
          alt={item.name || item.tokenId}
          loading='lazy'
          onError={() => setFailed(true)}
        />
      )}
      <div className='drop-page__grid-item-media-overlay' />
      <div className='drop-page__grid-item-focus'>{focusText}</div>
    </div>
  );
}

function CollectionPage() {
  const router = useRouter();
  // Direct loads don't populate router.query on these auto-static-optimized
  // dynamic pages; parse from the (always-correct) pathname, falling back to
  // router.query for client-side navigation.
  const [addrFromPath, setAddrFromPath] = useState('');
  useEffect(() => {
    const parts = window.location.pathname.split('/').filter(Boolean);
    if (parts[0] === 'marketplace' && parts[1]) setAddrFromPath(parts[1]);
  }, [router.asPath]);
  const address = String(router.query.collection || addrFromPath || '');
  const valid = /^0x[a-fA-F0-9]{40}$/.test(address);

  const { data: collection } = useGetMarketplaceCollectionQuery(address, { skip: !valid });
  const { data: preview } = useGetCollectionPreviewQuery(address, { skip: !valid });
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [items, setItems] = useState<NftItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const { data, isFetching, isError, refetch } = useGetMarketplaceCollectionItemsQuery(
    { address, cursor },
    { skip: !valid }
  );

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

  React.useEffect(() => {
    if (!data) return;
    retriesRef.current = 0;
    setItems((prev) => {
      const seen = new Set(prev.map((i) => `${i.contractAddress}:${i.tokenId}`));
      const merged = [...prev];
      for (const i of data.items) {
        if (!seen.has(`${i.contractAddress}:${i.tokenId}`)) merged.push(i);
      }
      return merged;
    });
    setNextCursor(data.nextCursor);
  }, [data]);

  const fmt = (n: string | null | undefined) => (n ? Number(n).toLocaleString() : '—');
  const name = collection?.name || 'Collection';

  if (!valid) {
    return (
      <div className='drop-page'>
        <p className='mkt__notice'>Invalid collection address.</p>
      </div>
    );
  }

  return (
    <>
      <Head>
        <meta name='robots' content='noindex, nofollow' />
      </Head>
      {/* darkened full-bleed banner behind the header, like /drops/[id]. Dark
          fallback bg so the white header text stays readable even if the
          collection's preview art hasn't loaded (or the index is flaky). */}
      <div className='drop-page__banner-base' style={{ backgroundColor: '#0e1412' }}>
        {preview?.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview.imageUrl}
            alt=''
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        )}
      </div>
      <div className='drop-page'>
        <header className='drop-page__header'>
          <div className='drop-page__header-logotype'>
            <Link href='/marketplace'>
              <a>
                <Logotype dataColor='white' />
              </a>
            </Link>
          </div>
          <section className='drop-page__header-drop-info'>
            <div className='drop-page__header-main-column'>
              <h1 className='drop-page__header-drop-name'>
                <i className='drop-page__header-drop-name-italic'>{name}</i>
              </h1>
              <div className='drop-page__header-drop-details'>
                <p className='drop-page__header-drop-details-item'>
                  <strong>Items:</strong> {fmt(collection?.totalSupply)}
                </p>
                <p className='drop-page__header-drop-details-item'>
                  <strong>Owners:</strong> {fmt(collection?.holdersCount)}
                </p>
                <p className='drop-page__header-drop-details-item'>
                  <strong>Contract:</strong> {shortenAddress(address)}
                </p>
              </div>
            </div>
          </section>
        </header>

        <section className='drop-page__content'>
          <div className='drop-page__drop-info'>
            <h3 className='drop-page__drop-info-name'>{name}</h3>
            <p className='drop-page__drop-info-description'>
              {collection?.type || 'NFT'} collection on Robinhood Chain. Click any piece to view it.
            </p>
          </div>

          {isError && items.length === 0 && (
            <p className='mkt__notice'>The NFT index is temporarily unavailable. Please retry shortly.</p>
          )}

          <div className='drop-page__grid--base'>
            {items.map((item) => (
              <Link
                key={`${item.contractAddress}:${item.tokenId}`}
                href={`/marketplace/${address}/${item.tokenId}`}
              >
                <a className='drop-page__grid-item--base'>
                  <TileMedia item={item} focusText='VIEW' />
                  <div className='drop-page__grid-item-info'>
                    <div className='drop-page__grid-item-info-left'>
                      <h1 className='drop-page__grid-item-info-drop-name'>{name}</h1>
                      <h1 className='drop-page__grid-item-info-game-name'>
                        {item.name || `#${item.tokenId}`}
                      </h1>
                    </div>
                    <div className='drop-page__grid-item-info-right'>
                      <div className='drop-page__grid-item-info-countdown'>
                        {item.listing ? `${item.listing.priceEth} ETH` : 'Not listed'}
                      </div>
                    </div>
                  </div>
                </a>
              </Link>
            ))}
          </div>

          <div className='mkt__more'>
            {nextCursor && !isFetching && (
              <button className='mkt__more-btn' onClick={() => setCursor(nextCursor)}>
                LOAD MORE
              </button>
            )}
            {isFetching && <span className='mkt__loading'>loading…</span>}
            {!isFetching && items.length === 0 && !isError && (
              <span className='mkt__loading'>no items found</span>
            )}
          </div>
        </section>
      </div>

      <style jsx>{`
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
        .mkt__notice {
          opacity: 0.6;
          padding: 30px;
          text-align: center;
        }
      `}</style>
    </>
  );
}

export default CollectionPage;
