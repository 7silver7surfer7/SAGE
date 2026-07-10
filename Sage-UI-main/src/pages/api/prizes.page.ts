import type { NextApiRequest, NextApiResponse } from 'next';
import { Prisma, PrizeProof, User } from '@prisma/client';
import { getRequester } from '@/utilities/apiAuth';
import prisma from '@/prisma/client';
import { GamePrize, PrizeWithNftAndArtist } from '@/prisma/types';

function flatten(dbPrize: PrizeWithNftAndArtist): GamePrize {
  return {
    nftId: dbPrize.nftId,
    dropId: dbPrize.Nft.Lottery?.Drop.id!,
    lotteryId: dbPrize.Nft.Lottery?.id!,
    uri: dbPrize.Nft.metadataPath,
    lotteryProof: dbPrize.proof,
    ticketNumber: dbPrize.ticketNumber,
    nftName: dbPrize.Nft.name,
    width: dbPrize.Nft.width,
    height: dbPrize.Nft.height,
    artistUsername:
      dbPrize.Nft.artistDisplayName || dbPrize.Nft.Lottery?.Drop.NftContract.Artist.username!,
    artistProfilePicture: dbPrize.Nft.Lottery?.Drop.NftContract.Artist.profilePicture!,
    s3Path: dbPrize.Nft.s3Path,
    s3PathOptimized: dbPrize.Nft.s3PathOptimized,
    claimedAt: dbPrize.claimedAt || undefined,
  };
}

export default async function (request: NextApiRequest, response: NextApiResponse) {
  const {
    query: { action, lotteryId },
    body: { nftId },
  } = request;
  const requester = await getRequester(request);
  const walletAddress = requester?.walletAddress;
  if (!walletAddress) {
    response.status(401).end('Not Authenticated');
    return;
  }
  switch (action) {
    case 'IsLotteryDrawn':
      await isLotteryDrawn(Number(lotteryId), response);
      break;
    case 'GetClaimedPrizes':
      await getClaimedPrizes(walletAddress as string, response);
      break;
    case 'GetUnclaimedPrizes':
      await getUnclaimedPrizes(walletAddress as string, response);
      break;
    case 'GetPrizesByUser':
      await getPrizesByUser(walletAddress as string, response);
      break;
    case 'GetPrizesByUserAndLottery':
      await getPrizesByUserAndLottery(Number(lotteryId), walletAddress as string, response);
      break;
    case 'UpdatePrizeClaimedDate':
      // winnerAddress is forced to the authenticated caller — previously it
      // came from the request body, so anyone could claim another's prize
      await updatePrizeClaimedDate(Number(lotteryId), walletAddress, nftId, response);
      break;
    case 'GetPrizesStats':
      await getPrizesStats(response);
      break;
    case 'GetLotteryPrizes':
      await getLotteryPrizes(Number(lotteryId), response);
      break;
  }
  response.end();
}

async function getClaimedPrizes(walletAddress: string, response: NextApiResponse) {
  let prizeNfts: GamePrize[] = [];
  if (walletAddress && walletAddress != '') {
    try {
      const prizes: PrizeWithNftAndArtist[] = await prisma.prizeProof.findMany({
        where: {
          winnerAddress: walletAddress,
          NOT: {
            claimedAt: null,
          },
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
      });
      prizes.forEach((prize) => prizeNfts.push(flatten(prize)));
    } catch (e) {
      console.log(e);
    }
  }
  console.log(`getClaimedPrizes(${walletAddress}) :: ${prizeNfts.length}`);
  response.status(200).json(prizeNfts);
}

async function getUnclaimedPrizes(walletAddress: string, response: NextApiResponse) {
  let prizeNfts: GamePrize[] = [];
  if (walletAddress && walletAddress != '') {
    try {
      const prizes: PrizeWithNftAndArtist[] = await prisma.prizeProof.findMany({
        where: {
          winnerAddress: walletAddress,
          claimedAt: null,
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
      });
      prizes.forEach((prize) => prizeNfts.push(flatten(prize)));
    } catch (e) {
      console.log(e);
    }
  }
  console.log(`getUnclaimedPrizes(${walletAddress}) :: ${prizeNfts.length}`);
  response.status(200).json(prizeNfts);
}

async function getPrizesByUser(walletAddress: User['walletAddress'], response: NextApiResponse) {
  let prizeNfts: GamePrize[] = [];
  if (walletAddress && walletAddress != '') {
    try {
      const prizes: PrizeWithNftAndArtist[] = await prisma.prizeProof.findMany({
        where: {
          winnerAddress: walletAddress,
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
        orderBy: {
          claimedAt: 'desc',
        },
      });
      prizes.forEach((prize) => prizeNfts.push(flatten(prize)));
    } catch (e) {
      console.log(e);
    }
  }
  console.log(`getPrizesByUser(${walletAddress}) :: ${prizeNfts.length}`);
  response.status(200).json(prizeNfts);
}

async function getPrizesByUserAndLottery(
  lotteryId: number,
  walletAddress: string,
  response: NextApiResponse
) {
  let prizeNfts: GamePrize[] = [];
  if (!walletAddress || walletAddress == '') {
    response.status(200).json(prizeNfts);
    return;
  }
  try {
    const prizes: PrizeWithNftAndArtist[] | null = await prisma.prizeProof.findMany({
      where: {
        winnerAddress: walletAddress,
        lotteryId,
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
    });
    prizes.forEach((prize) => prizeNfts.push(flatten(prize)));
  } catch (e) {
    console.log(e);
  }
  console.log(`getPrizesByUserAndLottery(${lotteryId}, ${walletAddress}) = ${prizeNfts.length}`);
  response.status(200).json(prizeNfts);
}

/**
 * Returns a map containing the counting of drawn and claimed prizes per lottery.
 * [lotteryId] => { prizesDrawn, prizesClaimed }
 */
async function getPrizesStats(response: NextApiResponse) {
  interface IResult {
    [lotteryId: string]: IResultItem;
  }

  interface IResultItem {
    numPrizesDrawn: number;
    numPrizesClaimed: number;
  }

  let prizesStats: IResult = {};
  try {
    const result = await prisma.$queryRaw<any[]>(
      Prisma.sql`select a."lotteryId", a."drawn", b."claimed" from
      (select "lotteryId", count(*) as "drawn" from "PrizeProof" group by "lotteryId") as a
      left join
      (select "lotteryId", count(*) as "claimed" from "PrizeProof" where ("claimedAt" is not null) group by "lotteryId") as b
      on (a."lotteryId" = b."lotteryId")`
    );
    result.forEach((row) => {
      prizesStats[row.lotteryId] = {
        numPrizesDrawn: row.drawn,
        numPrizesClaimed: row.claimed ? row.claimed : 0,
      };
    });
  } catch (e) {
    console.log(e);
  }
  response.status(200).json(prizesStats);
}

/**
 * Returns a boolean that depends on prizes being drawn for a lottery.
 */
async function isLotteryDrawn(lotteryId: number, response: NextApiResponse) {
  try {
    const prizeCount = await prisma.prizeProof.aggregate({
      _count: { winnerAddress: true },
      where: {
        lotteryId,
      },
    });
    var isDrawn = prizeCount._count.winnerAddress > 0;
    console.log(`isLotteryDrawn(${lotteryId}) = ${isDrawn}`);
    response.status(200).json(isDrawn);
  } catch (e) {
    console.log(e);
    response.status(500).end();
  }
}

/**
 * Returns all data from PrizeProof table for a given lotteryId.
 */
async function getLotteryPrizes(lotteryId: number, response: NextApiResponse) {
  try {
    const allPrizes: PrizeProof[] | null = await prisma.prizeProof.findMany({
      where: {
        lotteryId,
      },
    });
    console.log(`getLotteryPrizes(${lotteryId}) = ${allPrizes.length}`);
    response.status(200).json(allPrizes);
  } catch (e) {
    console.log(e);
    response.status(500).end();
  }
}

/**
 * Updates the "claimedAt" date field in the PrizeProof table, after a successful contract mint.
 */
async function updatePrizeClaimedDate(
  lotteryId: number,
  winnerAddress: string,
  nftId: number,
  response: NextApiResponse
) {
  let now = new Date();
  try {
    await prisma.prizeProof.update({
      where: {
        lotteryId_winnerAddress_nftId: {
          winnerAddress,
          lotteryId,
          nftId,
        },
      },
      data: {
        claimedAt: now,
      },
    });
    response.status(200).json({ claimedAt: now });
  } catch (e) {
    console.log(e);
    response.status(500).end();
  }
}
