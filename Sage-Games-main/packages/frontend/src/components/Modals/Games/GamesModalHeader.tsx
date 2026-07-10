import React from 'react';
import { User } from '@/prisma/types';
import { PfpImage, BaseImage } from '@/components/Image';
import Image from 'next/image';

interface Props {
  imgSrc: string;
  artist: User;
	nftEditions: number;
	nftName: string;
}

//@scss : '@/styles/components/_games-modal.scss'
export default function GamesModalHeader({ imgSrc, artist, nftEditions, nftName }: Props) {
  return (
    <div className='games-modal__header'>
      <div className='games-modal__header-nft-img'>
        <BaseImage src={imgSrc} />
      </div>
      <div className='games-modal__header-right'>
        <div className='games-modal__header-artist'>
          <div className='games-modal__header-artist-pfp'>
            <Image src='/sample/pfp.svg' layout='fill' />
          </div>
          <div className='games-modal__header-artist-name'>
            {artist.displayName || 'displayname'}
          </div>
        </div>
				<div className="games-modal__header-nft-name">{nftName}</div>
				<div className="games-modal__header-nft-editions">{nftEditions} editions</div>
      </div>
    </div>
  );
}
