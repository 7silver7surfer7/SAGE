import Image from 'next/image';
import type { User } from '@prisma/client';
import { useRouter } from 'next/router';
import { basePathArtists } from '@/constants/paths';

interface Props {
  artist: User;
}

export default function ArtistTag({ artist }: Props) {
  const router = useRouter();
  return (
    <div
      className='artist-tag'
      onClick={() => router.push(`${basePathArtists}/${artist.walletAddress}`)}
    >
      <div className='artist-tag__pfp'>
        <Image src={artist.profilePicture || '/sample/pfp.svg'} layout='fill' objectFit='cover' />
      </div>
      <div className='artist-tag__handles'>
        <div className='artist-tag__name'>{artist.displayName}</div>
        <div className='artist-tag__username'>@{artist.username}</div>
      </div>
    </div>
  );
}
