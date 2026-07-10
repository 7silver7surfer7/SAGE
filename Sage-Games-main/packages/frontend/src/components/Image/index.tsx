import Image from 'next/image';

interface BaseImageProps {
  src: string;
}

function BaseImage({ src }) {
  return <Image src={src} layout='fill' objectFit='cover' />;
}

function PfpImage({ src }: Partial<BaseImageProps>) {
  return <BaseImage src={src || '/sample/pfp.svg'} />;
}

export { BaseImage, PfpImage };
