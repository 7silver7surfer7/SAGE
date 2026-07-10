import authClient from '@/utilities/twitter';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from 'next-auth/react';

export default async (req: NextApiRequest, res: NextApiResponse) => {
  const session = await getSession({ req });
  if (!session) {
    res.status(401).end('Not Authenticated');
    return;
  }

  try {
    const authUrl = authClient.generateAuthURL({
      state: process.env.TWITTER_STATE_SECRET as string,
      code_challenge: process.env.TWITTER_CODE_SECRET as string,
    });

    res.redirect(authUrl);
  } catch (error) {
    console.error(error);
  }
};
