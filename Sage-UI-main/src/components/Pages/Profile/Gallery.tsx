import { BaseMedia } from '@/components/Media/BaseMedia';
import React, { useState } from 'react';
import ArrowLeftSVG from '@/public/interactive/arrow-left.svg';
import ArrowRightSVG from '@/public/interactive/arrow-right.svg';
import useWindowDimensions from '@/hooks/useWindowSize';
import { Swiper, SwiperSlide, SwiperProps } from 'swiper/react';
import 'swiper/css';
import 'swiper/css/effect-coverflow';
import { EffectCoverflow } from 'swiper';

interface Props {
  nfts: any[];
}

function Gallery({ nfts }: Props) {
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  const firstIndex = selectedIndex;
  const secondIndex = firstIndex + 1;
  const thirdIndex = secondIndex + 1;
  const { windowDimensions } = useWindowDimensions();

  function handleControlLeftClick() {
    if (selectedIndex == 0) return;
    setSelectedIndex((prev) => {
      return prev - 1;
    });
  }

  function handleControlRightClick() {
    if (selectedIndex + 1 >= nfts.length) return;
    setSelectedIndex((prev) => {
      return prev + 1;
    });
  }

  function handleGalleryGridItemClick(i: number) {
    if (i == selectedIndex) return;
    setSelectedIndex(i);
  }

  // const swiperProps: SwiperProps = {ef};

  if (!nfts.length) return null;
  if (!nfts) return null;
  return (
    <>
      <Swiper
        effect={'coverflow'}
        grabCursor={true}
        centeredSlides={true}
        slidesPerView={'auto'}
        coverflowEffect={{
          rotate: 50,
          stretch: 0,
          depth: 100,
          modifier: 1,
          slideShadows: true,
        }}
        zoom={true}
        onActiveIndexChange={({ realIndex }) => setSelectedIndex(realIndex)}
        modules={[EffectCoverflow]}
        className='mySwiper'
      >
        {nfts.map((nft, i) => {
          let size = '1x1';
          if (i == 1) {
            size = '16x9';
          }
          if (i == 2) {
            size = '9x16';
          }

          return (
            <SwiperSlide key={i} data-size={size} className='slide'>
              <BaseMedia src={nft.s3PathOptimized} />
              <div className='collection-panel__tile-nft-info'>
                <p className='collection-panel__tile-nft-name'>{nft.nftName}</p>
                <p className='collection-panel__tile-artist-name'>BY {nft.artistUsername}</p>
              </div>
            </SwiperSlide>
          );
        })}
      </Swiper>
    </>
  );
}

export default Gallery;
