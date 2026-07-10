import NftTile from '@/components/Tiles/NftTile';
import type { Auction_include_Nft } from '@/prisma/types';
import type { User } from '@prisma/client';
import { basePathAuctions } from '@/constants/paths';
import PlaceBidModal from '@/components/Modals/Games/PlaceBidModal';
import useModal from '@/hooks/useModal';
import { useGetAuctionStateQuery } from '@/store/services/auctionsReducer';
import PlaceBidButton from '../Games/PlaceBidButton';

type Props = {
  auction: Auction_include_Nft;
  artist: User;
};

// styles/components/_nft-tile.scss
export default function AuctionTile({ auction, artist }: Props) {
  const { openModal, isOpen: isModalOpen, closeModal } = useModal();
  const { data: auctionState } = useGetAuctionStateQuery(auction.id);
  const isActive = auctionState?.settled || false;
  return (
    <NftTile
      name={auction.Nft.name}
      button={
        <div className='nft-tile__btn-container'>
          <PlaceBidButton pending={false} onClick={openModal}></PlaceBidButton>
        </div>
      }
      subtitle={`Auction - ${auction.Nft.numberOfEditions} editions`}
      imgSrc={auction.Nft.s3Path}
      imgLink={`${basePathAuctions}/${auction.id}`}
    >
      <PlaceBidModal
        isOpen={isModalOpen}
        closeModal={closeModal}
        auction={auction}
        artist={artist}
      />
    </NftTile>
  );
}
