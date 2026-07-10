import { BaseMedia } from '@/components/Media/BaseMedia';
import useSageRoutes from '@/hooks/useSageRoutes';
import React from 'react';
import { Drop } from '@prisma/client';

interface Props {
  drop: Drop;
}

function DropTile({ drop }: Props) {
  const { pushToDrops } = useSageRoutes();
  function TileOnClick() {
    pushToDrops(drop.id);
  }
  return (
    <div className='artist-page__grid-tile' onClick={TileOnClick}>
      <div className='artist-page__grid-tile-media'>
        <BaseMedia src={drop.bannerImageS3Path} />
      </div>
      <div className='artist-page__grid-tile-info'>
        <div className='artist-page__grid-tile-info-left'>
          <p className='artist-page__grid-tile-title'>{drop.name}</p>
        </div>
        <div className='artist-page__grid-tile-info-right'>
          {/* {isForSale ? (
            <>
              {hasOffers ? (
                <h2 className='artist-page__grid-tile-info-price'>
                  {sellOffer
                    ? `BUY NOW: ${nft.price} SAGE`
                    : `HIGHEST BID: ${highestOffer.price} SAGE`}
                </h2>
              ) : (
                <h2 className='artist-page__grid-tile-info-price'>ACCEPTING BIDS</h2>
              )}
            </>
          ) : (
            <h2 className='artist-page__grid-tile-info-price'>
              OWNED BY: {shortenAddress(nft.ownerAddress)}
            </h2>
          )} */}
        </div>
      </div>
    </div>
  );
}

export default DropTile;
