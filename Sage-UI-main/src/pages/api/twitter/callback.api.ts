import { serialize } from 'cookie';
import prisma from '@/prisma/client';
import { exchangeCode, fetchMe } from '@/utilities/twitter';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from 'next-auth/react';
import { TWITTER_OAUTH_COOKIE } from '@/utilities/twitterOAuthCookie';

export default async (req: NextApiRequest, res: NextApiResponse) => {
  const {
    query: { code, state },
  } = req;

  const session = await getSession({ req });
  if (!session) {
    // Same reason as authorize: X sends the visitor here by redirect, so a
    // bare 401 body strands them on an API URL. Losing the session across the
    // round trip is the likeliest cause, and the console can say that.
    res.redirect('/agent?twitter=signin-required');
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
    // Exchange by hand — see utilities/twitter.ts for why the SDK could not.
    const token = await exchangeCode(req, String(code), stored.codeChallenge);
    const user = { data: await fetchMe(token) };

    // Store the NUMERIC id, not just the handle. The handle is renameable and
    // the freed name is immediately re-registerable, so it cannot be an
    // authorization key — the @SAGEARTXYZ mention gate looks up
    // User.twitterUserId and would otherwise serve whoever bought the name.
    //
    // twitterUserId is UNIQUE: one X account maps to one wallet. Re-linking an
    // X account already bound elsewhere is refused rather than silently moving
    // it, since that would let someone point a funded wallet's credits at an
    // account they do not control.
    // Replacing a DIFFERENT account on this wallet is legitimate — people
    // change handles and accounts — but doing it silently is not. The old
    // account stops being served the moment this writes, so say so.
    const existing = await prisma.user.findUnique({
      where: { walletAddress },
      select: { twitterUserId: true, twitterUsername: true },
    });
    const replaced =
      existing?.twitterUserId && existing.twitterUserId !== user.data.id
        ? existing.twitterUsername || 'another account'
        : null;

    try {
      await prisma.user.update({
        where: { walletAddress },
        data: { twitterUsername: user.data.username, twitterUserId: user.data.id },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        return res.redirect('/agent?twitter=already-linked');
      }
      throw e;
    }

    res.redirect(
      replaced
        ? `/agent?twitter=replaced&previous=${encodeURIComponent(replaced)}`
        : '/agent?twitter=linked'
    );
  } catch (error: any) {
    // ALWAYS respond. This used to only log, so a failed token exchange left
    // the request open and the browser spinning on X's consent screen with no
    // way to tell what went wrong — "taking forever to authorize" was this.
    //
    // The SDK's error carries the useful part in `errors`/`error_description`;
    // the bare message is just "Response error".
    const detail =
      error?.error?.error_description ||
      error?.errors?.[0]?.message ||
      error?.error?.error ||
      error?.message ||
      'unknown';
    console.error('twitter callback failed:', detail, JSON.stringify(error?.error || {}).slice(0, 400));
    if (!res.writableEnded) {
      res.redirect(`/agent?twitter=failed&reason=${encodeURIComponent(String(detail).slice(0, 120))}`);
    }
  }
};
