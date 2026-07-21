import { BaseMedia } from '@/components/Media/BaseMedia';
interface Props {
  src: string;
  focusText: string;
  type?: string | null;
}
export default function Media({ src, focusText, type }: Props) {
  return (
    <div className='drop-page__grid-item-media-container'>
      <BaseMedia autoPlay={false} className='drop-page__grid-item-media-src' src={src} type={type || undefined} />
      <div className='drop-page__grid-item-media-overlay' />
      <div className='drop-page__grid-item-focus'> {focusText}</div>
    </div>
  );
}
