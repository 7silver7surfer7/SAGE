import { Prisma, PrizeProof } from '@prisma/client';
import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/prisma/client';
import { PrizeWithNftAndArtist } from '@/store/services/prizesReducer';
import { GamePrize } from '@/prisma/types';

function flatten(dbPrize: PrizeWithNftAndArtist): GamePrize {
  return {
    nftId: dbPrize.nftId,
    dropId: dbPrize.Nft.Lottery?.Drop.id!,
    lotteryId: dbPrize.Nft.Lottery?.id!,
    lotteryTicketNumber: dbPrize.ticketNumber,
    lotteryProof: dbPrize.proof,
    nftName: dbPrize.Nft.name,
    artistUsername: dbPrize.Nft.Lottery?.Drop.Artist.username!,
    artistDisplayName: dbPrize.Nft.Lottery?.Drop.Artist.displayName!,
    artistProfilePicture: dbPrize.Nft.Lottery?.Drop.Artist.profilePicture!,
    s3Path: dbPrize.Nft.s3Path,
    isVideo: dbPrize.Nft.isVideo,
    claimedAt: dbPrize.claimedAt || undefined,
  };
}

export default async function (request: NextApiRequest, response: NextApiResponse) {
  const {
    query: { action, walletAddress, lotteryId },
    body: { winnerAddress, nftId, ticketNumber },
  } = request;
  switch (action) {
    case 'IsLotteryDrawn':
      await isLotteryDrawn(Number(lotteryId), response);
      break;
    case 'GetPrizesByUser':
      await getPrizesByUser(walletAddress as string, response);
      break;
    case 'GetUnclaimedPrizesByUser':
      await getUnclaimedPrizesByUser(walletAddress as string, response);
      break;
    case 'GetPrizesByUserAndLottery':
      await getPrizesByUserAndLottery(Number(lotteryId), walletAddress as string, response);
      break;
    case 'UpdatePrizeClaimedDate':
      await updatePrizeClaimedDate(Number(lotteryId), winnerAddress, nftId, ticketNumber, response);
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

async function getPrizesByUser(walletAddress: string, response: NextApiResponse) {
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
                include: {
                  Drop: {
                    include: {
                      Artist: true,
                    },
                  },
                },
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
  console.log(`getPrizesByUser(${walletAddress}) = ${prizeNfts.length}`);
  response.status(200).json(prizeNfts);
}

async function getUnclaimedPrizesByUser(walletAddress: string, response: NextApiResponse) {
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
                include: {
                  Drop: {
                    include: {
                      Artist: true,
                    },
                  },
                },
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
  console.log(`getUnclaimedPrizesByUser(${walletAddress}) :: ${prizeNfts.length}`);
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
              include: {
                Drop: {
                  include: {
                    Artist: true,
                  },
                },
              },
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
  ticketNumber: number,
  response: NextApiResponse
) {
  let now = new Date();
  try {
    await prisma.prizeProof.update({
      where: {
        lotteryId_winnerAddress_nftId_ticketNumber: {
          winnerAddress,
          lotteryId,
          nftId,
          ticketNumber,
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
