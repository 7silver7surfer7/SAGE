import type { NextApiRequest } from 'next';
import { parameters } from '@/constants/config';
import crypto from 'crypto';

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

export const OAUTH_SCOPES = 'tweet.read users.read offline.access';

/** The URL X sends the visitor to, with a real S256 PKCE challenge. */
export function authorizeUrl(req: NextApiRequest, state: string, verifier: string): string {
  // base64url by hand: this @types/node predates the 'base64url' encoding
  const challenge = crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: String(process.env.TWITTER_CLIENT_ID || ''),
    redirect_uri: callbackFor(req),
    scope: OAUTH_SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return `https://x.com/i/oauth2/authorize?${q.toString()}`;
}

/**
 * Exchange the code for a token, by hand.
 *
 * twitter-api-sdk was doing this wrong for X's current endpoint: it puts the
 * token parameters in the QUERY STRING and sends no body, and the exchange
 * came back `unauthorized_client: Missing valid authorization header`. It also
 * keeps the PKCE verifier on the client instance, which stops working the
 * moment authorize and callback are separate instances — as they must be,
 * since the callback URL varies by host.
 *
 * Twenty lines we control beats a dependency we cannot debug: parameters in
 * the body as form-encoded, HTTP Basic for the confidential client, and the
 * verifier passed in explicitly from the cookie.
 */
export async function exchangeCode(
  req: NextApiRequest,
  code: string,
  verifier: string
): Promise<string> {
  const id = String(process.env.TWITTER_CLIENT_ID || '');
  const secret = String(process.env.TWITTER_CLIENT_SECRET || '');
  const body = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    client_id: id,
    redirect_uri: callbackFor(req),
    code_verifier: verifier,
  });
  const r = await fetch('https://api.x.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
    },
    body: body.toString(),
  });
  const text = await r.text();
  if (!r.ok) {
    let detail = text.slice(0, 200);
    try {
      const j = JSON.parse(text);
      detail = j.error_description || j.error || detail;
    } catch {
      /* keep the raw text */
    }
    throw new Error(detail);
  }
  const token = JSON.parse(text)?.access_token;
  if (!token) throw new Error('no access token returned');
  return String(token);
}

/** The authenticated user, read with the token we just minted. */
export async function fetchMe(token: string): Promise<{ id: string; username: string }> {
  const r = await fetch('https://api.x.com/2/users/me', {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`could not read the X account (${r.status})`);
  const d = await r.json();
  return { id: String(d?.data?.id || ''), username: String(d?.data?.username || '') };
}
