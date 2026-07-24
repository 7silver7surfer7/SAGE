import { NextApiRequest, NextApiResponse } from 'next';
import { getRequester } from '@/utilities/apiAuth';
import prisma from '@/prisma/client';

async function handler(request: NextApiRequest, response: NextApiResponse) {
  const {
    query: { action },
  } = request;
  switch (action) {
    case 'GetLottery':
      await getLottery(Number(request.query.lotteryId), response);
      break;
    case 'GetWinners':
      await getWinners(Number(request.query.lotteryId), response);
      break;
    case 'GetRefund':
      await getRefund(request, response);
      break;
    case 'GetRefunds':
      await getRefunds(request, response);
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
          Drop: { include: { NftContract: { include: { Artist: true } } } },
        },
      });
      response.json(lottery);
    } catch (e) {
      console.log({ e });
      response.status(500);
    }
  }
}

async function getWinners(lotteryId: number, response: NextApiResponse) {
  if (isNaN(lotteryId)) {
    response.status(500);
  } else {
    try {
      // SECURITY (audit pass-3 HIGH): this route is unauthenticated, and
      // `include: { User: true }` served every winner's FULL user row —
      // email, role, ban reason/notes, invite code, verification tx — to any
      // anonymous caller. The winners list only renders a username (see
      // GetTicketModal), so project exactly that.
      const result = await prisma.prizeProof.findMany({
        where: { lotteryId },
        include: { User: { select: { username: true, profilePicture: true } } },
        distinct: ['lotteryId', 'winnerAddress']
      });
      response.json(result);
      console.log(`getWinners(${lotteryId}) :: ${result.length}`);
    } catch (e) {
      console.log({ e });
      response.status(500);
    }
  }
}

async function getRefund(request: NextApiRequest, response: NextApiResponse) {
  const lotteryId = Number(request.query.lotteryId);
  const requester = await getRequester(request);
  const walletAddress = requester?.walletAddress;
  if (!walletAddress || isNaN(lotteryId)) {
    response.json([]);
    return;
  }
  const data = await prisma.refund.findMany({ 
    where: { buyer: walletAddress, lotteryId },
    include: { Lottery: { include: { Nfts: true } } }
  });
  console.log(`getRefund(${walletAddress}, ${lotteryId}) :: ${data.length} refunds`);
  response.json(data.length > 0 ? data[0] : null);
}

async function getRefunds(request: NextApiRequest, response: NextApiResponse) {
  const requester = await getRequester(request);
  const walletAddress = requester?.walletAddress;
  if (!walletAddress) {
    response.json([]);
    return;
  }
  const idParam = Number(request.query.id);
  const lotteryId = isNaN(idParam) ? undefined : idParam;
  const data = await prisma.refund.findMany({ 
    where: { buyer: walletAddress, lotteryId },
    include: { Lottery: { include: { Nfts: true } } }
  });
  console.log(`getRefunds(${walletAddress}) :: ${data.length} refunds`);
  response.json(data);
}

export default handler;
