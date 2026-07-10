import { Nft } from '@/prisma/types';
import React, { Dispatch, SetStateAction,  useLayoutEffect } from 'react';
import { BaseMedia } from '@/components/Media/BaseMedia';
import Image from 'next/image';

interface Props {
  nfts: Nft[];
  selectedNftIndex: number;
  setSelectedNftIndex: Dispatch<SetStateAction<number>>;
}

function unique(array: any[], propertyName: string) {
  return array.filter((e, i) => array.findIndex((a) => a[propertyName] === e[propertyName]) === i);
}

// src/styles/components/_lottery-slider.scss
export default function LotterySlider({ nfts, selectedNftIndex, setSelectedNftIndex }: Props) {
  const uniqueImages = unique(nfts, 's3Path');

  const refs = uniqueImages.reduce((acc, value) => {
    acc[value.id] = React.createRef();
    return acc;
  }, {});

  const handleRightArrowClick = () => {
    if (selectedNftIndex + 1 >= uniqueImages.length) return;
    setSelectedNftIndex((prev) => prev + 1);
  };

  const handleLeftArrowClick = () => {
    if (selectedNftIndex - 1 < 0) return;
    setSelectedNftIndex((prev) => prev - 1);
  };

  useLayoutEffect(() => {
    const nftId = uniqueImages[selectedNftIndex].id;
    refs[nftId].current.scrollIntoView({ behavior: 'smooth', alignToTop: false });
  }, [handleRightArrowClick, handleLeftArrowClick]);

  return (
    <div className='lottery-slider'>
      {uniqueImages.map((nft: Nft, i: number) => {
        return (
          <div
            className='lottery-slider__slider-item'
            key={nft.id}
            ref={refs[nft.id]}
            data-selected={selectedNftIndex === i}
          >
            NFT{nft.id}
            <BaseMedia src={nft.s3PathOptimized}  />
          </div>
        );
      })}
      <div onClick={handleLeftArrowClick} className='lottery-slider__left'>
        <Image src='/interactive/arrow-left.svg' width={30} height={30}></Image>
      </div>
      <div onClick={handleRightArrowClick} className='lottery-slider__right'>
        <Image src='/interactive/arrow-right.svg' width={30} height={30}></Image>
      </div>
    </div>
  );
}
