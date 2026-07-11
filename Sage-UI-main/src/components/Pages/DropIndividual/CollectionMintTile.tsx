import React from 'react';
import useCountdown from '@/hooks/useCountdown';
import useModal from '@/hooks/useModal';
import MintCollectionModal from '@/components/Modals/Games/MintCollectionModal';
import { CollectionMint, User } from '@prisma/client';
import { useGetCollectionMintCountQuery } from '@/store/dropsReducer';
import Media from './Media';

interface Props {
  dropName: string;
  artist: User;
  collection: CollectionMint;
  className: string;
}

export default function CollectionMintTile({ artist, dropName, collection, className }: Props) {
  const { isOpen, closeModal, openModal } = useModal();
  const startTime = new Date(collection.startTime).getTime();
  // null endTime = no deadline — the mint stays open until it sells out
  const endTime = collection.endTime ? new Date(collection.endTime).getTime() : null;
  const now = Date.now();
  const isStarted = now >= startTime;
  const isEnded = endTime != null && now > endTime;

  const { displayValue: countdownUntilOpen } = useCountdown({ targetDate: startTime });
  const { displayValue: countdownUntilClose } = useCountdown({
    targetDate: endTime ?? Number.MAX_SAFE_INTEGER,
  });

  const { data: liveMintCount } = useGetCollectionMintCountQuery(collection.collectionId!, {
    skip: collection.collectionId == null,
    pollingInterval: 30000,
  });
  const mintedCount = liveMintCount ?? collection.mintCount;
  const isSoldOut = mintedCount >= collection.maxSupply;

  const priceText = collection.costTokens > 0 ? `${collection.costTokens} SAGE` : 'free mint';

  return (
    <div onClick={openModal} className={className}>
      <MintCollectionModal
        collection={collection}
        artist={artist}
        dropName={dropName}
        isOpen={isOpen}
        closeModal={closeModal}
      />
      <Media
        focusText={`Collection of ${collection.maxSupply} — ${priceText}`}
        src={collection.previewImagePath || ''}
      />
      <div className='drop-page__grid-item-info'>
        <div className='drop-page__grid-item-info-left'>
          <h1 className='drop-page__grid-item-info-drop-name'>
            {dropName} by {artist.username}
          </h1>
          <h1 className='drop-page__grid-item-info-game-name'>
            {mintedCount} / {collection.maxSupply} minted
          </h1>
        </div>
        <div className='drop-page__grid-item-info-right'>
          {!isStarted && (
            <div className='drop-page__grid-item-info-countdown'>{countdownUntilOpen}</div>
          )}
          {isStarted && !isEnded && !isSoldOut && (
            <div className='drop-page__grid-item-info-countdown'>
              {endTime != null ? countdownUntilClose : 'Open until sold out'}
            </div>
          )}
          {isSoldOut && <div className='drop-page__grid-item-info-countdown'>Sold out</div>}
          {isEnded && !isSoldOut && <div className='drop-page__grid-item-info-countdown'>Ended</div>}
        </div>
      </div>
    </div>
  );
}
