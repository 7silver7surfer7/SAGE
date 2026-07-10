import { BaseMedia } from '@/components/Media/BaseMedia';
import useDrop, { UseDropArgs } from '@/hooks/useDrop';

export default function DropItem({ drop, artist, Lotteries, Auctions, OpenEditions }: UseDropArgs) {
  const { bannerImgSrc, dropName, goToDropOnClick } = useDrop({
    drop,
    artist,
    Lotteries,
    Auctions,
    OpenEditions,
  });

  return (
    <div key={drop.id} className='drops-page__drop'>
      <div className='drops-page__drop-header' onClick={goToDropOnClick}>
        <h3 className='drops-page__drop-header-title'>{dropName}</h3>
        <BaseMedia src={bannerImgSrc} className='drops-page__drop-backdrop' />
      </div>
    </div>
  );
}
