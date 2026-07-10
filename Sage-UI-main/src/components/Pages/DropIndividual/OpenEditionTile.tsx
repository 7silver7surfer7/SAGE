import React from 'react';
import useCountdown from '@/hooks/useCountdown';
import useModal from '@/hooks/useModal';
import MintOpenEditionModal from '@/components/Modals/Games/MintOpenEditionModal';
import { OpenEdition_include_Nft, User } from '@/prisma/types';
import Media from './Media';

interface Props {
  dropName: string;
  artist: User;
  openEdition: OpenEdition_include_Nft;
  className: string;
}

export default function OpenEditionTile({ artist, dropName, openEdition, className }: Props) {
  const { isOpen, closeModal, openModal } = useModal();
  const startTime = new Date(openEdition.startTime).getTime();
  const endTime = new Date(openEdition.endTime).getTime();
  const now = Date.now();
  const isStarted = now >= startTime;
  const isEnded = now > endTime;

  const { displayValue: countdownUntilOpen } = useCountdown({ targetDate: startTime });
  const { displayValue: countdownUntilClose } = useCountdown({ targetDate: endTime });

  const priceText =
    openEdition.costTokens > 0
      ? `${openEdition.costTokens} SAGE`
      : openEdition.costPoints > 0
      ? `${openEdition.costPoints} pixels`
      : 'free mint';

  return (
    <div onClick={openModal} className={className}>
      <MintOpenEditionModal
        openEdition={openEdition}
        artist={artist}
        dropName={dropName}
        isOpen={isOpen}
        closeModal={closeModal}
      />
      <Media focusText={`Open Edition — ${priceText}`} src={openEdition.Nft.s3PathOptimized} />
      <div className='drop-page__grid-item-info'>
        <div className='drop-page__grid-item-info-left'>
          <h1 className='drop-page__grid-item-info-drop-name'>
            {dropName} by {artist.username}
          </h1>
          <h1 className='drop-page__grid-item-info-game-name'>{openEdition.Nft.name}</h1>
        </div>
        <div className='drop-page__grid-item-info-right'>
          {!isStarted && (
            <div className='drop-page__grid-item-info-countdown'>{countdownUntilOpen}</div>
          )}
          {isStarted && !isEnded && (
            <div className='drop-page__grid-item-info-countdown'>{countdownUntilClose}</div>
          )}
          {isEnded && <div className='drop-page__grid-item-info-countdown'>Ended</div>}
        </div>
      </div>
    </div>
  );
}
