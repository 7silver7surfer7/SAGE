import React, { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Logotype from '@/components/Logotype';
import shortenAddress from '@/utilities/shortenAddress';
import {
  NftItemDetail,
  useGetMarketplaceItemQuery,
  useGetItemActivityQuery,
} from '@/store/marketplaceReducer';

const EXPLORER = 'https://robinhoodchain.blockscout.com';

// Big item media. NFT media lives on arbitrary external hosts (not our Arweave
// gateway), so render directly rather than via BaseMedia. Letterboxed (contain)
// so the whole piece shows, matching how drops present artwork.
function ItemMedia({ item }: { item: NftItemDetail }) {
  const [failed, setFailed] = useState(false);
  const isVideo = item.mediaType === 'video' || !!item.animationUrl;
  const src = isVideo ? item.animationUrl || item.imageUrl : item.imageUrl;
  if (!src || failed) return <div className='it__media it__media--empty'>no media</div>;
  if (isVideo && item.animationUrl) {
    return (
      <video
        className='it__media'
        src={item.animationUrl}
        poster={item.imageUrl || undefined}
        muted
        loop
        playsInline
        autoPlay
        controls
        onError={() => setFailed(true)}
      />
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      className='it__media'
      src={src}
      alt={item.name || item.tokenId}
      onError={() => setFailed(true)}
    />
  );
}

function ItemPage() {
  const router = useRouter();
  // On a direct load, these auto-static-optimized dynamic pages don't get
  // router.query populated (isReady stays false, asPath is the literal
  // template). window.location.pathname is always correct, so parse from it
  // and fall back to router.query when client-side navigation provides it.
  const [fromPath, setFromPath] = useState({ address: '', tokenId: '' });
  React.useEffect(() => {
    const parts = window.location.pathname.split('/').filter(Boolean);
    if (parts[0] === 'marketplace') {
      setFromPath({ address: parts[1] || '', tokenId: parts[2] || '' });
    }
  }, [router.asPath]);
  const address = String(router.query.collection || fromPath.address || '');
  const tokenId = String(router.query.tokenId || fromPath.tokenId || '');
  const ready = /^0x[a-fA-F0-9]{40}$/.test(address) && /^[0-9]+$/.test(tokenId);

  const { data: item, isFetching, isError } = useGetMarketplaceItemQuery(
    { address, tokenId },
    { skip: !ready }
  );
  const { data: activity } = useGetItemActivityQuery({ address, tokenId }, { skip: !ready });

  const fmtTime = (ts: string | null) =>
    ts ? new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

  return (
    <div className='it'>
      <Head>
        <meta name='robots' content='noindex, nofollow' />
      </Head>
      <header className='it__topbar'>
        <Link href='/marketplace'>
          <a className='it__logo'>
            <Logotype />
          </a>
        </Link>
        <Link href={`/marketplace/${address}`}>
          <a className='it__back'>← back to collection</a>
        </Link>
      </header>

      {isError && !item && (
        <p className='it__notice'>Couldn&apos;t load this item. It may not exist, or the index is busy.</p>
      )}
      {isFetching && !item && <p className='it__notice'>loading…</p>}

      {item && (
        <>
          <div className='it__grid'>
            <div className='it__media-col'>
              <div className='it__media-frame'>
                <ItemMedia item={item} />
              </div>
            </div>

            <div className='it__info'>
              <Link href={`/marketplace/${address}`}>
                <a className='it__collection'>{item.collectionName || 'Collection'}</a>
              </Link>
              <h1 className='it__name'>{item.name || `#${item.tokenId}`}</h1>
              <p className='it__owner'>
                Owned by{' '}
                <span className='it__owner-addr'>
                  {item.owner ? shortenAddress(item.owner) : 'unknown'}
                </span>
              </p>

              {/* OpenSea-style price panel: show the ask when listed, else a
                  clear not-listed state. Trading lands in Phase 2 (native-ETH
                  Marketplace contract on mainnet). */}
              <div className='it__buybox'>
                {item.listing ? (
                  <>
                    <span className='it__price-label'>Current price</span>
                    <span className='it__price'>{item.listing.priceEth} ETH</span>
                    <button className='it__btn it__btn--primary' disabled>
                      Buy now
                    </button>
                  </>
                ) : (
                  <>
                    <span className='it__price-label'>Not listed for sale</span>
                    <button className='it__btn' disabled>
                      Make offer (coming soon)
                    </button>
                  </>
                )}
              </div>

              {item.description && (
                <div className='it__section'>
                  <h3 className='it__section-title'>Description</h3>
                  <p className='it__desc'>{item.description}</p>
                </div>
              )}

              {item.traits.length > 0 && (
                <div className='it__section'>
                  <h3 className='it__section-title'>Traits</h3>
                  <div className='it__traits'>
                    {item.traits.map((t, i) => (
                      <div className='it__trait' key={`${t.traitType}-${i}`}>
                        <span className='it__trait-type'>{t.traitType}</span>
                        <span className='it__trait-value' title={t.value}>
                          {t.value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className='it__section'>
                <h3 className='it__section-title'>Details</h3>
                <dl className='it__details'>
                  <div>
                    <dt>Contract</dt>
                    <dd>
                      <a
                        href={`${EXPLORER}/token/${address}`}
                        target='_blank'
                        rel='noreferrer'
                        className='it__link'
                      >
                        {shortenAddress(address)}
                      </a>
                    </dd>
                  </div>
                  <div>
                    <dt>Token ID</dt>
                    <dd title={item.tokenId}>{item.tokenId}</dd>
                  </div>
                  <div>
                    <dt>Standard</dt>
                    <dd>{item.tokenStandard}</dd>
                  </div>
                  <div>
                    <dt>Chain</dt>
                    <dd>Robinhood</dd>
                  </div>
                </dl>
              </div>
            </div>
          </div>

          <div className='it__activity'>
            <h3 className='it__section-title'>Item activity</h3>
            <div className='it__act-head'>
              <span>Event</span>
              <span>From</span>
              <span>To</span>
              <span className='it__act-time'>Date</span>
            </div>
            {(activity?.items || []).length === 0 && (
              <p className='it__notice it__notice--sub'>No recorded activity.</p>
            )}
            {(activity?.items || []).map((a) => (
              <a
                className='it__act-row'
                key={a.txHash}
                href={`${EXPLORER}/tx/${a.txHash}`}
                target='_blank'
                rel='noreferrer'
              >
                <span className='it__act-type'>{a.type}</span>
                <span>{a.from ? shortenAddress(a.from) : '—'}</span>
                <span>{a.to ? shortenAddress(a.to) : '—'}</span>
                <span className='it__act-time'>{fmtTime(a.timestamp)}</span>
              </a>
            ))}
          </div>
        </>
      )}

      <style jsx>{`
        .it {
          padding: 0 clamp(16px, 5vw, 64px) 80px;
        }
        .it__topbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 32px 0 24px;
          gap: 16px;
        }
        .it__back {
          font-size: 13px;
          letter-spacing: 0.04em;
          opacity: 0.6;
        }
        .it__back:hover {
          opacity: 1;
        }
        .it__notice {
          opacity: 0.6;
          padding: 40px 0;
        }
        .it__notice--sub {
          padding: 20px 0;
          font-size: 13px;
        }
        .it__grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: clamp(20px, 4vw, 56px);
          align-items: start;
        }
        @media (max-width: 820px) {
          .it__grid {
            grid-template-columns: 1fr;
          }
        }
        .it__media-frame {
          border-radius: 16px;
          overflow: hidden;
          background: rgba(127, 127, 127, 0.1);
          border: 1px solid rgba(127, 127, 127, 0.14);
          aspect-ratio: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          position: sticky;
          top: 24px;
        }
        .it__media {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }
        .it__media--empty {
          opacity: 0.35;
          font-size: 13px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .it__collection {
          color: #6ee7b7;
          font-weight: 600;
          font-size: 14px;
        }
        .it__name {
          font-size: clamp(26px, 3.4vw, 40px);
          font-weight: 700;
          letter-spacing: -0.01em;
          margin: 8px 0 10px;
          word-break: break-word;
        }
        .it__owner {
          font-size: 13px;
          opacity: 0.6;
        }
        .it__owner-addr {
          opacity: 1;
          font-weight: 600;
        }
        .it__buybox {
          margin: 22px 0;
          padding: 20px;
          border-radius: 14px;
          border: 1px solid rgba(127, 127, 127, 0.18);
          background: rgba(127, 127, 127, 0.05);
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .it__price-label {
          font-size: 12px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          opacity: 0.5;
        }
        .it__price {
          font-size: 28px;
          font-weight: 700;
        }
        .it__btn {
          margin-top: 12px;
          padding: 13px 20px;
          border-radius: 10px;
          border: 1px solid rgba(127, 127, 127, 0.35);
          background: transparent;
          color: inherit;
          font-weight: 600;
          letter-spacing: 0.04em;
          cursor: not-allowed;
          opacity: 0.7;
        }
        .it__btn--primary {
          background: #6ee7b7;
          border-color: #6ee7b7;
          color: #0e1412;
        }
        .it__section {
          margin-top: 26px;
        }
        .it__section-title {
          font-size: 13px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          opacity: 0.5;
          margin-bottom: 12px;
        }
        .it__desc {
          font-size: 14px;
          line-height: 1.55;
          opacity: 0.8;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .it__traits {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
          gap: 10px;
        }
        .it__trait {
          border: 1px solid rgba(110, 231, 183, 0.3);
          border-radius: 10px;
          padding: 10px 12px;
          background: rgba(110, 231, 183, 0.06);
          display: flex;
          flex-direction: column;
          gap: 3px;
          min-width: 0;
        }
        .it__trait-type {
          font-size: 10.5px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #6ee7b7;
        }
        .it__trait-value {
          font-size: 13.5px;
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .it__details {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin: 0;
        }
        .it__details > div {
          display: flex;
          justify-content: space-between;
          font-size: 13.5px;
          border-bottom: 1px solid rgba(127, 127, 127, 0.1);
          padding-bottom: 8px;
        }
        .it__details dt {
          opacity: 0.5;
        }
        .it__details dd {
          margin: 0;
          font-weight: 500;
          max-width: 60%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .it__link {
          color: #6ee7b7;
        }
        .it__activity {
          margin-top: 48px;
        }
        .it__act-head,
        .it__act-row {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr 1.2fr;
          gap: 12px;
          align-items: center;
          font-size: 13px;
        }
        .it__act-head {
          padding: 10px 12px;
          font-size: 11px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          opacity: 0.45;
          border-bottom: 1px solid rgba(127, 127, 127, 0.14);
        }
        .it__act-row {
          padding: 12px;
          border-bottom: 1px solid rgba(127, 127, 127, 0.08);
        }
        .it__act-row:hover {
          background: rgba(110, 231, 183, 0.06);
        }
        .it__act-type {
          text-transform: capitalize;
          font-weight: 600;
        }
        @media (max-width: 640px) {
          .it__act-head,
          .it__act-row {
            grid-template-columns: 1fr 1fr 1.2fr;
          }
          .it__act-head span:nth-child(3),
          .it__act-row span:nth-child(3) {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}

export default ItemPage;
