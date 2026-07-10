import { BaseMedia } from '@/components/Media/BaseMedia';
import { GamePrize } from '@/prisma/types';
import usePagination from '@/hooks/usePagination';
import { formatDateYYMMddHHmm } from '@/utilities/strings';
import React from 'react';
import ClaimPrizeButton from './ClaimPrizeButton';
import Pagination from './Pagination';

const getTimeMilis = (x: GamePrize) => {
  return (x as GamePrize).claimedAt ? new Date((x as GamePrize).claimedAt).getTime() : undefined;
};

const sorting = (a: GamePrize, b: GamePrize) => {
  const aTime = getTimeMilis(a);
  const bTime = getTimeMilis(b);
  if (aTime) {
    return bTime ? bTime - aTime : 1;
  }
  if (bTime) {
    return -1;
  }
  return 1;
};

interface Props {
  prizeNfts: any[];
}

function ClaimPanel({ prizeNfts }: Props) {
  const PAGE_SIZE = 10;
  const { selectedPage, onNext, onPrev, pageSize } = usePagination({
    totalCount: prizeNfts.length,
    pageSize: PAGE_SIZE,
  });

  const firstIndex = (selectedPage - 1) * pageSize;
  const secondIndex = selectedPage * pageSize;
  const sortedItems = prizeNfts.sort(sorting);
  const pageItems = sortedItems.slice(firstIndex, secondIndex);
  return (
    <>
      <div className='notifications-panel__data-list'>
        {prizeNfts.map((prize: any, i: number) => {
          const dateDisplay = prize.claimedAt ? formatDateYYMMddHHmm(prize.claimedAt) : 'unclaimed';
          return (
            <tr key={prize.nftId} className='notifications-panel__data-row'>
              <td className='notifications-panel__td--creation'>
                <div className='notifications-panel__td-media-container'>
                  <BaseMedia
                    src={prize.s3PathOptimized}
                    className='notifications-panel__td-media'
                  ></BaseMedia>
                </div>
                <span className='notifications-panel__td--creation-name'>{prize.nftName}</span>
              </td>
              <td className='notifications-panel__td--date'>{dateDisplay}</td>
              <td className='notifications-panel__td--interact'>
                <ClaimPrizeButton gamePrize={prize} />
              </td>
            </tr>
          );
        })}
      </div>

      {prizeNfts && prizeNfts.length >= PAGE_SIZE && (
        <Pagination onPrev={onPrev} selectedPage={selectedPage} onNext={onNext}></Pagination>
      )}
    </>
  );
}

export default ClaimPanel;
