import React from 'react';
import Image from 'next/image';
import Link from 'next/link';

interface Props {
  imgSrc: string;
  children?: JSX.Element;
  name: string;
  subtitle: string;
  button?: React.ReactElement;
  buttonText?: string;
  buttonAction?: () => any;
  imgLink: string;
}
function NftTile({
  imgSrc,
  name,
  subtitle,
  buttonText,
  buttonAction,
  button,
  imgLink,
  children,
}: Props) {
  return (
    <div className='nft-tile'>
      <div className='image'>
        <Link href={imgLink}>
          <Image src={imgSrc} layout='fill' objectFit='cover' />
        </Link>
      </div>
      <div className='interact'>
        <div className='interact__info'>
          <h1 className='interact__name'>{name}</h1>
          <h1 className='interact__subtitle'>{subtitle}</h1>
        </div>
        {button}
      </div>
      {children}
    </div>
  );
}

export default NftTile;
