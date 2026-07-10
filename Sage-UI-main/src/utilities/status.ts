import {
  Lottery as LotteryType,
  Auction as AuctionType,
  OpenEdition as OpenEditionType,
} from '@prisma/client';
import { Lottery_include_Nft, Auction_include_Nft, OpenEdition_include_Nft } from '@/prisma/types';

type Game = Partial<LotteryType> | Partial<AuctionType> | Partial<OpenEditionType>;

type Status = 'Done' | 'Live' | 'Unknown' | 'Upcoming' | 'Settled';

export function computeDropStatus({
  Lotteries,
  Auctions,
  OpenEditions,
}: {
  Lotteries: Lottery_include_Nft[];
  Auctions: Auction_include_Nft[];
  OpenEditions?: OpenEdition_include_Nft[];
}) {
  const now = Date.now();
  let games: Game[] = [...Lotteries, ...Auctions, ...(OpenEditions || [])];
  let startTime: number;
  let endTime: number;
  let status: Status = 'Unknown';
  if (games.length === 0) {
    return { startTime: 0, endTime: 0, status };
  }
  games.sort((a: any, b: any) => +a.startTime - +b.startTime);
  startTime = +games[0].startTime;
  games.sort((a: any, b: any) => +b.endTime + a.endTime);
  endTime = +games[0].endTime!;
  //TODO: status countdown
  if (new Date(startTime).getHours() - now < 92) {
    status = 'Upcoming';
  }
  if (startTime < now) {
    status = 'Live';
    let openAuction = false;
    for (const a of Auctions) {
      if (!a.winnerAddress) {
        openAuction = true;
        break;
      }
    }
    if (!openAuction && endTime < now) {
      status = 'Done';
    }
  }
  return { startTime, endTime, status };
}

export interface ComputeAuctionStatusArgs {
  endTime: number | Date;
  startTime: number | Date;
  settled: boolean;
}
export function computeAuctionStatus({
  startTime,
  endTime,
  settled,
}: ComputeAuctionStatusArgs): Status {
  let end = +endTime;
  let start = +startTime;
  if (start > Date.now()) {
    return 'Upcoming';
  }
  if (settled) {
    return 'Settled';
  }
  if (end < Date.now()) {
    return 'Done';
  }

  if (start < Date.now()) {
    return 'Live';
  }
  return 'Unknown';
}

export interface ComputeLotteryStatusArgs {
  endTime: number | Date;
  startTime: number | Date;
}

type LotteryStatus = 'upcoming' | 'live' | 'drawn' | 'unknown';

export function computeLotteryStatus({
  startTime,
  endTime,
}: ComputeLotteryStatusArgs): LotteryStatus {
  let lotteryStatus: LotteryStatus = 'unknown';

  if (startTime > Date.now()) {
    lotteryStatus = 'upcoming';
  }

  if (startTime < Date.now() && endTime > Date.now()) {
    lotteryStatus = 'live';
  }

  if (endTime < Date.now()) {
    lotteryStatus = 'drawn';
  }

  return lotteryStatus;
}
