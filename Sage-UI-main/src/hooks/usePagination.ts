import { useMemo, useState } from 'react';

interface Args {
  totalCount: number;
  pageSize: number;
}

export default function usePagination({ totalCount, pageSize }: Args) {
  const [selectedPage, setSelectedPage] = useState<number>(1);

  const totalPages = useMemo(() => {
    const totalPages = Math.ceil(totalCount / pageSize);
    return totalPages;
  }, [totalCount, pageSize]);

  function onNext() {
    if (selectedPage + 1 > totalPages) return;
    setSelectedPage((prevState) => {
      return prevState + 1;
    });
  }

  function onPrev() {
    if (selectedPage - 1 <= 0) return;
    setSelectedPage((prevState) => {
      return prevState - 1;
    });
  }

  return { selectedPage, onNext, onPrev, pageSize };
}
