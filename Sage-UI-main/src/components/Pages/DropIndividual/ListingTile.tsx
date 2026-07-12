import { Nft_include_NftContractAndOffers, User } from '@/prisma/types';
import { BaseMedia } from '@/components/Media/BaseMedia';
import shortenAddress from '@/utilities/shortenAddress';
import { Offer, OfferState } from '@prisma/client';
import useModal from '@/hooks/useModal';
import MakeOfferModal from '@/components/Modals/Games/MakeOfferModal';
import BuyNowModal from '@/components/Modals/Games/BuyNowModal';

interface Props {
  nft: Nft_include_NftContractAndOffers;
  artist: User;
}

function findActiveSellOffer(offers: Offer[]): Offer | null {
  const now = Math.floor(new Date().getTime() / 1000);
  for (var o of offers) {
    if (o.expiresAt > now && o.isSellOffer && o.state == OfferState.ACTIVE) {
      return o;
    }
  }
  return null;
}

function sortAndFilterOffers(offers: Offer[]) {
  const now = Math.floor(new Date().getTime() / 1000);
  const filtered = [...offers].filter((o) => o.state == OfferState.ACTIVE && o.expiresAt > now);
  const sorted = filtered.sort((a, b) => {
    return b.price - a.price;
  });
  return sorted.splice(0, 5);
}

export default function ListingTile({ nft, artist }: Props) {
  const { isOpen, closeModal, openModal } = useModal();
  const sellOffer = findActiveSellOffer(nft.Offers!);
  const handleClick = async () => {
    if (nft.ownerAddress) {
      return; // can't buy an NFT that is already owned
    }
    openModal();
  };
  const buyOffers = sortAndFilterOffers(nft.Offers);
  const highestOffer = buyOffers[0];
  const hasOffers: boolean = buyOffers.length > 0;
  const isForSale: boolean = !nft.ownerAddress;
  return (
    <div className='artist-page__grid-tile' onClick={handleClick}>
      {!sellOffer && (
        <MakeOfferModal
          buyOffers={buyOffers}
          artist={artist}
          nft={nft}
          isOpen={isOpen}
          closeModal={closeModal}
        />
      )}
      {sellOffer && (
        <BuyNowModal
          artist={artist}
          nft={nft}
          offer={sellOffer}
          isOpen={isOpen}
          closeModal={closeModal}
        />
      )}
      <div className='artist-page__grid-tile-media'>
        <BaseMedia src={nft.s3PathOptimized} />
      </div>
      <div className='artist-page__grid-tile-info'>
        <div className='artist-page__grid-tile-info-left'>
          <h3 className='artist-page__grid-tile-title'>{nft.name}</h3>
        </div>
        <div className='artist-page__grid-tile-info-right'>
          {isForSale ? (
            <>
              {hasOffers ? (
                <h2 className='artist-page__grid-tile-info-price'>
                  {sellOffer
                    ? `BUY NOW: ${nft.price} ${(sellOffer as any).currency === 'ETH' ? 'ETH' : 'SAGE'}`
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
          )}
        </div>
      </div>
    </div>
  );
}
