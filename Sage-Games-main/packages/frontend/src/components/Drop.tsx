import { Lottery as LotteryType, Auction as AuctionType } from '@prisma/client';
import Image from 'next/image';
import shortenAddress from '@/utilities/shortenAddress';
import Link from 'next/link';
import { Drop_include_GamesAndArtist } from '@/prisma/types';
import { BaseImage, PfpImage } from './Image';
import Countdown from '@/components/Countdown';

interface Props {
  drop: Drop_include_GamesAndArtist;
}

type Game = Partial<LotteryType> | Partial<AuctionType>;

function computeStatus({ Lotteries, Auctions }: Drop_include_GamesAndArtist) {
  let games: Game[];
  let startTime: number;
  let endTime: number;
  let status: 'upcoming' | 'active' | 'drawn' | 'countdown';

  games = [...Lotteries!, ...Auctions!];

  games.sort((a: any, b: any) => +a.startTime - +b.startTime);
  startTime = +games[0].startTime!;

  games.sort((a: any, b: any) => +b.endTime + a.endTime);
  endTime = +games[0].endTime!;

  status = 'upcoming';
  //TODO: status countdown
  if (new Date(startTime).getHours() - Date.now() < 92) {
    status = 'countdown';
  }
  if (startTime < Date.now()) {
    status = 'active';
    if (endTime < Date.now()) {
      status = 'drawn';
      //TODO: check if user has a claimable in this drop
    }
  }

  //TODO: this function should return react nodes with unique styling
  return { startTime, endTime, status };
}

export default function Drop({ drop }: Props) {
  const { status, startTime, endTime } = computeStatus(drop);
  return (
    <div className='drop'>
      <Link href={`drops/${drop.id}`}>
        <div className='drop__thumbnail'>
          <BaseImage src={drop.bannerImageS3Path || '/'} />
        </div>
      </Link>
      <div className='details'>
        <div className='artist'>
          <div className='artist-pfp'>
            <PfpImage src={drop.Artist.profilePicture || undefined} />
          </div>
          <h1 className='artist-name'>
            {drop.Artist.username || shortenAddress(drop.artistAddress)}
          </h1>
        </div>
        <div className='drop__status' data-status='drawn'>
          {status === 'drawn' && <h1>DRAWN – {new Date(endTime).toLocaleDateString()}</h1>}
          {status === 'active' && <Countdown endTime={endTime} data-color='purple' />}
          {status === 'countdown' && <Countdown endTime={startTime} />}
          {status === 'upcoming' && <h1>SOON™ – {new Date(startTime).toLocaleDateString()}</h1>}
        </div>
      </div>
    </div>
  );
}
