import { SearchableNftData } from '@/store/nftsReducer';
import { BaseMedia } from '@/components/Media/BaseMedia';
import useSageRoutes from '@/hooks/useSageRoutes';
import { transformTitle } from '@/utilities/strings';

interface Props {
  nft: SearchableNftData;
  i: number;
}

type ImgAspectRatio = '16/9' | '9/16' | '1/1';
const aspectRatios: ImgAspectRatio[] = ['16/9', '1/1', '9/16'];

//low accuracy implementation
//we assume generally that the vetting process leads artist to give works  based only on these 3 main aspect ratios
function computeSearchTileAspectRatio(width: number, height: number): ImgAspectRatio {
  let dataAspect: ImgAspectRatio = '1/1';
  const difference = Math.abs(width - height);
  if (difference > 0) {
    if (difference < height * 0.5) {
      return (dataAspect = '16/9');
    }
  }
  if (difference > 0) {
    if (difference > height * 0.5) {
      return (dataAspect = '16/9');
    }
    return (dataAspect = '9/16');
  }
  return dataAspect;
}
export default function SearchResultsTile({ nft, i }: Props) {
  const { pushToDrops, pushToCreators } = useSageRoutes();
  const handleClick = async () => {
    if (nft.dId) {
      pushToDrops(nft.dId);
    } else {
      pushToCreators(nft.artist);
    }
  };
  const { width, height } = nft;
  const dataAspect = computeSearchTileAspectRatio(width, height);
  return (
    <div className='search-page__grid-item' data-aspect={dataAspect} onClick={handleClick}>
      <div onClick={handleClick} className='search-page__grid-item-img'>
        <BaseMedia className='search-page__grid-item-img' src={nft.s3PathOptimized}></BaseMedia>
      </div>
      <div className='search-page__grid-item-info'>
        <h1 className='search-page__grid-item-info-nft-name'>{transformTitle(nft.name)}</h1>
        <h1 className='search-page__grid-item-info-artist-name'>by {nft.artist}</h1>
      </div>
    </div>
  );
}
