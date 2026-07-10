import { Lottery_include_Nft } from '@/prisma/types';
import { BaseMedia } from '@/components/Media/BaseMedia';

interface Props {
  lottery: Lottery_include_Nft;
}
export default function LotteryThumbnail({ lottery}: Props) {
  function unique(array: any[], propertyName: string) {
    return array.filter(
      (e, i) => array.findIndex((a) => a[propertyName] === e[propertyName]) === i
    );
  }
  const uniqueImages = unique(lottery.Nfts, 's3Path');
  return (
    <div
      style={{ gridTemplateColumns: `repeat(${uniqueImages.length - 1}, 1fr)` }}
      className='lottery-thumbnail'
    >
      {uniqueImages.map((nft, i) => {
        return (
          <div key={i} data-item={`lottery-nft-${nft.id}`} className='lottery-thumbnail__item'>
            <BaseMedia className='drop-page__grid-item-media-src' src={nft.s3PathOptimized} />
          </div>
        );
      })}
    </div>
  );
}
