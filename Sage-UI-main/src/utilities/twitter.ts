import type { NextApiRequest } from 'next';
import { parameters } from '@/constants/config';
import { auth } from 'twitter-api-sdk';

/**
 * The OAuth client for linking a visitor's X account.
 *
 * The callback used to be baked in from `parameters.APP_URL`, which is decided
 * at BUILD time. testnet.sageart.xyz is built in production mode, so it was
 * sending https://sageart.xyz/api/twitter/callback — a different host, which
 * does not share the session cookie the round trip depends on. Linking would
 * have failed there however the URL was registered with X.
 *
 * So the callback follows the host the visitor is actually on, and that host is
 * checked against a fixed list. Trusting the Host header unchecked would be an
 * open redirect: an attacker sets it, X sends the authorization code to their
 * server, and they link their own X account to somebody else's wallet.
 */
const ALLOWED_HOSTS = new Set([
  'sageart.xyz',
  'www.sageart.xyz',
  'testnet.sageart.xyz',
  'localhost:3005',
  'localhost:3000',
]);

/** Every callback that has to be registered in the X app's settings. */
export const CALLBACK_URLS = [
  'https://sageart.xyz/api/twitter/callback',
  'https://testnet.sageart.xyz/api/twitter/callback',
  'http://localhost:3005/api/twitter/callback',
];

export function callbackFor(req: NextApiRequest): string {
  const host = String(req.headers.host || '').toLowerCase();
  if (ALLOWED_HOSTS.has(host)) {
    const proto = host.startsWith('localhost') ? 'http' : 'https';
    return `${proto}://${host}/api/twitter/callback`;
  }
  // Unrecognised Host — fall back to what this build was made for rather than
  // honouring a header we do not trust.
  return `${parameters.APP_URL}api/twitter/callback`;
}

/**
 * A client bound to THIS request's callback. Per-request rather than a
 * module singleton: the callback differs by host, and the SDK carries the
 * PKCE verifier on the instance.
 */
export function authClientFor(req: NextApiRequest) {
  return new auth.OAuth2User({
    client_id: process.env.TWITTER_CLIENT_ID as string,
    client_secret: process.env.TWITTER_CLIENT_SECRET as string,
    callback: callbackFor(req),
    scopes: ['tweet.read', 'users.read', 'offline.access'],
  });
}
