import ArtistDisplay from '@/components/ArtistDisplay';
import { User } from '@/prisma/types';
import Motto from '@/components/Layout/Motto';
import Logotype from '@/components/Logotype';
import dynamic from 'next/dynamic';
const VideoJS = dynamic(() => import('@/components/Media/VideoJS'), { ssr: false });
import ArrowDownSVG from '@/public/interactive/arrow-down.svg';
import React, { useState } from 'react';

interface Props {
  removeCover: () => void;
  coverOn: boolean;
  src: string;
  artist: User;
}

function getPositionY(e: React.TouchEvent<HTMLDivElement>) {
  return e.touches[0].clientY;
}

function Cover(props: Props) {
  const [isDraggingg, setIsDragging] = useState(false);

  if (!props.src) return null;

  const videoJsOptions = {
    autoplay: true,
    controls: false,
    controlslist: 'nodownload',
    loop: true,
    playsinline: true,
    preload: 'metadata',
    muted: true,
    // poster: 'https://d180qjjsfkqvjc.cloudfront.net/trailers/lehel_poster.png',
    sources: [
      {
        src: props.src,
        type: 'video/mp4',
      },
    ],
  };

  return (
    <div
      onTouchStart={(e) => {
        setIsDragging(true);
      }}
      className='home-page__cover'
      data-on={props.coverOn}
      onTouchMove={(e) => {
        if (isDraggingg) {
          const endPos = getPositionY(e);
          const triggerPos = window.innerHeight * 0.5;
          if (endPos > triggerPos) {
            props.removeCover();
          }
        }
      }}
      onTouchEnd={(e) => {
        setIsDragging(false);
      }}
    >
      <div data-on={props.coverOn} className='home-page__cover-logotype-container'>
        <Logotype></Logotype>
      </div>
      <Motto></Motto>
      <VideoJS options={videoJsOptions} onReady={() => {}} />
      <div className='home-page__cover-arrow-container'>
        <ArtistDisplay artist={props.artist}></ArtistDisplay>
        <div onClick={props.removeCover} data-on={props.coverOn} className='home-page__cover-arrow'>
          <ArrowDownSVG
            className='home-page__cover-arrow-svg'
            data-on={props.coverOn}
          ></ArrowDownSVG>
        </div>
      </div>
    </div>
  );
}

export default Cover;
