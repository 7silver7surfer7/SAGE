import {
  Lottery as LotteryType,
  Auction as AuctionType,
  OpenEdition as OpenEditionType,
} from '@prisma/client';
import { Lottery_include_Nft, Auction_include_Nft, OpenEdition_include_Nft } from '@/prisma/types';

type Game = Partial<LotteryType> | Partial<AuctionType> | Partial<OpenEditionType>;

type Status = 'Done' | 'Live' | 'Unknown' | 'Upcoming' | 'Settled';

/** Minimal shape of a CollectionMint row this fn needs (endTime null = no deadline). */
interface CollectionMintLike {
  startTime: Date | string | number;
  endTime?: Date | string | number | null;
  maxSupply: number;
  mintCount: number;
}

/**
 * Returned endTime of 0 with status 'Live' means "no deadline" — a collection
 * that stays open until it sells out. Renderers should show a plain LIVE
 * label instead of a countdown for that case.
 */
export function computeDropStatus({
  Lotteries,
  Auctions,
  OpenEditions,
  CollectionMints,
}: {
  Lotteries: Lottery_include_Nft[];
  Auctions: Auction_include_Nft[];
  OpenEditions?: OpenEdition_include_Nft[];
  CollectionMints?: CollectionMintLike[];
}) {
  const now = Date.now();
  const games: { start: number; end: number }[] = [
    ...Lotteries,
    ...Auctions,
    ...(OpenEditions || []),
  ].map((g: Game) => ({ start: +g.startTime!, end: +(g as any).endTime! }));
  // Collection drops previously weren't counted at all, so a pure collection
  // drop (e.g. the first mainnet drop "rMonet") showed UNKNOWN forever. A
  // collection with no endTime runs until sold out: model that as an
  // infinite end while supply remains, and as already-ended once sold out —
  // selling out ends a collection even before its deadline.
  let anySoldOut = false;
  for (const cm of CollectionMints || []) {
    const soldOut = cm.maxSupply > 0 && cm.mintCount >= cm.maxSupply;
    anySoldOut = anySoldOut || soldOut;
    games.push({
      start: +new Date(cm.startTime as any),
      end: soldOut ? now - 1 : cm.endTime ? +new Date(cm.endTime as any) : Infinity,
    });
  }

  let status: Status = 'Unknown';
  if (games.length === 0) {
    return { startTime: 0, endTime: 0, status, soldOut: false };
  }
  const startTime = Math.min(...games.map((g) => g.start));
  const maxEnd = Math.max(...games.map((g) => g.end));
  // endTime 0 = "live with no deadline" (see doc comment)
  const endTime = Number.isFinite(maxEnd) ? maxEnd : 0;

  if (startTime > now) {
    status = 'Upcoming';
  } else {
    status = 'Live';
    const openAuction = Auctions.some((a) => !a.winnerAddress);
    const allEnded = games.every((g) => g.end < now);
    if (!openAuction && allEnded) {
      status = 'Done';
    }
  }
  // soldOut only matters once the WHOLE drop is over — a sold-out collection
  // alongside a still-open auction reads as Live, not SOLD OUT
  return { startTime, endTime, status, soldOut: anySoldOut && status === 'Done' };
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
