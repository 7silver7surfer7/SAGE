import { BaseMedia } from '@/components/Media/BaseMedia';
import { Lottery_include_Nft, User } from '@/prisma/types';
import React from 'react';
import GetTicketModal from '@/components/Modals/Games/GetTicketModal';
import useModal from '@/hooks/useModal';
import TileHeader from './TileHeader';
import LotteryThumbnail from './LotteryThumbnail';
import Countdown from '@/components/Countdown';
import { transformTitle } from '@/utilities/strings';
import useLottery from '@/hooks/useLottery';

interface Props {
  imgSrc: string;
  dropName: string;
  artistName: string;
  lottery: Lottery_include_Nft;
  tickets: number;
}
export default function LotteryTile({ artistName, dropName, lottery, tickets }: Props) {
  const { isOpen, closeModal, openModal } = useModal();
  const { isStarted, selectedNftEditionsCount, startTime, endTime, isEnded } = useLottery({
    lottery,
    nfts: lottery.Nfts,
  });
  return (
    <div className='drop-page__grid-item' onClick={openModal}>
      <GetTicketModal
        lottery={lottery}
        dropName={dropName}
        artistName={artistName}
        isOpen={isOpen}
        ticketCount={tickets}
        closeModal={closeModal}
        systemType={'lottery'}
      ></GetTicketModal>
      <TileHeader systemType={'lottery'} editionSize={selectedNftEditionsCount}></TileHeader>
      <div className='drop-page__grid-item-media-container'>
        <LotteryThumbnail lottery={lottery}></LotteryThumbnail>
        <div className='drop-page__grid-item-img-overlay'></div>
        <div className='drop-page__grid-item-focus'>{isEnded ? 'enter lottery' : 'results'}</div>
      </div>
      <div className='drop-page__grid-item-info'>
        <div className='drop-page__grid-item-info-left'>
          <h1 className='drop-page__grid-item-info-drop-name'>
            {dropName} by {artistName}
          </h1>
          <h1 className='drop-page__grid-item-info-game-name'>{transformTitle('lottery')}</h1>
          {tickets > 0 && (
            <h1 className='drop-page__grid-item-info-tickets'>
              You have {tickets} {tickets > 1 ? 'entries' : 'entry'}
            </h1>
          )}
        </div>
        <div className='drop-page__grid-item-info-right'>
          {isStarted && (
            <Countdown
              endTime={endTime}
              className='drop-page__grid-item-info-countdown'
            ></Countdown>
          )}
          {!isStarted && (
            <Countdown
              endTime={startTime}
              className='drop-page__grid-item-info-countdown'
            ></Countdown>
          )}
        </div>
      </div>
    </div>
  );
}
