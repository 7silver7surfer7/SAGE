import { BaseMedia } from '@/components/Media/BaseMedia';

interface Props {
  imgSrc: string;
  bannerOnClick?: () => void;
}

export default function Hero({ imgSrc, bannerOnClick }: Props) {
  return (
    <div className='hero'>
      <BaseMedia priority muted={false} onClickHandler={bannerOnClick} src={imgSrc}></BaseMedia>
    </div>
  );
}
