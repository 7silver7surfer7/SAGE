import { BaseMedia } from '@/components/Media/BaseMedia';
import { basePathDrops } from '@/constants/paths';
import useSageRoutes from '@/hooks/useSageRoutes';
import { getHomePageData } from '@/prisma/functions';
import { NewArtwork } from '@/prisma/types';
import { Nft, User } from '@prisma/client';
import { useRouter } from 'next/router';
import { Fragment } from 'react';

interface Props {
  newArtworks: NewArtwork[];
}
export default function NewArtworks({ newArtworks }: Props) {
  if (!newArtworks) return null;
  return (
    <>
      <div className='home-page__new-artworks-header-section'>
        <p className='home-page__new-artworks-header'>NEW ARTWORK</p>
        {/* <p className='home-page__new-artworks-subheader'>Fresh mints by SAGE creators</p> */}
      </div>
      <section className='home-page__new-artworks-section'>
        <div className='home-page__new-artworks-flex-container'>
          {newArtworks.slice(0, 5).map((nft) => {
            return <NewArtworksTile {...nft} key={nft.s3PathOptimized} />;
          })}
        </div>
      </section>
      <section className='home-page__new-artworks-section--mobile'>
        <div className='home-page__new-artworks-flex-container--mobile'>
          {newArtworks.slice(0, 10).map((nft) => {
            return <NewArtworksTile {...nft} key={nft.s3PathOptimized} />;
          })}
        </div>
      </section>
    </>
  );
}

interface NewArtworksTileProps extends NewArtwork {}

function NewArtworksTile({ s3PathOptimized, artistUsername, name, dropId }: NewArtworksTileProps) {
  const { pushToDrops, pushToCreators } = useSageRoutes();
  function handleMediaClick() {
    if (dropId) {
      pushToDrops(dropId);
    }
  }
  return (
    <div className='home-page__new-artworks-item'>
      <div onClick={handleMediaClick} className='home-page__new-artworks-media'>
        <BaseMedia src={s3PathOptimized}></BaseMedia>
      </div>
      <div className='home-page__new-artworks-item-content'>
        <div className='home-page__new-artworks-item-right'>
          <p className='home-page__new-artworks-item-name'>{name}</p>
          <p
            className='home-page__new-artworks-item-artist-name'
            onClick={() => {
              pushToCreators(artistUsername);
            }}
          >
            {artistUsername && `By ${artistUsername}`}
          </p>
        </div>
      </div>
    </div>
  );
}
