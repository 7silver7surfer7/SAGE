import crypto from 'crypto';
import { serialize } from 'cookie';
import { authorizeUrl } from '@/utilities/twitter';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from 'next-auth/react';
import { TWITTER_OAUTH_COOKIE } from '@/utilities/twitterOAuthCookie';

export default async (req: NextApiRequest, res: NextApiResponse) => {
  const session = await getSession({ req });
  if (!session) {
    // This is a full-page navigation, not a fetch — ending with bare text
    // stranded the visitor on a blank API URL reading "Not Authenticated",
    // with no back button semantics and no hint that the fix is to sign in.
    // Send them back to the console, which knows how to say so.
    res.redirect('/agent?twitter=signin-required');
    return;
  }

  try {
    // Per-request random state + PKCE challenge, not a fixed env secret —
    // a static value shared by every user gave zero CSRF protection (an
    // attacker who ever learned it could complete anyone's flow) and, in
    // this SDK's 'plain' PKCE mode, the challenge doubles as the verifier,
    // so a static challenge meant PKCE verified nothing either. Stashed in
    // a short-lived httpOnly cookie rather than the SDK's own instance
    // state, since authorize and callback are separate HTTP requests that
    // can land on different server processes.
    const state = crypto.randomBytes(32).toString('hex');
    // the VERIFIER is the secret; its S256 hash is what goes to X
    const codeChallenge = crypto.randomBytes(32).toString('hex');
    res.setHeader(
      'Set-Cookie',
      serialize(TWITTER_OAUTH_COOKIE, JSON.stringify({ state, codeChallenge }), {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 600, // 10 minutes — plenty for the twitter.com redirect round trip
        path: '/',
      })
    );

    res.redirect(authorizeUrl(req, state, codeChallenge));
  } catch (error: any) {
    console.error('twitter authorize failed:', error?.message);
    if (!res.writableEnded) res.redirect('/agent?twitter=failed');
  }
};
