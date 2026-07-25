import { serialize } from 'cookie';
import prisma from '@/prisma/client';
import { authClientFor } from '@/utilities/twitter';
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

  const authClient = authClientFor(req);
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

    // Store the NUMERIC id, not just the handle. The handle is renameable and
    // the freed name is immediately re-registerable, so it cannot be an
    // authorization key — the @SAGEARTXYZ mention gate looks up
    // User.twitterUserId and would otherwise serve whoever bought the name.
    //
    // twitterUserId is UNIQUE: one X account maps to one wallet. Re-linking an
    // X account already bound elsewhere is refused rather than silently moving
    // it, since that would let someone point a funded wallet's credits at an
    // account they do not control.
    try {
      await prisma.user.update({
        where: { walletAddress },
        data: { twitterUsername: user.data.username, twitterUserId: user.data.id },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        return res.redirect('/profile?twitter=already-linked');
      }
      throw e;
    }

    res.redirect('/profile');
  } catch (error) {
    console.error(error);
  }
};
