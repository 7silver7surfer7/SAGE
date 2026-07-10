import { useSearch } from '@/store/searchContext';
import { useRouter } from 'next/router';
import SearchSVG from '@/public/icons/search.svg';
import { toast } from 'react-toastify';

interface Props {
  className?: string;
  placeholder?: string;
  displayIcon?: boolean;
  dataColor?: string;
}

export const SearchInput = ({ className, placeholder, displayIcon, dataColor }: Props) => {
  const { query, setQuery } = useSearch();
  const router = useRouter();

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key == 'Enter') {
      handleButtonClick();
    }
  };

  const handleButtonClick = () => {
    if (query.length < 3) {
      toast.info('Search must include at least 3 characters');
      return;
    }
    router.push(`/search?q=${query}`);
  };

  return (
    <>
      <input
        type='text'
        value={query || undefined}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={className}
        data-color={dataColor}
      />
      {displayIcon && (
        <SearchSVG
          data-color={dataColor}
          onClick={handleButtonClick}
          className='searchform__white_icon'
        />
      )}
    </>
  );
};
