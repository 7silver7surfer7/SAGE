import NftTile from '@/components/Tiles/NftTile';
import type { Drop_include_GamesAndArtist, Lottery_include_Nft } from '@/prisma/types';
import { basePathLotteries } from '@/constants/paths';
import GetTicketModal from '@/components/Modals/Games/GetTicketModal';
import useModal from '@/hooks/useModal';
import { User } from '@prisma/client';
import GetTicketsButton from '../Games/GetTicketsButton';

type Props = {
  drawing: Lottery_include_Nft;
  artist: User;
  dropName: string;
};

export default function DrawingTile({ drawing, artist, dropName }: Props) {
  const { openModal, isOpen: isModalOpen, closeModal } = useModal(false);
  const isActive = false;

  return (
    <NftTile
      button={
        <div className='nft-tile__btn-container'>
          <GetTicketsButton onClick={openModal} pending={false} />
        </div>
      }
      name={drawing.Nfts[0].name}
      subtitle={`${drawing.Nfts[0].numberOfEditions} editions`}
      imgSrc={drawing.Nfts[0].s3Path}
      imgLink={`${basePathLotteries}/${drawing.id}`}
    >
      <GetTicketModal
        isOpen={isModalOpen}
        closeModal={closeModal}
        lottery={drawing}
        nft={drawing.Nfts[0]}
        artist={artist}
        dropName={dropName}
      />
    </NftTile>
  );
}
