import { EarnedPoints } from '@prisma/client';
import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/prisma/client';
import { getRequester } from '@/utilities/apiAuth';

const handler = async (req: NextApiRequest, response: NextApiResponse) => {
  const requester = await getRequester(req);
  if (!requester) {
    response.status(401).end('Not Authenticated');
    return;
  }
  const { method } = req;
  switch (method) {
    case 'GET':
      if (req.query.address) {
        await getEarnedPoints(req.query.address as string, response);
      } else {
        await getEarnedPoints(requester.walletAddress, response);
      }
      return;
    default:
      response.status(500).end();
  }
};

export interface GetEarnedPointsResponse extends Omit<EarnedPoints, 'totalPointsEarned'> {
  totalPointsEarned: string;
}

async function getEarnedPoints(walletAddress: string, response: NextApiResponse) {
  const dbPoints: EarnedPoints | null = await prisma.earnedPoints.findUnique({
    where: {
      address: walletAddress,
    },
  });
  if (!dbPoints) {
    response.status(200).json({
      address: walletAddress,
      totalPointsEarned: BigInt(0).valueOf().toString(),
      signedMessage: '',
      updatedAt: new Date(),
    });
    console.log(`getEarnedPoints(${walletAddress}) :: No data found`);
  } else {
    const res: GetEarnedPointsResponse = {
      address: dbPoints.address,
      totalPointsEarned: dbPoints.totalPointsEarned.toString(),
      signedMessage: dbPoints.signedMessage,
      updatedAt: dbPoints.updatedAt,
    };
    response.status(200).json(res);
    response.end();
    console.log(`getEarnedPoints(${walletAddress}) :: ${dbPoints.totalPointsEarned}`);
  }
}

export default handler;
