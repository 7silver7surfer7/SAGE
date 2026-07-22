import { NextApiRequest, NextApiResponse } from 'next';
import { ethers } from 'ethers';
import prisma from '@/prisma/client';
import { getRequester } from '@/utilities/apiAuth';
import { getUnclaimedAuctionWinner } from '@/utilities/contracts';
import { isEthCurrency, parameters } from '@/constants/config';
import AuctionJson from '@/constants/abis/Auction/Auction.sol/Auction.json';
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
    const [result, auction] = await Promise.all([
      prisma.bidHistory.findMany({
        where: { auctionId },
        include: { Bidder: true },
        orderBy: [{ blockTimestamp: 'desc' }],
      }),
      prisma.auction.findUnique({ where: { id: auctionId }, include: { Drop: true } }),
    ]);
    // the drop's own priced currency — the row was hardcoded to "SAGE"
    // regardless, so ETH-currency auctions showed the wrong unit
    const currency = auction && isEthCurrency((auction.Drop as any).currency) ? 'ETH' : 'SAGE';
    for (const row of result) {
      bids.push({
        amount: row.amount,
        bidderAddress: row.bidderAddress,
        bidderUsername: row.Bidder.username,
        bidderProfilePicture: row.Bidder.profilePicture,
        blockTimestamp: row.blockTimestamp,
        currency,
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

// Reads the auction's CURRENT top bid straight from chain (audit M3), so a bid
// row can never be fabricated. Returns null if the read fails.
async function getOnChainTopBid(
  auctionId: number
): Promise<{ bidder: string; bid: ethers.BigNumber } | null> {
  try {
    const provider = new ethers.providers.StaticJsonRpcProvider(
      parameters.RPC_URL,
      Number(parameters.CHAIN_ID)
    );
    const contract = new ethers.Contract(parameters.AUCTION_ADDRESS, AuctionJson.abi, provider);
    const s = await contract.getAuction(auctionId);
    return { bidder: s.highestBidder, bid: s.highestBid };
  } catch (e) {
    console.log('getOnChainTopBid error', e);
    return null;
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
  if (isNaN(auctionId) || isNaN(blockTimestamp)) {
    response.status(500);
    return;
  }
  // SECURITY (audit M3): never trust the client-supplied bid. Read the auction's
  // current top bid from chain — the caller must actually BE the current highest
  // bidder, and we record the on-chain bid amount, not the number they sent.
  // This makes fabricated / inflated bid rows impossible (previously any signed-
  // in wallet could POST an arbitrary amount to manufacture FOMO).
  const top = await getOnChainTopBid(auctionId);
  if (!top) {
    response.status(502).json({ error: 'could not read auction state on-chain' });
    return;
  }
  if (!top.bidder || top.bidder.toLowerCase() !== bidderAddress.toLowerCase()) {
    response.status(403).json({ error: 'not the current highest bidder for this auction' });
    return;
  }
  // ETH and SAGE are both 18-decimal on Robinhood Chain, so formatEther is the
  // correct unit conversion for either auction currency.
  const onChainAmount = Number(ethers.utils.formatEther(top.bid));
  await prisma.bidHistory.create({
    data: { auctionId, amount: onChainAmount, bidderAddress, blockTimestamp },
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
