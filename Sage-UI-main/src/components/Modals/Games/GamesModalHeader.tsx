import React from 'react';
import { User } from '@/prisma/types';
import { PfpImage, BaseMedia } from '@/components/Media/BaseMedia';
interface Props {
  src: string;
  isVideo: boolean;
  artist: User;
  nftEditions: number;
  nftName: string;
}

//@scss : '@/styles/components/_games-modal.scss'
export default function GamesModalHeader({ src, isVideo, artist, nftEditions, nftName }: Props) {
  return (
    <div className='games-modal__header'>
      <div className='games-modal__header-nft-img'>
        <BaseMedia src={src}  />
      </div>
      <div className='games-modal__header-right'>
        <div className='games-modal__header-artist'>
          <div className='games-modal__header-artist-pfp'>
            <PfpImage src={artist.profilePicture} />
          </div>
          <div className='games-modal__header-artist-name'>
            {artist.username || 'username'}
          </div>
        </div>
        <div className='games-modal__header-nft-name'>{nftName}</div>
        <div className='games-modal__header-nft-editions'>{nftEditions} editions</div>
      </div>
    </div>
  );
}
