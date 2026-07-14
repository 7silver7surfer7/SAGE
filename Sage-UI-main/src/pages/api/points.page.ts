import { EarnedPoints } from '@prisma/client';
import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/prisma/client';
import { parameters } from '@/constants/config';
import { pixelsOf } from '@/utilities/serverWallet';
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
  // Pixels are CONTRACT-based now (SagePoints streams accrual per second from
  // the wallet's live SAGE balance) — the DB ledger is legacy. Fall back to
  // the DB only if the contract isn't configured (e.g. prod pre-launch).
  if (parameters.SAGE_POINTS_ADDRESS) {
    try {
      const live = await pixelsOf(walletAddress);
      response.status(200).json({
        address: walletAddress,
        totalPointsEarned: live.toString(),
        signedMessage: '',
        updatedAt: new Date(),
      });
      console.log(`getEarnedPoints(${walletAddress}) :: on-chain ${live}`);
      return;
    } catch (e) {
      console.error('SagePoints read failed, falling back to DB', e);
    }
  }
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
