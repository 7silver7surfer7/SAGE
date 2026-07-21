import { useGetWinnersQuery } from '@/store/lotteriesReducer';
import { transformTitle } from '@/utilities/strings';
import { Lottery, Nft } from '@prisma/client';
import { useMemo } from 'react';

// Only what this hook actually reads — callers pass the trimmed
// NftDisplaySelect shape (see prisma/types/index.d.ts), not a full Nft.
type LotteryNft = Pick<
  Nft,
  's3Path' | 's3PathOptimized' | 'mediaType' | 'numberOfEditions' | 'name'
>;

interface UseLotteryArgs {
  lottery: Lottery;
  nfts: LotteryNft[];
  selectedIndex?: number;
}

const freeGameInfo =
  'This drawing is free to enter. Once the entry period is closed, winners will be chosen by our on-chain random number generator and given the ability to mint the NFT.';
const pixelOnlyGameInfo =
  "Users can buy tickets for this drop using only Pixel points, which are a SAGE reward for those holding the SAGE token in their wallets. Once the entry period is closed, the drawing takes place and the winners, who will be able to mint this collectible, are selected using SAGE's verifiable on-chain randomness.";

export default function useLottery({ lottery, nfts, selectedIndex }: UseLotteryArgs) {
  const now = new Date();
  const selectedNft = nfts[selectedIndex || 0];
  const isStarted = new Date(lottery.startTime) < now;
  const isEnded = new Date(lottery.endTime) < now;
  const isLive = isStarted && !isEnded;
  const startTime = lottery.startTime.getTime();
  const endTime = lottery.endTime.getTime();
  const mediaSrc = selectedNft.s3Path;
  const optimizedMediaSrc = selectedNft.s3PathOptimized;
  const selectedNftMediaType = selectedNft.mediaType;
  const hasMaxTicketsPerUser: boolean = lottery.maxTicketsPerUser > 0;
  const selectedNftEditionsCount: number = selectedNft.numberOfEditions;
  const selectedNftName: string = transformTitle(selectedNft.name);
  const selectedNftEditionsText: string = selectedNftEditionsCount > 1 ? 'editions' : 'edition';

  const selectedNftS3Path: string = selectedNft.s3Path;
  let duration = Number(lottery.endTime) - Number(lottery.startTime);
  duration = duration / 1000;
  duration = duration / 60 / 60;
  const { data: lotteryWinners } = useGetWinnersQuery(lottery.id, { skip: !isEnded });
  const durationDisplay = `${duration.toFixed(2)} hour${duration > 1 ? 's' : ''}`;
  const requiresASH: boolean = !!lottery.costPerTicketTokens;
  const requiresPoints: boolean = !!lottery.costPerTicketPoints;

  const gameInfo = useMemo(() => {
    if (Boolean(requiresPoints && !requiresASH)) {
      return pixelOnlyGameInfo;
    }
    if (Boolean(!requiresASH && !requiresPoints)) {
      return freeGameInfo;
    }
    return `Users can enter a live drawing for ${durationDisplay}. At entry, users will be asked to pay the sales price. Once the entry period is closed, the drawing takes place and SAGE selects the game winner through our on-chain random number generator. Users that don't win will receive their refund automatically when gas is at 10 GWEI or below.`;
  }, []);

  return {
    isLive,
    isStarted,
    isEnded,
    startTime,
    selectedNftS3Path,
    endTime,
    mediaSrc,
    optimizedMediaSrc,
    selectedNftMediaType,
    selectedNftName,
    selectedNftEditionsText,
    lotteryWinners,
    costASH: lottery.costPerTicketTokens,
    hasMaxTicketsPerUser,
    selectedNftEditionsCount,
    duration,
    durationDisplay,
    gameInfo,
    requiresASH,
    requiresPoints,
  };
}
