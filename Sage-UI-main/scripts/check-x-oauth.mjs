#!/usr/bin/env node
/**
 * Verify TWITTER_CLIENT_ID / TWITTER_CLIENT_SECRET without a browser round trip.
 *
 * The trick is that X validates the CLIENT before it validates the code, so a
 * deliberately bogus authorization code separates the two failures:
 *
 *   "Missing valid authorization header"  -> the client pair is rejected
 *   "authorization code was invalid"      -> the pair is GOOD (our fake code
 *                                            got far enough to be judged)
 *
 * So a complaint about the code is the PASS condition here.
 *
 * Run after pasting new credentials, before trying the browser flow:
 *   node scripts/check-x-oauth.mjs
 */
import { config } from 'dotenv';

config();

const id = String(process.env.TWITTER_CLIENT_ID || '');
const secret = String(process.env.TWITTER_CLIENT_SECRET || '');

if (!id || !secret) {
  console.error('FAIL  TWITTER_CLIENT_ID / TWITTER_CLIENT_SECRET not set in .env');
  process.exit(1);
}

// A real OAuth 2.0 Client ID is base64 ending in ":1:ci"; the OAuth 1.0a API
// Key is 25 raw characters. Catching the wrong-credential paste here is
// cheaper than reading X's error.
const looksLikeClientId = (() => {
  try {
    return Buffer.from(id, 'base64').toString('utf8').endsWith(':1:ci');
  } catch {
    return false;
  }
})();

console.log(`client_id      ${id.length} chars, ends ${id.slice(-6)}`);
console.log(`               ${looksLikeClientId ? 'shape OK (OAuth 2.0 Client ID)' : 'WRONG SHAPE — this is not an OAuth 2.0 Client ID (API Key pasted?)'}`);
console.log(`client_secret  ${secret.length} chars, ends ${secret.slice(-4)}`);

const body = new URLSearchParams({
  code: 'probe-not-a-real-code',
  grant_type: 'authorization_code',
  client_id: id,
  redirect_uri: 'http://localhost:3005/api/twitter/callback',
  code_verifier: 'x'.repeat(43),
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
let d = {};
try {
  d = JSON.parse(text);
} catch {
  /* fall through to the raw text */
}
const detail = d.error_description || d.error || text.slice(0, 200);

console.log(`\nX replied ${r.status}: ${detail}`);

// Key on the STATUS, not the message. X authenticates the client first and
// only then reads the arguments, so any 400 means the pair got through — the
// complaint is about our deliberately fake code. 401 is the client itself
// being refused. Matching on message text is fragile: X answers a bad code
// with a generic "invalid arguments" blurb that names no credential at all.
if (r.status === 400) {
  console.log('\nPASS  The credential pair is accepted — X authenticated the client and');
  console.log('      then rejected the fake code, which is exactly right.');
  console.log('      Linking should work. Try "connect X account" in /agent.');
  process.exit(0);
}

if (r.status === 401 || /authorization header|unauthorized_client|invalid_client/i.test(detail)) {
  console.log('\nFAIL  X rejected the CLIENT, not the code.');
  console.log('      In the X developer portal, open the app, go to Keys and tokens,');
  console.log('      and copy from "OAuth 2.0 Client ID and Client Secret" —');
  console.log('      NOT "Consumer Keys / API Key and Secret", which is the OAuth 1.0a');
  console.log('      pair the posting bot uses and is also 50 characters.');
  console.log('      Regenerating the secret invalidates the old one immediately, so');
  console.log('      paste the value from the SAME regeneration into .env.');
  process.exit(1);
}

console.log('\nUNCLEAR  Unrecognised response — read it above.');
process.exit(1);
