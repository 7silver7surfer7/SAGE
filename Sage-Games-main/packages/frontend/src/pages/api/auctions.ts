import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/prisma/client';
import { getSession } from 'next-auth/react';
import { getUnclaimedAuctionWinner } from '@/utilities/contracts';
import { Auction_include_Nft, GamePrize, User, Drop } from '@/prisma/types';

interface FlattenArgs {
  auction: Auction_include_Nft;
  artist: User;
  drop: Drop;
}

function flatten({ auction, drop, artist }: FlattenArgs): GamePrize {
  return {
    nftId: auction.Nft.id,
    dropId: drop.id,
    nftName: auction.Nft.name,
    artistUsername: artist.username!,
    artistDisplayName: artist.displayName!,
    artistProfilePicture: artist.profilePicture!,
    s3Path: auction.Nft.s3Path,
    isVideo: auction.Nft.isVideo,
    claimedAt: auction.claimedAt || undefined,
  };
}

async function handler(request: NextApiRequest, response: NextApiResponse) {
  const {
    query: { action },
  } = request;
  const session = await getSession({ req: request });
  const { address: walletAddress } = session!;
  switch (action) {
    case 'GetAuction':
      await getAuction(Number(request.query.auctionId), response);
      break;
    case 'GetUnclaimedAuctionNftsPerUser':
      await getUnclaimedAuctionNftsPerUser(walletAddress as string, response);
      break;
    case 'UpdateNftClaimedDate':
      await updateNftClaimedDate(
        walletAddress as string,
        Number(request.query.auctionId),
        request,
        response
      );
      break;
    default:
      response.status(500);
  }
  response.end();
}

async function getAuction(auctionId: number, response: NextApiResponse) {
  console.log(`getAuction(${auctionId})`);
  if (isNaN(auctionId)) {
    response.status(500);
  } else {
    try {
      const auction = await prisma.auction.findFirst({
        where: { id: auctionId },
        include: {
          Nft: true,
          Drop: {
            include: {
              Artist: {
                select: {
                  username: true,
                  displayName: true,
                  profilePicture: true,
                },
              },
            },
          },
        },
      });
      response.json(auction);
    } catch (e) {
      console.log({ e });
      response.status(500);
    }
  }
  response.end();
}

async function getUnclaimedAuctionNftsPerUser(walletAddress: string, response: NextApiResponse) {
  if (!walletAddress) {
    response.status(401).end('Not Authenticated');
  } else {
    try {
      const unclaimedAuctions = await prisma.auction.findMany({
        where: {
          winnerAddress: walletAddress,
          settled: false,
        },
        include: {
          Nft: true,
          Drop: {
            include: {
              Artist: true,
            },
          },
        },
      });
      const unclaimedNfts = Array<GamePrize>();
      unclaimedAuctions.forEach((a) =>
        unclaimedNfts.push(flatten({ auction: a, drop: a.Drop, artist: a.Drop.Artist }))
      );
      console.log(`getUnclaimedAuctionNftsPerUser(${walletAddress}) :: ${unclaimedNfts.length}`);
      response.json(unclaimedNfts);
    } catch (e) {
      console.log(e);
      response.status(500);
    }
  }
  response.end();
}

async function updateNftClaimedDate(
  walletAddress: string,
  auctionId: number,
  request: NextApiRequest,
  response: NextApiResponse
) {
  console.log(`updateNftClaimedDate(${auctionId})`);
  if (isNaN(auctionId)) {
    response.status(500);
  } else {
    if (!walletAddress) {
      response.status(401).end('Not Authenticated');
      return;
    }
    try {
      const auctionWinner = await getUnclaimedAuctionWinner(auctionId);
      let now = new Date();
      await prisma.auction.updateMany({
        where: {
          id: auctionId,
          claimedAt: null,
          settled: false,
        },
        data: {
          winnerAddress: auctionWinner,
          claimedAt: now,
          settled: true,
        },
      });
      response.status(200).json({ claimedAt: now });
    } catch (e) {
      console.log({ e });
      response.status(500);
    }
  }
  response.end();
}

export default handler;
