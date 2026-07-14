import { serialize } from 'cookie';
import prisma from '@/prisma/client';
import authClient from '@/utilities/twitter';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from 'next-auth/react';
import { Client } from 'twitter-api-sdk';
import { TWITTER_OAUTH_COOKIE } from '@/utilities/twitterOAuthCookie';

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

  // always clear the one-time cookie, success or failure
  res.setHeader(
    'Set-Cookie',
    serialize(TWITTER_OAUTH_COOKIE, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0,
      path: '/',
    })
  );

  try {
    const raw = req.cookies[TWITTER_OAUTH_COOKIE];
    const stored = raw ? JSON.parse(raw) : null;
    // matches the per-request random value the cookie carries, not a fixed
    // secret every user shared — see authorize.api.ts
    if (!stored?.state || !stored?.codeChallenge || state !== stored.state) {
      return res.status(400).send("State isn't matching");
    }
    // 'plain' PKCE mode (see authorize.api.ts): the challenge doubles as the
    // verifier, so re-priming with the SAME stored value here reproduces
    // what generateAuthURL set on the authorize request — this SDK's
    // verifier lives on the client instance, not carried in the redirect.
    await authClient.generateAuthURL({
      state: stored.state,
      code_challenge: stored.codeChallenge,
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
