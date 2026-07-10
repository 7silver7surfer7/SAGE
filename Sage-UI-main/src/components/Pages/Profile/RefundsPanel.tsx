import { BaseMedia } from '@/components/Media/BaseMedia';
import { Refund } from '@prisma/client';
import { formatTimestampYYMMddHHmm } from '@/utilities/strings';
import React from 'react';
import ClaimRefundButton from './ClaimRefundButton';
import usePagination from '@/hooks/usePagination';
import Pagination from './Pagination';

interface Props {
  refunds: any[];
}

function RefundsPanel({ refunds }: Props) {
  const PAGE_SIZE = 10;
  const { selectedPage, onNext, onPrev, pageSize } = usePagination({
    totalCount: refunds.length,
    pageSize: PAGE_SIZE,
  });
  return (
    <>
      <div className='notifications-panel__data-list'>
        {refunds.map((refund) => {
          const dateDisplay = refund.blockTimestamp
            ? formatTimestampYYMMddHHmm(refund.blockTimestamp)
            : 'unclaimed';
          return (
            <tr key={refund.id} className='notifications-panel__data-row'>
              <td className='notifications-panel__td--creation'>
                <div className='notifications-panel__td-media-container'>
                  <BaseMedia
                    src={refund.Lottery.Nfts[0].s3PathOptimized}
                    className='notifications-panel__td-media'
                  ></BaseMedia>
                </div>
                <span className='notifications-panel__td--creation-name'>
                  REFUND: {refund.refundableTokens} SAGE
                </span>
              </td>
              <td className='notifications-panel__td--date'>{dateDisplay}</td>
              <td className='notifications-panel__td--interact'>
                <ClaimRefundButton refund={refund} />
              </td>
            </tr>
          );
        })}
      </div>

      {refunds && refunds.length >= PAGE_SIZE && (
        <Pagination onPrev={onPrev} selectedPage={selectedPage} onNext={onNext}></Pagination>
      )}
    </>
  );
}

const getTimeMilis = (x: Refund) => {
  return (x as Refund).blockTimestamp ? (x as Refund).blockTimestamp * 1000 : undefined;
};

const sorting = (a: Refund, b: Refund) => {
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

export default RefundsPanel;
