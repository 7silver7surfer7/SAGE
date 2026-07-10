import { useEffect, useState } from 'react';
import prisma from '@/prisma/client';
import { Prisma } from '@prisma/client';
import { useRouter } from 'next/router';
import {
  TicketPriceTier,
  useGetLotteryQuery,
  useGetTicketCountsQuery,
} from '@/store/services/lotteriesReducer';
import GetTicketModal from '@/components/Modals/Games/GetTicketModal';
import { useSession } from 'next-auth/react';
import {
  ClaimPrizeRequest,
  useClaimLotteryPrizeMutation,
  useGetPrizesByUserAndLotteryQuery,
} from '@/store/services/prizesReducer';
import { useGetPointsBalanceQuery, useGetEscrowPointsQuery } from '@/store/services/pointsReducer';
import useModal from '@/hooks/useModal';
import { getBlockchainTimestamp, getCoinBalance } from '@/utilities/contracts';
import { Drop, Lottery_include_Nft, Auction_include_Nft, User } from '@/prisma/types';
import {
  GetStaticPropsContext,
  GetStaticPropsResult,
  GetStaticPathsResult,
  GetStaticPathsContext,
} from 'next';
import NftDisplay from '@/components/Games/NftDisplay';
import ArtistTag from '@/components/Games/ArtistTag';
import NftHeader from '@/components/Games/NftHeader';
import GameInfo from '@/components/Games/GameInfo';
import MoreInDrop from '@/components/Games/MoreInDrop';
import TicketPanel from '@/components/Games/TicketPanel';
import LotterySlider from '@/components/Games/LotterySlider';

type Props = {
  drop: Drop;
  lottery: Lottery_include_Nft;
  auctions: Auction_include_Nft[];
  lotteries: Lottery_include_Nft[];
  drawings: Lottery_include_Nft[];
  artist: User;
};

function lottery({ drop, lottery, auctions, lotteries, drawings, artist }: Props) {
  const [selectedNftIndex, setSelectedNftIndex] = useState<number>(0);
  const [blockchainTimestamp, setBlockchainTimestamp] = useState<number>(0);
  const [userBalanceCoins, setUserBalanceCoins] = useState<string>('');
  const { data: sessionData } = useSession();
  const walletAddress = sessionData?.address;
  const { lotteryId } = useRouter().query;
  // const { data: lottery, isFetching } = useGetLotteryQuery(+lotteryId!, {
  //   skip: isNaN(+lotteryId!),
  // });
  const { data: ticketCount } = useGetTicketCountsQuery(
    { lotteryId: +lotteryId!, walletAddress: walletAddress as string },
    { skip: isNaN(+lotteryId!) }
  );
  const { data: prizes } = useGetPrizesByUserAndLotteryQuery(
    { lotteryId: +lotteryId!, walletAddress: walletAddress as string },
    { skip: isNaN(+lotteryId!) || !walletAddress }
  );
  const [claimLotteryPrize] = useClaimLotteryPrizeMutation();
  const { data: userPoints } = useGetPointsBalanceQuery(undefined, { skip: !walletAddress });
  const { data: escrowPoints } = useGetEscrowPointsQuery(undefined, { skip: !walletAddress });
  const userBalancePoints = userPoints! - escrowPoints!;
  const userTier = TicketPriceTier.Member; // TODO calculate user tier based on tbd criteria
  useEffect(() => {
    const fetchTimestamp = async () => {
      setBlockchainTimestamp(await getBlockchainTimestamp());
      setUserBalanceCoins((await getCoinBalance()).toString());
    };
    fetchTimestamp();
  }, []);
  const toTimestamp = (aDate: any) => Date.parse(aDate) / 1000;
  const hasStarted = lottery && blockchainTimestamp > toTimestamp(lottery.startTime);
  const hasEnded = lottery && blockchainTimestamp > toTimestamp(lottery.endTime);
  const displayBuyTicketButton = hasStarted && !hasEnded;

  const handleClaimLotteryPrizeClick = async (index: number) => {
    await claimLotteryPrize({
      lotteryId: prizes![index].lotteryId,
      nftId: prizes![index].nftId,
      ticketNumber: prizes![index].lotteryTicketNumber,
      proof: prizes![index].lotteryProof,
      walletAddress,
    } as ClaimPrizeRequest);
  };

  const currentNft = lottery.Nfts[selectedNftIndex];

  return (
    <div className='game-page'>
      <div className='game__main'>
        <div>
          <NftDisplay imgSrc={currentNft.s3Path} />
        </div>
        <div className='game__content'>
          <ArtistTag artist={artist} />
          <NftHeader
            nftName={currentNft.name}
            dropName={drop.name}
            numberOfEditions={currentNft.numberOfEditions}
          />
          <TicketPanel
            lottery={lottery}
            artist={artist}
            dropName={drop.name}
            selectedNftIndex={selectedNftIndex}
          />
          <GameInfo drop={drop} />
          {lottery.Nfts.length > 1 && (
            <LotterySlider
              nfts={lottery.Nfts}
              selectedNftIndex={selectedNftIndex}
              setSelectedNftIndex={setSelectedNftIndex}
            />
          )}
        </div>
      </div>
      <MoreInDrop
        auctions={auctions}
        lotteries={lotteries}
        drawings={drawings}
        artist={artist}
        dropName={drop.name}
      />
    </div>
  );
}

export async function getStaticProps({
  params,
}: GetStaticPropsContext): Promise<GetStaticPropsResult<Props>> {
  //prisma query options
  const lotteryPageQuery = Prisma.validator<Prisma.LotteryArgs>()({
    include: {
      Drop: {
        include: {
          Artist: true,
          Lotteries: { include: { Nfts: true } },
          Auctions: { include: { Nft: true } },
        },
      },
      Nfts: true,
    },
  });
  //redirect if invalid auction id
  if (!params || !params.lotteryId) {
    return {
      redirect: {
        destination: '/',
        permanent: false,
      },
    };
  }
  const data = await prisma.lottery.findUnique({
    where: { id: +params.lotteryId },
    include: lotteryPageQuery.include,
  });
  if (!data) {
    return {
      redirect: {
        destination: '/',
        permanent: false,
      },
    };
  }
  //TODO: handle drawings vs lotteries
  const otherLotteries = data.Drop.Lotteries.filter((l) => l.id !== +params.lotteryId!);

  const artist = data.Drop.Artist;
  const drawings = otherLotteries.filter((l) => l.Nfts.length === 1);
  const lotteries = otherLotteries.filter((l) => l.Nfts.length > 1);
  const auctions = data.Drop.Auctions;
  const drop = data.Drop;
  return {
    props: {
      lottery: data,
      auctions,
      lotteries,
      drawings,
      artist,
      drop,
    },
  };
}

export async function getStaticPaths(
  _context: GetStaticPathsContext
): Promise<GetStaticPathsResult> {
  const approvedLotteries = await prisma.lottery.findMany({
    where: {
      Drop: {
        approvedBy: {
          not: null,
        },
      },
    },
  });

  const paths = approvedLotteries.map((l) => {
    return {
      params: { lotteryId: String(l.id) },
    };
  });

  return {
    paths,
    fallback: 'blocking',
  };
}

export default lottery;
