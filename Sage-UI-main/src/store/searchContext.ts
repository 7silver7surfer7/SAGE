import { createContext, useContext } from 'react';

export type SearchContextType = {
  query: string | null;
  setQuery: (query: string) => void;
};

export const SearchContext = createContext<SearchContextType>({
  query: null,
  setQuery: (q) => console.warn('no search provider'),
});

export const useSearch = () => useContext(SearchContext);
