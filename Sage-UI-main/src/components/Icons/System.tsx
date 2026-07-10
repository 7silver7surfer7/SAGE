import { Lottery, Auction } from '@prisma/client';
import LotterySVG from '@/public/icons/systems/lotteries.svg';
import AuctionSVG from '@/public/icons/systems/auctions.svg';
// import DrawingSVG from '@/public/icons/systems/drawings.svg';

export type SystemTypes = 'drawing' | 'auction' | 'lottery' | 'listing';

type Games = {
  lottery?: Lottery[];
  drawing?: Lottery[];
  auction?: Auction[];
};

export function computeDropSystems(games: Games): SystemTypes[] {
  const systems: SystemTypes[] = [];
  const keys = Object.keys(games);
  keys.forEach((key: string) => {
    const value = games[key];
    if (value.length) {
      systems.push(key as SystemTypes);
    }
  });
  return systems;
}

interface Props {
  type: SystemTypes;
}

export default function System({ type }: Props) {
  if (type === 'lottery') {
    return <LotterySVG className='systems__svg' />;
  }
  if (type === 'auction') {
    return <AuctionSVG className='systems__svg' />;
  }
  if (type === 'drawing') {
    return <LotterySVG className='systems__svg' />;
    // return <DrawingSVG className='systems__svg' />;
  }

  return null;
}
