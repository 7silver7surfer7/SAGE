import MoreInDrop from '@/components/Games/MoreInDrop';
import ArtistTag from '@/components/Games/ArtistTag';
import GameInfo from '@/components/Games/GameInfo';
import NftDisplay from '@/components/Games/NftDisplay';
import NftHeader from '@/components/Games/NftHeader';
import AuctionPanel from '@/components/Games/AuctionPanel';
import prisma from '@/prisma/client';
import { Prisma, User, Drop } from '@prisma/client';
import type { Auction_include_Nft, Lottery_include_Nft } from '@/prisma/types';
import {
  GetStaticPropsContext,
  GetStaticPropsResult,
  GetStaticPathsResult,
  GetStaticPathsContext,
} from 'next';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import {
  useClaimAuctionNftMutation,
  useGetAuctionQuery,
  useGetAuctionStateQuery,
} from '@/store/services/auctionsReducer';
import { useGetUserDisplayInfoQuery } from '@/store/services/user';
import { getBlockchainTimestamp } from '@/utilities/contracts';
import { useSession } from 'next-auth/react';

type Props = {
  drop: Drop;
  auction: Auction_include_Nft;
  auctions: Auction_include_Nft[];
  lotteries: Lottery_include_Nft[];
  drawings: Lottery_include_Nft[];
  artist: User;
};

// src/styles/layout/_game-page.scss
function auction({ auction, auctions, lotteries, artist, drawings, drop }: Props) {
  const [blockchainTimestamp, setBlockchainTimestamp] = useState<number>(0);
  const { data: sessionData } = useSession();
  const walletAddress = sessionData?.address;
  const { auctionId } = useRouter().query;
  // const { data: auction, isFetching } = useGetAuctionQuery(+auctionId!, {
  //   skip: isNaN(+auctionId!),
  // });
  const { data: auctionState } = useGetAuctionStateQuery(+auctionId!, {
    skip: isNaN(+auctionId!),
  });
  const { data: highestBidder } = useGetUserDisplayInfoQuery(auctionState?.highestBidder!, {
    skip: !(
      auctionState?.highestBidder &&
      auctionState?.highestBidder != '0x0000000000000000000000000000000000000000'
    ),
  });
  const [claimAuctionNft] = useClaimAuctionNftMutation();
  useEffect(() => {
    const fetchTimestamp = async () => {
      setBlockchainTimestamp(await getBlockchainTimestamp());
    };
    fetchTimestamp();
  }, []);
  const toTimestamp = (aDate: any) => Date.parse(aDate) / 1000;
  const hasStarted = auction && blockchainTimestamp > toTimestamp(auction.startTime);
  const hasEnded = auction && blockchainTimestamp > auctionState?.endTime!;
  const displayPlaceBidButton = hasStarted && !hasEnded && !auctionState?.settled;
  const displayClaimButton =
    !auction?.winnerAddress &&
    !auction?.claimedAt &&
    hasEnded &&
    auctionState?.highestBidder == walletAddress;

  const handleClaimNftClick = async () => {
    await claimAuctionNft(auction?.id!);
  };
  return (
    <div className='game-page'>
      <div className='game__main'>
        <div>
          <NftDisplay imgSrc={auction.Nft.s3Path} />
        </div>
        <div className='game__content'>
          <ArtistTag artist={artist} />
          <NftHeader
            nftName={auction.Nft.name}
            dropName={drop.name}
            numberOfEditions={auction.Nft.numberOfEditions}
          />
          <AuctionPanel auction={auction} artist={artist} />
          <GameInfo drop={drop} />
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
  const auctionPageQuery = Prisma.validator<Prisma.AuctionArgs>()({
    include: {
      Drop: {
        include: {
          Artist: true,
          Lotteries: { include: { Nfts: true } },
          Auctions: { include: { Nft: true } },
        },
      },
      Nft: true,
    },
  });
  //redirect if invalid auction id
  if (!params || !params.auctionId) {
    return {
      redirect: {
        destination: '/',
        permanent: false,
      },
    };
  }
  const data = await prisma.auction.findUnique({
    where: { id: +params.auctionId },
    include: auctionPageQuery.include,
  });
  if (!data) {
    return {
      redirect: {
        destination: '/',
        permanent: false,
      },
    };
  }
  const otherAuctions = data.Drop.Auctions.filter((a) => a.id !== +params.auctionId!);
  const artist = data.Drop.Artist;
  const drawings = data.Drop.Lotteries.filter((l) => l.Nfts.length === 1);
  const lotteries = data.Drop.Lotteries.filter((l) => l.Nfts.length > 1);
  const drop = data.Drop;
  return {
    props: {
      auction: data,
      auctions: [...otherAuctions],
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
  const approvedAuctions = await prisma.auction.findMany({
    where: {
      Drop: {
        approvedBy: {
          not: null,
        },
      },
    },
  });

  const paths = approvedAuctions.map((a) => {
    return {
      params: { auctionId: String(a.id) },
    };
  });

  return {
    paths,
    fallback: 'blocking',
  };
}

export default auction;
