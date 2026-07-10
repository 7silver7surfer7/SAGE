import LoaderSpinner from '@/components/LoaderSpinner';
import Logotype from '@/components/Logotype';
import SearchResultsTile from '@/components/Pages/Search/SearchResultsTile';
import { SearchInput } from '@/components/SearchInput';
import useWindowDimensions from '@/hooks/useWindowSize';
import { SearchableNftData, useGetSearchableNftDataQuery } from '@/store/nftsReducer';
import { useSearch } from '@/store/searchContext';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';

export default function Search() {
  const ITEMS_PER_PAGE = 9;
  const [displayCount, setDisplayCount] = useState<number>(ITEMS_PER_PAGE);
  const { data, isLoading } = useGetSearchableNftDataQuery();
  const { query, setQuery } = useSearch();

  useEffect(() => {
    setDisplayCount(ITEMS_PER_PAGE); // reset display count to default when query changes
  }, [query]);

  const urlParamQuery = useRouter().query.q as string;
  if (query == null && urlParamQuery) {
    setQuery(urlParamQuery); // use url param if context is uninitialized
  }

  const results = performSearch(data!, query);
  const displayResults = results.slice(0, displayCount);

  const handleLoadMoreBtnClick = () => {
    setDisplayCount(displayCount + ITEMS_PER_PAGE);
  };

  const { isMobile } = useWindowDimensions();
  const desktopDivisor = 4;
  const rowDivisor: number = isMobile ? desktopDivisor / 2 : desktopDivisor;
  const gridRows: number = Math.floor(displayCount / rowDivisor);
  const rowHeight: string = isMobile ? '32vw' : '16vw';

  return (
    <div className='search-page'>
      <div className='search-page__logotype-container'>
        <Logotype></Logotype>
      </div>
      <div className='searchresults__header'>
        <div className='searchresults__term'>
          <SearchInput className='searchresults__input' displayIcon={false} />
        </div>
        <div className='searchresults__text'>
          {isLoading && <LoaderSpinner />}
          {data &&
            query &&
            (query.length < 3
              ? 'Search must include at least 3 characters'
              : results.length == 0
              ? 'No Results Found'
              : 'Your Search Results')}
        </div>
      </div>
      <div
        className='search-page__grid'
        style={{ gridTemplateRows: `repeat(${gridRows}, ${rowHeight})` }}
      >
        {displayResults &&
          displayResults.map((nft: SearchableNftData, i: number) => (
            <SearchResultsTile key={i} nft={nft} i={i} />
          ))}
      </div>
      {displayCount < results.length && (
        <button className='searchresults__button' onClick={handleLoadMoreBtnClick}>
          Load more results
        </button>
      )}
    </div>
  );
}

function performSearch(data: SearchableNftData[], query: string): SearchableNftData[] {
  if (!data || !query || query.length < 3) {
    return [];
  }
  query = query.toLowerCase();
  return data.filter((item) => {
    return (
      item.artist.toLowerCase().indexOf(query) != -1 ||
      item.name.toLowerCase().indexOf(query) != -1 ||
      // item.tags.toLowerCase().indexOf(query) != -1 ||
      (item.dName && item.dName.toLowerCase().indexOf(query) != -1)
    );
  });
}
