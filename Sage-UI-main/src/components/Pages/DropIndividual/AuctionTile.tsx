import Countdown from '@/components/Countdown';
import PlaceBidModal from '@/components/Modals/Games/PlaceBidModal';
import useAuction from '@/hooks/useAuction';
import useCountdown from '@/hooks/useCountdown';
import useModal from '@/hooks/useModal';
import { Auction_include_Nft, User } from '@/prisma/types';
import React from 'react';
import Media from './Media';
import TileHeader from './TileHeader';

interface Props {
  dropName: string;
  artist: User;
  auction: Auction_include_Nft;
  className: string;
}

export default function AuctionTile({ artist, dropName, auction, className }: Props) {
  const { isOpen, closeModal, openModal } = useModal();

  const {
    nftPath,
    auctionFocusText,
    editionSize,
    isStarted,
    isOpenForBids,
    isRunning,
    isEnded,
    startTime,
    endTime,
    artistName,
    auctionState,
    nftName,
  } = useAuction({
    auction,
    artist,
  });

  const { displayValue: countdownUntilOpen } = useCountdown({ targetDate: startTime });
  const { displayValue: countdownUntilClose } = useCountdown({ targetDate: endTime });

  // if (!auctionState) return null;

  return (
    <div onClick={openModal} className={className}>
      <PlaceBidModal
        auction={auction}
        artist={artist}
        dropName={dropName}
        isOpen={isOpen}
        closeModal={closeModal}
      />
      <Media focusText={auctionFocusText} src={auction.Nft.s3PathOptimized}></Media>
      <div className='drop-page__grid-item-info'>
        <div className='drop-page__grid-item-info-left'>
          <h1 className='drop-page__grid-item-info-drop-name'>
            {dropName} by {artistName}
          </h1>
          <h1 className='drop-page__grid-item-info-game-name'>{nftName}</h1>
        </div>
        <div className='drop-page__grid-item-info-right'>
          {!isStarted && (
            <div className='drop-page__grid-item-info-countdown'>{countdownUntilOpen}</div>
          )}
          {!isRunning && isOpenForBids && (
            <div className='drop-page__grid-item-info-countdown'>Bid</div>
          )}
          {isRunning && !isEnded && (
            <div className='drop-page__grid-item-info-countdown'>{countdownUntilClose}</div>
          )}
        </div>
      </div>
    </div>
  );
}
