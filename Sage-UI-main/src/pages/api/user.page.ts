import type { NextApiRequest, NextApiResponse } from 'next';
import { getToken } from 'next-auth/jwt';
import prisma from '@/prisma/client';
import { Prisma, Role } from '@prisma/client';
import type { SafeUserUpdate } from '@/prisma/types';
import { UserDisplayInfo } from '@/store/usersReducer';
import { getERC20Contract } from '@/utilities/contracts';

export default async (req: NextApiRequest, res: NextApiResponse) => {
  const {
    body: { user },
    method,
  } = req;

  // Decode the session JWT directly instead of getSession({req}), which does
  // an internal HTTP self-fetch to /api/auth/session — under this app's
  // trailingSlash:true config that round-trip 308-redirects and reliably
  // failed here (profile edits silently 401'd instead of saving). token.sub
  // holds the SIWE wallet address; no DB lookup, so this stays valid for a
  // brand-new wallet that doesn't have a User row yet (see createUser below).
  const token = await getToken({ req, secret: process.env.JWT_SECRET });
  const walletAddress = token?.sub;
  if (!walletAddress) {
    res.status(401).end('Not Authenticated');
    return;
  }

  switch (method) {
    case 'POST':
      await createUser(String(walletAddress), res);
      return;
    case 'PATCH':
      await updateUser(user, String(walletAddress), res);
      return;
    case 'GET':
      const { action } = req.query;
      switch (action) {
        case 'GetAllUsersAndEarnedPoints':
          await getAllUsersAndEarnedPoints(res);
          break;
        case 'PromoteToArtist':
          await promoteToArtist(String(walletAddress), String(req.query.address), res);
          break;
        case 'PromoteToAdmin':
          await promoteToAdmin(String(walletAddress), String(req.query.address), res);
          break;
        case 'GetIsFollowing':
          await getIsFollowing(String(walletAddress), res);
          break;
        case 'SetIsFollowing':
          await setIsFollowing(
            String(walletAddress),
            String(req.query.address),
            'true' == req.query.isFollowing,
            res
          );
          break;
        default:
          if (req.query.wallet) {
            await getUserDisplayInfo(String(req.query.wallet), res);
          } else {
            await getUser(String(walletAddress), res);
          }
      }
      res.end();
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
        profilePicture: user.profilePicture,
      });
    }
  } catch (e) {
    console.log(e);
    res.status(500).end;
  }
}

async function getAllUsersAndEarnedPoints(res: NextApiResponse) {
  try {
    const users = await prisma.user.findMany({
      include: { EarnedPoints: true, NftContract: true },
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
    try {
      const ashContract = await getERC20Contract();
      var ashBalanceAtCreation = (await ashContract.balanceOf(walletAddress)).toString();
      console.log(`createUser(${walletAddress}) :: ASH Balance = ${ashBalanceAtCreation}`);
    } catch (e) {
      console.log(e);
      var ashBalanceAtCreation = '0';
    }
    const newUser = await prisma.user.create({
      data: { walletAddress, ashBalanceAtCreation },
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
  } catch (e) {
    console.error(e);
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      res.status(200).json({ error: 'Unique constraint violation' });
    } else {
      res.status(200).json({ error: e });
    }
  }
}

async function requireAdmin(walletAddress: string) {
  const user = await prisma.user.findUnique({
    where: { walletAddress },
  });
  if (!user || user.role != Role.ADMIN) {
    throw new Error(`This function requires ADMIN privileges`);
  }
}

async function promoteToArtist(signerAddress: string, walletAddress: string, res: NextApiResponse) {
  console.log(`promoteToArtist(${signerAddress}, ${walletAddress})`);
  try {
    requireAdmin(signerAddress);
    const updatedUser = await prisma.user.update({
      where: {
        walletAddress,
      },
      data: {
        role: Role.ARTIST,
      },
    });
    res.status(200).json({ success: !!updatedUser });
  } catch (error) {
    console.error(error);
    res.status(500).end();
  }
}

async function promoteToAdmin(signerAddress: string, walletAddress: string, res: NextApiResponse) {
  console.log(`promoteToAdmin(${signerAddress}, ${walletAddress})`);
  try {
    requireAdmin(signerAddress);
    const updatedUser = await prisma.user.update({
      where: {
        walletAddress,
      },
      data: {
        role: Role.ADMIN,
      },
    });
    res.status(200).json({ success: !!updatedUser });
  } catch (error) {
    console.error(error);
    res.status(500).end();
  }
}

async function getIsFollowing(walletAddress: string, res: NextApiResponse) {
  try {
    const following: string[] = [];
    const result = await prisma.follow.findMany({
      where: { walletAddress },
      select: { followedAddress: true },
    });
    result.forEach((row) => following.push(row.followedAddress));
    console.log(`getFollowing(${walletAddress}) :: ${result.length}`);
    res.status(200).json(following);
  } catch (e) {
    console.log(e);
    res.status(500).end;
  }
}

async function setIsFollowing(
  walletAddress: string,
  followedAddress: string,
  isFollowing: boolean,
  res: NextApiResponse
) {
  console.log(`setIsFollowing(${walletAddress}, ${followedAddress}, ${isFollowing})`);
  try {
    if (isFollowing) {
      await prisma.follow.create({
        data: { walletAddress, followedAddress },
      });
    } else {
      await prisma.follow.delete({
        where: { walletAddress_followedAddress: { walletAddress, followedAddress } },
      });
    }
    res.status(200).end();
  } catch (e) {
    console.log(e);
    res.status(500).end;
  }
}
