import type { SafeUserUpdate } from '@/prisma/types';
import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/prisma/client';
import { getSession } from 'next-auth/react';
import { UserDisplayInfo } from '@/store/services/user';

export default async (req: NextApiRequest, res: NextApiResponse) => {
  const {
    body: { user },
    method,
  } = req;

  const session = await getSession({ req });
  if (!session) res.status(401).end('Not Authenticated');
  const { address: walletAddress } = session!;

  switch (method) {
    case 'GET':
      if (req.query.action == 'GetAllUsersAndEarnedPoints') {
        await getAllUsersAndEarnedPoints(res);
      } else if (req.query.wallet) {
        await getUserDisplayInfo(req.query.wallet as string, res);
      } else {
        await getUser(walletAddress as string, res);
      }
      return;
    case 'POST':
      await createUser(walletAddress as string, res);
      return;
    case 'PATCH':
      await updateUser(user, walletAddress as string, res);
      return;
    default:
      res.status(501).end();
  }
};

async function getUser(walletAddress: string, res: NextApiResponse) {
  try {
    const existingUser = await prisma.user.findUnique({
      where: { walletAddress },
    });
    if (!existingUser) {
      await createUser(walletAddress, res);
      return;
    }
    res.status(200).send(existingUser);
  } catch (e) {
    res.status(500).end;
  }
}

async function getUserDisplayInfo(walletAddress: string, res: NextApiResponse) {
  try {
    const user = await prisma.user.findUnique({
      where: { walletAddress },
    });
    if (user) {
      res.json(<UserDisplayInfo>{
        username: user.username,
        displayName: user.displayName,
        profilePicture: user.profilePicture,
      });
    }
  } catch (e) {
    console.log(e);
  }
  res.status(500).end;
}

async function getAllUsersAndEarnedPoints(res: NextApiResponse) {
  try {
    const users = await prisma.user.findMany({
      include: { EarnedPoints: true },
    });
    const json = JSON.stringify(users, (_, value) =>
      typeof value === 'bigint' ? value.toString() : value
    );
    res.status(200).end(json);
  } catch (error) {
    console.log(error);
    res.status(500).end();
  }
}

async function createUser(walletAddress: string, res: NextApiResponse) {
  try {
    const newUser = await prisma.user.create({
      data: {
        walletAddress,
      },
    });
    res.status(201).json(newUser);
  } catch (error) {
    console.error(error);
    res.status(500).end();
  }
}

async function updateUser(user: SafeUserUpdate, walletAddress: string, res: NextApiResponse) {
  try {
    const updatedUser = await prisma.user.update({
      where: {
        walletAddress,
      },
      data: user,
    });
    res.status(200).json(updatedUser);
  } catch (error) {
    console.error(error);
    res.status(500).end();
  }
}
