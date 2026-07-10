import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/prisma/client';
import { getRequester } from '@/utilities/apiAuth';
import { getUnclaimedAuctionWinner } from '@/utilities/contracts';
import { Auction_include_Nft, GamePrize, User, Drop } from '@/prisma/types';

interface FlattenArgs {
  auction: Auction_include_Nft;
  artist: User;
  drop: Drop;
}

async function handler(request: NextApiRequest, response: NextApiResponse) {
  const {
    query: { action },
  } = request;
  // getRequester decodes the session JWT directly — reliable under
  // trailingSlash:true, unlike getSession's internal self-fetch. Reads that
  // don't need a caller (GetAuction etc.) still work when this is undefined.
  const requester = await getRequester(request);
  const walletAddress = requester?.walletAddress;
  switch (action) {
    case 'GetAuction':
      await getAuction(Number(request.query.auctionId), response);
      break;
    case 'GetBidHistory':
      await getBidHistory(Number(request.query.auctionId), response);
      break;
    case 'GetNftByAuctionAndWinner':
      const { auctionId, winner } = request.query;
      await getNftByAuctionAndWinner(Number(auctionId), String(winner), response);
      break;
    case 'GetClaimedAuctionNfts':
      await getClaimedAuctionNfts(walletAddress as string, response);
      break;
    case 'GetUnclaimedAuctionNfts':
      await getUnclaimedAuctionNfts(walletAddress as string, response);
      break;
    case 'SaveBid':
      const { id, amt, ts } = request.query;
      await saveBid(String(walletAddress), Number(id), Number(amt), Number(ts), response);
      break;
    case 'UpdateNftClaimedDate':
      await updateNftClaimedDate(String(walletAddress), Number(request.query.auctionId), response);
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
    return;
  }
  try {
    const auction = await prisma.auction.findFirst({
      where: { id: auctionId },
      include: {
        Nft: true,
        Drop: {
          include: {
            NftContract: {
              include: {
                Artist: { select: { username: true, profilePicture: true } },
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

async function getBidHistory(auctionId: number, response: NextApiResponse) {
  console.log(`getBidHistory(${auctionId})`);
  if (isNaN(auctionId)) {
    response.status(500);
  } else {
    const bids = [];
    const result = await prisma.bidHistory.findMany({
      where: { auctionId },
      include: { Bidder: true },
      orderBy: [{ blockTimestamp: 'desc' }],
    });
    for (const row of result) {
      bids.push({
        amount: row.amount,
        bidderAddress: row.bidderAddress,
        bidderUsername: row.Bidder.username,
        blockTimestamp: row.blockTimestamp,
      });
    }
    response.json(bids);
  }
}

async function getNftByAuctionAndWinner(
  auctionId: number,
  winner: string,
  response: NextApiResponse
) {
  response.json(
    await prisma.auction.findFirst({
      where: {
        id: auctionId,
        winnerAddress: winner,
      },
      include: {
        Nft: {
          include: {
            Lottery: {
              include: { Drop: { include: { NftContract: { include: { Artist: true } } } } },
            },
          },
        },
      },
    })
  );
}

async function getClaimedAuctionNfts(walletAddress: string, response: NextApiResponse) {
  if (!walletAddress) {
    response.status(401).end('Not Authenticated');
    return;
  }
  try {
    const claimedAuctions = await prisma.auction.findMany({
      where: {
        winnerAddress: walletAddress,
        settled: true,
      },
      include: {
        Nft: true,
        Drop: { include: { NftContract: { include: { Artist: true } } } },
      },
    });
    const claimedNfts = Array<GamePrize>();
    claimedAuctions.forEach((a) =>
      claimedNfts.push(flatten({ auction: a, drop: a.Drop, artist: a.Drop.NftContract.Artist }))
    );
    console.log(`getClaimedAuctionNfts(${walletAddress}) :: ${claimedNfts.length}`);
    response.json(claimedNfts);
  } catch (e) {
    console.log(e);
    response.status(500);
  }
}

async function getUnclaimedAuctionNfts(walletAddress: string, response: NextApiResponse) {
  if (!walletAddress) {
    response.status(401).end('Not Authenticated');
    return;
  }
  try {
    const unclaimedAuctions = await prisma.auction.findMany({
      where: {
        winnerAddress: walletAddress,
        settled: false,
      },
      include: {
        Nft: true,
        Drop: { include: { NftContract: { include: { Artist: true } } } },
      },
    });
    const unclaimedNfts = Array<GamePrize>();
    unclaimedAuctions.forEach((a) =>
      unclaimedNfts.push(flatten({ auction: a, drop: a.Drop, artist: a.Drop.NftContract.Artist }))
    );
    console.log(`getUnclaimedAuctionNfts(${walletAddress}) :: ${unclaimedNfts.length}`);
    response.json(unclaimedNfts);
  } catch (e) {
    console.log(e);
    response.status(500);
  }
}

async function saveBid(
  bidderAddress: string,
  auctionId: number,
  amount: number,
  blockTimestamp: number,
  response: NextApiResponse
) {
  console.log(`saveBid(${auctionId}, ${bidderAddress}, ${amount}, ${blockTimestamp})`);
  if (!bidderAddress) {
    response.status(401).end('Not Authenticated');
    return;
  }
  if (isNaN(auctionId) || isNaN(amount) || isNaN(blockTimestamp)) {
    response.status(500);
    return;
  }
  await prisma.bidHistory.create({
    data: { auctionId, amount, bidderAddress, blockTimestamp },
  });
  await new Promise((r) => setTimeout(r, 500)); // give it a split second before finishing the request
  response.status(200);
}

async function updateNftClaimedDate(
  walletAddress: string,
  auctionId: number,
  response: NextApiResponse
) {
  console.log(`updateNftClaimedDate(${auctionId})`);
  if (isNaN(auctionId)) {
    response.status(500);
    return;
  }
  if (!walletAddress) {
    response.status(401).end('Not Authenticated');
    return;
  }
  try {
    const auctionWinner = await getUnclaimedAuctionWinner(auctionId);
    // only the on-chain winner may mark their own auction settled/claimed —
    // otherwise any signed-in wallet could flip auctions they didn't win
    if (!auctionWinner || auctionWinner.toLowerCase() !== walletAddress.toLowerCase()) {
      response.status(403).json({ error: 'Only the auction winner can claim this NFT' });
      return;
    }
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

function flatten({ auction, drop, artist }: FlattenArgs): GamePrize {
  return {
    auctionId: auction.id,
    uri: auction.Nft.metadataPath,
    nftId: auction.Nft.id,
    dropId: drop.id,
    width: auction.Nft.width,
    height: auction.Nft.height,
    nftName: auction.Nft.name,
    artistUsername: auction.Nft.artistDisplayName || artist.username!,
    artistProfilePicture: artist.profilePicture!,
    s3Path: auction.Nft.s3Path,
    s3PathOptimized: auction.Nft.s3PathOptimized,
    claimedAt: auction.claimedAt || undefined,
  };
}

export default handler;
