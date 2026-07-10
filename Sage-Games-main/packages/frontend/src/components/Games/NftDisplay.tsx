import Image from 'next/image';

interface Props {
  imgSrc: string;
}

export default function NftDisplay({ imgSrc }: Props) {
  return (
    <div className='game__nft-display'>
      <Image src={imgSrc} layout='fill' objectFit='cover' />
    </div>
  );
}
