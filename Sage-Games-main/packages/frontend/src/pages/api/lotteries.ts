import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/prisma/client';

async function handler(request: NextApiRequest, response: NextApiResponse) {
  const {
    query: { action },
  } = request;
  switch (action) {
    case 'GetLottery':
      await getLottery(Number(request.query.lotteryId), response);
      break;
    default:
      response.status(500);
  }
  response.end();
}

async function getLottery(lotteryId: number, response: NextApiResponse) {
  console.log(`getLottery(${lotteryId})`);
  if (isNaN(lotteryId)) {
    response.status(500);
  } else {
    try {
      const lottery = await prisma.lottery.findFirst({
        where: { id: lotteryId },
        include: {
          Nfts: true,
          Drop: { include: { Artist: true } },
        },
      });
      response.json(lottery);
    } catch (e) {
      console.log({ e });
      response.status(500);
    }
  }
}

export default handler;
