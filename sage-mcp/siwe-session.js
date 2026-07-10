// Sign-In-With-Ethereum session for the SAGE web API (drops catalog, pixels).
// Mirrors the browser flow: CSRF nonce -> signed SIWE message -> credentials
// callback -> session cookie. The cookie jar lives in memory; on 401 the
// caller can force a re-login.
import { SiweMessage } from 'siwe';
import { ethers } from 'ethers';
import { config } from './config.js';

let jar = {};

function absorb(res) {
  const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of cookies) {
    const [pair] = c.split(';');
    const idx = pair.indexOf('=');
    jar[pair.slice(0, idx)] = pair.slice(idx + 1);
  }
}

const cookieHeader = () =>
  Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

/** follow trailing-slash 308s manually so the method+body survive */
async function post(url, body) {
  for (let hop = 0; hop < 3; hop++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader() },
      body: body.toString(),
      redirect: 'manual',
    });
    absorb(res);
    if (res.status === 307 || res.status === 308) {
      url = new URL(res.headers.get('location'), config.siteUrl).href;
      continue;
    }
    return res;
  }
  throw new Error('too many redirects');
}

export async function signIn() {
  if (!config.agentPrivateKey) throw new Error('SAGE_AGENT_PRIVATE_KEY required for site API access');
  jar = {};
  const wallet = new ethers.Wallet(config.agentPrivateKey);

  let res = await fetch(`${config.siteUrl}/api/auth/csrf`);
  absorb(res);
  const { csrfToken } = await res.json();

  const host = new URL(config.siteUrl).host;
  const message = new SiweMessage({
    domain: host,
    address: wallet.address,
    statement: 'I accept the SAGE Terms of Service and Privacy Policy.',
    uri: config.siteUrl,
    version: '1',
    chainId: config.marketplace.chainId,
    nonce: csrfToken,
    issuedAt: new Date().toISOString(),
  });
  const signature = await wallet.signMessage(message.prepareMessage());

  const cb = await post(
    `${config.siteUrl}/api/auth/callback/credentials?`,
    new URLSearchParams({
      message: JSON.stringify(message),
      signature,
      redirect: 'false',
      csrfToken,
      callbackUrl: config.siteUrl,
      json: 'true',
    })
  );
  if (!jar['next-auth.session-token'] && !jar['__Secure-next-auth.session-token']) {
    throw new Error(`SIWE sign-in failed (status ${cb.status}) — check SAGE_SITE_URL and that the site is running`);
  }
}

/** GET a site API path with the session cookie, signing in (once) as needed */
export async function siteGet(pathname) {
  if (!Object.keys(jar).length) await signIn();
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${config.siteUrl}${pathname}`, {
      headers: { Cookie: cookieHeader() },
    });
    if (res.status === 401 && attempt === 0) {
      await signIn(); // session expired — retry once with a fresh one
      continue;
    }
    if (!res.ok) throw new Error(`${pathname} -> HTTP ${res.status}`);
    return res.json();
  }
}
