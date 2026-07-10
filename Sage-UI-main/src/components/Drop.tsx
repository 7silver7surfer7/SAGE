import shortenAddress from '@/utilities/shortenAddress';
import Link from 'next/link';
import { Drop_include_GamesAndArtist } from '@/prisma/types';
import { BaseMedia, PfpImage } from './Media/BaseMedia';
import Countdown from '@/components/Countdown';
import { computeDropStatus } from '@/utilities/status';

interface Props {
  drop: Drop_include_GamesAndArtist;
}

const MAX_ARTWORK_THUMBS = 4;

/** Unique artwork images across the drop's auctions, lotteries and open editions. */
function collectArtworks(drop: Drop_include_GamesAndArtist): { src: string; name: string }[] {
  const artworks: { src: string; name: string }[] = [];
  const seen = new Set<string>();
  const push = (nft: { s3PathOptimized: string; name: string } | null | undefined) => {
    if (!nft || seen.has(nft.s3PathOptimized)) return;
    seen.add(nft.s3PathOptimized);
    artworks.push({ src: nft.s3PathOptimized, name: nft.name });
  };
  drop.Auctions.forEach((a) => push(a.Nft));
  drop.Lotteries.forEach((l) => l.Nfts.forEach(push));
  (drop.OpenEditions || []).forEach((oe) => push(oe.Nft));
  return artworks;
}

export default function Drop({ drop }: Props) {
  const { status, startTime, endTime } = computeDropStatus(drop);
  const artworks = collectArtworks(drop);
  return (
    <div className='drop' data-cy={`drop-tile`}>
      <Link href={`drops/${drop.id}`}>
        <div className='drop__thumbnail'>
          <BaseMedia src={drop.bannerImageS3Path || '/'}  />
        </div>
      </Link>
      {artworks.length > 0 && (
        <Link href={`drops/${drop.id}`}>
          <div className='drop__artworks'>
            {artworks.slice(0, MAX_ARTWORK_THUMBS).map(({ src, name }) => (
              <div key={src} className='drop__artworks-thumb' title={name}>
                <BaseMedia src={src} />
              </div>
            ))}
            {artworks.length > MAX_ARTWORK_THUMBS && (
              <div className='drop__artworks-more'>+{artworks.length - MAX_ARTWORK_THUMBS}</div>
            )}
          </div>
        </Link>
      )}

      <div className='details'>
        <div className='artist'>
          <div className='artist-pfp'>
            <PfpImage src={drop.NftContract.Artist.profilePicture || undefined} />
          </div>
          <h1 className='artist-name'>
            {drop.NftContract.Artist.username || shortenAddress(drop.NftContract.artistAddress)}
          </h1>
        </div>
        <div className='drop__status' data-status='drawn'>
          {status === 'Done' && <h1>DRAWN – {new Date(endTime).toLocaleDateString()}</h1>}
          {status === 'Live' && (
            <Countdown className='status__countdown' endTime={endTime} data-color='purple' />
          )}
          {status === 'Upcoming' && <Countdown className='status__countdown' endTime={startTime} />}
          {/*status === 'Upcoming' && startTime - Date.now() < 860000 && (
            <h1>SOON™ – {new Date(startTime).toLocaleDateString()}</h1>
          )*/}
        </div>
      </div>
    </div>
  );
}
