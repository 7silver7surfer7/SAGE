import AuctionTile from '@/components/Tiles/AuctionTile';
import LotteryTile from '@/components/Tiles/LotteryTile';
import type { Auction_include_Nft, Lottery_include_Nft } from '@/prisma/types';
import type { User } from '@prisma/client';
import DrawingTile from '@/components/Tiles/DrawingTile';

type Props = {
  auctions?: Auction_include_Nft[];
  lotteries?: Lottery_include_Nft[];
  drawings?: Lottery_include_Nft[];
  artist: User;
  dropName: string;
};

export default function MoreInDrop({ auctions, lotteries, drawings, artist, dropName }: Props) {
  return (
    <div className='more-in-drop'>
      <h1 className='more-in-drop__header'>More in this drop</h1>
      <div className='more-in-drop__grid'>
        {auctions?.map((auction) => (
          <AuctionTile auction={auction} key={auction.id} artist={artist} />
        ))}
        {lotteries?.map((lottery) => (
          <LotteryTile lottery={lottery} key={lottery.id} artist={artist} dropName={dropName} />
        ))}
        {drawings?.map((drawing) => (
          <DrawingTile drawing={drawing} key={drawing.id} artist={artist} dropName={dropName} />
        ))}
      </div>
    </div>
  );
}
