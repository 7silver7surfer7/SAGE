// twitter.js — X (Twitter) API v2 posting wrapper.
//
// DRY_RUN by default: prints the tweet and returns a fake id, so NOTHING is
// published until you provide per-agent credentials and set SAGE_AGENTS_DRY_RUN=false.
// The twitter-api-v2 import is lazy so dry-runs work before `npm install`.
//
// Each agent posts from its OWN X app credentials (user-context OAuth 1.0a):
//   SAGE_X_<ID>_APP_KEY  SAGE_X_<ID>_APP_SECRET  SAGE_X_<ID>_ACCESS_TOKEN  SAGE_X_<ID>_ACCESS_SECRET
import { config } from './config.js';

function creds(persona) {
  const p = `SAGE_X_${persona.id.toUpperCase()}_`;
  return {
    appKey: process.env[p + 'APP_KEY'],
    appSecret: process.env[p + 'APP_SECRET'],
    accessToken: process.env[p + 'ACCESS_TOKEN'],
    accessSecret: process.env[p + 'ACCESS_SECRET'],
  };
}

export function hasCreds(persona) {
  const c = creds(persona);
  return Boolean(c.appKey && c.appSecret && c.accessToken && c.accessSecret);
}

export async function postTweet(persona, text) {
  if (config.dryRunPosts) {
    console.log(`\n  💬 @${persona.handle} (DRY RUN — not posted):\n     ${text}`);
    return { id: 'dryrun', dryRun: true };
  }
  const c = creds(persona);
  if (!c.appKey) {
    console.warn(`  ⚠️  @${persona.handle}: no X credentials (set SAGE_X_${persona.id.toUpperCase()}_*). Skipped.`);
    return { id: null, skipped: true };
  }
  const { TwitterApi } = await import('twitter-api-v2');
  const client = new TwitterApi(c);
  try {
    const { data } = await client.v2.tweet(text);
    console.log(`  ✅ @${persona.handle} posted ${data.id}`);
    return { id: data.id, dryRun: false };
  } catch (e) {
    const code = e?.code || e?.data?.status;
    if (code === 429) console.warn(`  ⏳ @${persona.handle}: rate limited by X — backing off.`);
    else console.error(`  ❌ @${persona.handle}: tweet failed (${e.message || code}).`);
    return { id: null, error: true };
  }
}
