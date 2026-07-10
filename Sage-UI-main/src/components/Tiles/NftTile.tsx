import React from 'react';
import { BaseMedia } from '../Media/BaseMedia';
import { useRouter } from 'next/router';

interface Props {
  src: string;
  children?: React.ReactNode;
  name: string;
  subtitle: string;
  button?: React.ReactElement;
  buttonText?: string;
  buttonAction?: () => any;
  tileLink: string;
}

function NftTile({ src, name, subtitle, button, tileLink, children }: Props) {
  const router = useRouter();
  function handleNftTileClick() {
    router.push(tileLink);
  }
  return (
    <div className='nft-tile'>
      <div className='nft-tile__media-container' onClick={handleNftTileClick}>
        <BaseMedia src={src} />
      </div>
      <div className='nft-tile__interact'>
        <div className='nft-tile__interact-container'>
          <div className='nft-tile__interact-info'>
            <h1 className='nft-tile__interact-name'>{name}</h1>
            <h1 className='nft-tile__interact-subtitle'>{subtitle}</h1>
          </div>
          {button}
        </div>
        {children}
      </div>
    </div>
  );
}

export default NftTile;
