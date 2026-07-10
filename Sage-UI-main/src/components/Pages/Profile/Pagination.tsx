import usePagination from '@/hooks/usePagination';
import React from 'react';

type PaginationProps = ReturnType<typeof usePagination>;

interface Props {
  onNext: PaginationProps['onNext'];
  onPrev: PaginationProps['onPrev'];
  selectedPage: PaginationProps['selectedPage'];
}

function Pagination({ onNext, onPrev, selectedPage }: Props) {
  return (
    <div className='notifications-panel__pagination'>
      <div onClick={onPrev} className='notifications-panel__pagination-page-arrow'>
        &lt;
      </div>
      <div className='notifications-panel__pagination-page'>{selectedPage}</div>
      <div onClick={onNext} className='notifications-panel__pagination-page-arrow'>
        &gt;
      </div>
    </div>
  );
}

export default Pagination;
