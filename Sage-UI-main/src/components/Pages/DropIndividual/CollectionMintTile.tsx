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
  /** the drop's payment currency: 'SAGE' (default) or 'ETH' */
  currency?: string;
}

export default function CollectionMintTile({ artist, dropName, collection, className, currency }: Props) {
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

  // 120s: the tile only needs a rough count — the mint modal itself polls
  // every 15s while open, which covers anyone actively minting. The old 30s
  // poll ran one RPC per tile per open tab indefinitely for no UX gain.
  const { data: liveMintCount } = useGetCollectionMintCountQuery(collection.collectionId!, {
    skip: collection.collectionId == null,
    pollingInterval: 120000,
  });
  const mintedCount = liveMintCount ?? collection.mintCount;
  const isSoldOut = mintedCount >= collection.maxSupply;

  const currencySymbol = currency === 'ETH' ? 'ETH' : 'SAGE';
  const priceText =
    collection.costTokens > 0 ? `${collection.costTokens} ${currencySymbol}` : 'free mint';

  return (
    <div onClick={openModal} className={className}>
      <MintCollectionModal
        collection={collection}
        artist={artist}
        dropName={dropName}
        currency={currency}
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
