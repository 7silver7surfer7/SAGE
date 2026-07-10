import prisma from '@/prisma/client';
import authClient from '@/utilities/twitter';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from 'next-auth/react';
import { Client } from 'twitter-api-sdk';

export default async (req: NextApiRequest, res: NextApiResponse) => {
  const {
    query: { code, state },
  } = req;

  const session = await getSession({ req });
  if (!session) {
    res.status(401).end('Not Authenticated');
    return;
  }
  const { address: walletAddress } = session!;

  try {
    if (state !== process.env.TWITTER_STATE_SECRET)
      return res.status(500).send("State isn't matching");
    await authClient.generateAuthURL({
      state: process.env.TWITTER_STATE_SECRET as string,
      code_challenge: process.env.TWITTER_CODE_SECRET as string,
    });
    await authClient.requestAccessToken(String(code));
    const client = new Client(authClient);
    const user = await client.users.findMyUser();

    await prisma.user.update({
      where: { walletAddress },
      data: { twitterUsername: user.data.username },
    });

    res.redirect('/profile');
  } catch (error) {
    console.error(error);
  }
};
