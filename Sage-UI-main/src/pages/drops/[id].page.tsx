import { GetStaticPropsContext, GetStaticPathsResult, GetStaticPropsResult } from 'next';
import prisma from '@/prisma/client';
import { Nft } from '@prisma/client';
import { Lottery_include_Nft, Auction_include_Nft } from '@/prisma/types';
import { useTicketCount } from '@/hooks/useTicketCount';
import React from 'react';
import Logotype from '@/components/Logotype';
import {
  getIndividualDropsPagePaths,
  getIndividualDropsPageData,
  DropPageData,
} from '@/prisma/functions';
import System from '@/components/Icons/System';
import AuctionTile from '@/components/Pages/DropIndividual/AuctionTile';
import OpenEditionTile from '@/components/Pages/DropIndividual/OpenEditionTile';
import DrawingTile from '@/components/Pages/DropIndividual/DrawingTile';
import { useSession } from 'next-auth/react';
import useDrop from '@/hooks/useDrop';
import { BaseMedia, PfpImage } from '@/components/Media/BaseMedia';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import useSageRoutes from '@/hooks/useSageRoutes';

//type drop page data

//determines the type interface received from getStaticProps()
interface Props {
  drop: DropPageData;
  artist: DropPageData['NftContract']['Artist'];
  drawings: DropPageData['Lotteries'];
  auctions: DropPageData['Auctions'];
  openEditions: DropPageData['OpenEditions'];
  gamesCount: number;
}

// function filterDrawingsFromLottery(array: Lottery_include_Nft[]) {
//   return {
//     drawings: array.filter((l: Lottery_include_Nft) => unique(l.Nfts, 's3Path').length == 1),
//     lotteries: array.filter((l: Lottery_include_Nft) => unique(l.Nfts, 's3Path').length > 1),
//   };
// }

function unique(array: any[], propertyName: string) {
  return array.filter((e, i) => array.findIndex((a) => a[propertyName] === e[propertyName]) === i);
}

// function computeEditionSize(nfts: Nft[]) {
//   let editionSize = 0;
//   const uniqueImages = unique(nfts, 's3Path');
//   uniqueImages.forEach((nft) => {
//     editionSize += nft.numberOfEditions;
//   });
//   return editionSize;
// }

type GridClassName =
  | 'drop-page__grid--base'
  | 'drop-page__grid--single'
  | 'drop-page__grid--double';

type TileClassName =
  | 'drop-page__grid-item--base'
  | 'drop-page__grid-item--single'
  | 'drop-page__grid-item--double';

export default function drop({ drop, auctions, artist, drawings, openEditions, gamesCount }: Props) {
  const {
    systemTypes,
    bannerImgSrc,
    dropName,
    dropDescription,
    artistName,
    createdAt,
    country,
    state,
  } = useDrop({
    drop,
    Auctions: auctions,
    Lotteries: drawings,
    OpenEditions: openEditions,
    artist,
  });
  const { data: sessionData } = useSession();
  const ticketCountMap = useTicketCount(
    new Array().concat(drawings),
    sessionData?.address as string
  );

  const { pushToCreators } = useSageRoutes();

  function handleShareDrop() {
    navigator.clipboard.writeText(window.location.toString());
    toast.success('copied to clipboard!');
  }

  let gridClassName: GridClassName = 'drop-page__grid--base';
  let tileClassName: TileClassName = 'drop-page__grid-item--base';
  if (gamesCount === 1) {
    gridClassName = 'drop-page__grid--single';
    tileClassName = 'drop-page__grid-item--single';
  }
  if (gamesCount === 2) {
    gridClassName = 'drop-page__grid--double';
    tileClassName = 'drop-page__grid-item--double';
  }

  return (
    <>
      <div className='drop-page__banner-base'>
        <BaseMedia src={bannerImgSrc} />
      </div>
      <div className='drop-page'>
        <header className='drop-page__header'>
          <div className='drop-page__header-logotype'>
            <Logotype dataColor='white' />
          </div>
          <section className='drop-page__header-drop-info'>
            <div className='drop-page__header-main-column'>
              <h1 className='drop-page__header-drop-name'>
                <i className='drop-page__header-drop-name-italic'>{dropName},</i> by {artistName}
              </h1>
              {/* static prop — every visitor (signed-in or not) sees that this
                  drop is gated; the buy buttons enforce per-wallet access */}
              {(drop as any).allowlistEnabled && (
                <p
                  className='drop-page__header-drop-details-item'
                  style={{
                    display: 'inline-block',
                    border: '1px solid currentColor',
                    borderRadius: '999px',
                    padding: '2px 12px',
                    fontSize: '12px',
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    margin: '6px 0',
                  }}
                >
                  allowlist only
                </p>
              )}
              {/* <p className='drop-page__header-drop-description'>{dropDescription}</p> */}
              <div className='drop-page__header-drop-details'>
                <p className='drop-page__header-drop-details-item'>
                  <strong>Minted by:</strong> {artistName}
                </p>
                <p className='drop-page__header-drop-details-item'>
                  <strong>Creation date:</strong> {createdAt}
                </p>
                {/* <div className='drop-page__header-drop-details-item'>
                  <strong>Systems in this drop:</strong>
                  {systemTypes.map((type) => {
                    return (
                      <div key={type} className='drop-page__systems-icon'>
                        <System type={type}></System>
                      </div>
                    );
                  })}
                </div> */}
              </div>

              {/* <button onClick={handleShareDrop} className='drop-page__share-button'>
                SHARE DROP
              </button> */}
            </div>
          </section>
        </header>
        <section className='drop-page__content'>
          <div className='drop-page__drop-info'>
            <div className='drop-page__artist'>
              {/* no uploaded icon -> no icon at all (never the default SAGE mark) */}
              {artist.profilePicture && (
                <div
                  onClick={() => {
                    pushToCreators(artistName);
                  }}
                  className='drop-page__artist-pfp'
                >
                  <PfpImage src={artist.profilePicture}></PfpImage>
                </div>
              )}
              <div className='drop-page__artist-info'>
                <p className='drop-page__artist-name'>{artist.username}</p>
                {state && country && (
                  <p className='drop-page__artist-label'>
                    {state}, {country}
                  </p>
                )}
              </div>
            </div>
            <h3 className='drop-page__drop-info-name'>{drop.name}</h3>
            <p className='drop-page__drop-info-description'>{drop.description}</p>
          </div>
          <div className={gridClassName}>
            {auctions.map((a) => {
              return (
                <AuctionTile
                  key={a.id}
                  className={tileClassName}
                  dropName={drop.name}
                  artist={artist}
                  auction={a}
                />
              );
            })}
            {openEditions.map((oe) => {
              return (
                <OpenEditionTile
                  key={`oe-${oe.id}`}
                  className={tileClassName}
                  dropName={drop.name}
                  artist={artist}
                  openEdition={oe}
                />
              );
            })}
            {drawings.map((d) => {
              return (
                <DrawingTile
                  className={tileClassName}
                  key={d.id}
                  dropName={drop.name}
                  artistName={artistName}
                  drawing={d}
                  tickets={ticketCountMap ? ticketCountMap[d.id] : 0}
                />
              );
            })}
          </div>
        </section>
      </div>
    </>
  );
}

export async function getStaticProps({
  params,
}: GetStaticPropsContext): Promise<GetStaticPropsResult<Props>> {
  if (!params) {
    return {
      redirect: {
        destination: '/404',
        permanent: false,
      },
    };
  }

  const drop = await getIndividualDropsPageData(prisma, Number(params.id));

  if (!drop) {
    return {
      redirect: {
        destination: '/404',
        permanent: false,
      },
    };
  }

  const auctions = drop.Auctions;
  const artist = drop.NftContract.Artist;
  const drawings = drop.Lotteries;
  const openEditions = drop.OpenEditions;
  const gamesCount: number = auctions.length + drawings.length + openEditions.length;

  return {
    props: {
      drop,
      artist,
      auctions,
      drawings,
      openEditions,
      gamesCount,
    },
    revalidate: 60,
  };
}

export async function getStaticPaths(): Promise<GetStaticPathsResult> {
  const paths = await getIndividualDropsPagePaths(prisma);
  return { paths, fallback: 'blocking' };
}
