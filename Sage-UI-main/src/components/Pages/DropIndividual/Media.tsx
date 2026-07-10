import { BaseMedia } from '@/components/Media/BaseMedia';
interface Props {
  src: string;
  focusText: string;
}
export default function Media({ src, focusText }: Props) {
  return (
    <div className='drop-page__grid-item-media-container'>
      <BaseMedia autoPlay={false} className='drop-page__grid-item-media-src' src={src} />
      <div className='drop-page__grid-item-media-overlay' />
      <div className='drop-page__grid-item-focus'> {focusText}</div>
    </div>
  );
}
