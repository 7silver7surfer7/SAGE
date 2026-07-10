import { BaseMedia } from '@/components/Media/BaseMedia';
import Media from './Media';
import { Lottery_include_Nft } from '@/prisma/types';
import React from 'react';
import GetTicketModal from '@/components/Modals/Games/GetTicketModal';
import useModal from '@/hooks/useModal';
import TileHeader from './TileHeader';
import Countdown from '@/components/Countdown';
import useLottery from '@/hooks/useLottery';
import useCountdown from '@/hooks/useCountdown';

interface Props {
  dropName: string;
  artistName: string;
  drawing: Lottery_include_Nft;
  tickets: number;
  className: string;
}

export default function DrawingTile({ artistName, dropName, drawing, tickets, className }: Props) {
  const { isOpen, closeModal, openModal } = useModal();
  const {
    isStarted,
    isLive,
    isEnded,
    mediaSrc,
    optimizedMediaSrc,
    selectedNftName,
    selectedNftEditionsCount,
    endTime,
    startTime,
  } = useLottery({
    lottery: drawing,
    nfts: drawing.Nfts,
  });
  let focusText: string = 'Starting soon';

  const { displayValue } = useCountdown({ targetDate: startTime });
  const { displayValue: countdownEnd } = useCountdown({ targetDate: endTime });

  if (isLive) {
    focusText = 'Enter Drawing';
  }

  if (isEnded) {
    focusText = 'Results';
  }
  return (
    <div onClick={openModal} className={className}>
      <GetTicketModal
        lottery={drawing}
        dropName={dropName}
        artistName={artistName}
        isOpen={isOpen}
        closeModal={closeModal}
        ticketCount={tickets}
        systemType='drawing'
      ></GetTicketModal>
      <Media focusText={focusText} src={optimizedMediaSrc}></Media>
      <div className='drop-page__grid-item-info'>
        <div className='drop-page__grid-item-info-left'>
          <h1 className='drop-page__grid-item-info-drop-name'>
            {dropName} by {artistName}
          </h1>
          <h1 className='drop-page__grid-item-info-game-name'>{selectedNftName}</h1>
          {tickets > 0 && (
            <h1 className='drop-page__grid-item-info-tickets'>
              You have {tickets} {tickets > 1 ? 'entries' : 'entry'}
            </h1>
          )}
        </div>
        <div className='drop-page__grid-item-info-right'>
          {!isStarted && <div className='drop-page__grid-item-info-countdown'>{displayValue}</div>}
          {isLive && <div className='drop-page__grid-item-info-countdown'>{countdownEnd}</div>}
        </div>
      </div>
    </div>
  );
}
