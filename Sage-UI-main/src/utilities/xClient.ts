import crypto from 'crypto';

/**
 * X (Twitter) API client for @SAGEARTXYZ — read mentions, reply, upload media.
 *
 * OAuth 1.0a user context, signed here rather than through a library. Two
 * reasons: OAuth 1.0a tokens do not expire, so a bot needs no refresh loop
 * (the OAuth 2.0 flow already in the repo issues 2-hour tokens and is for
 * per-visitor profile linking, not for acting as the account); and media
 * upload still lives on the v1.1 endpoint, which OAuth 2.0 does not reach.
 *
 * DRY RUN BY DEFAULT. Nothing is published unless SAGE_X_LIVE=true, mirroring
 * sage-agents/twitter.js. A bot that starts posting the moment credentials
 * appear is not something to discover in production.
 */

const API = 'https://api.x.com';
const UPLOAD = 'https://upload.twitter.com/1.1/media/upload.json';

export interface XCreds {
  appKey: string;
  appSecret: string;
  accessToken: string;
  accessSecret: string;
}

export function xCreds(): XCreds | null {
  const c = {
    appKey: process.env.SAGE_X_APP_KEY || '',
    appSecret: process.env.SAGE_X_APP_SECRET || '',
    accessToken: process.env.SAGE_X_ACCESS_TOKEN || '',
    accessSecret: process.env.SAGE_X_ACCESS_SECRET || '',
  };
  return c.appKey && c.appSecret && c.accessToken && c.accessSecret ? c : null;
}

/** Live posting is opt-in. Reads are always real — they are cheap and safe. */
export function isLive(): boolean {
  return process.env.SAGE_X_LIVE === 'true';
}

/**
 * RFC 3986 percent-encoding. encodeURIComponent leaves ! * ' ( ) alone and
 * OAuth requires them escaped — a signature computed with the JS default is
 * silently wrong for any parameter containing them.
 */
function enc(s: string): string {
  return encodeURIComponent(s).replace(
    /[!*'()]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

/**
 * OAuth 1.0a Authorization header.
 *
 * `params` must contain the QUERY parameters only. A JSON request body is not
 * part of the signature base string for these endpoints, and including it
 * produces a 401 that reads like a credential problem.
 */
function authHeader(
  creds: XCreds,
  method: string,
  url: string,
  params: Record<string, string> = {}
): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: creds.appKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.accessToken,
    oauth_version: '1.0',
  };

  const all = { ...params, ...oauth };
  const normalized = Object.keys(all)
    .sort()
    .map((k) => `${enc(k)}=${enc(all[k])}`)
    .join('&');

  const base = [method.toUpperCase(), enc(url), enc(normalized)].join('&');
  const key = `${enc(creds.appSecret)}&${enc(creds.accessSecret)}`;
  oauth.oauth_signature = crypto.createHmac('sha1', key).update(base).digest('base64');

  return (
    'OAuth ' +
    Object.keys(oauth)
      .sort()
      .map((k) => `${enc(k)}="${enc(oauth[k])}"`)
      .join(', ')
  );
}

async function call(
  creds: XCreds,
  method: 'GET' | 'POST',
  url: string,
  query: Record<string, string> = {},
  body?: any
): Promise<any> {
  const qs = new URLSearchParams(query).toString();
  const full = qs ? `${url}?${qs}` : url;
  const r = await fetch(full, {
    method,
    headers: {
      authorization: authHeader(creds, method, url, query),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  if (!r.ok) {
    // Never echo the body wholesale — it restates the request, headers included.
    console.error('x api error', method, url, r.status, text.slice(0, 300));
    if (r.status === 401) throw new Error('X rejected our credentials');
    if (r.status === 403) throw new Error('X refused the action — check the app is Read and Write, and that the reply was summoned');
    if (r.status === 429) throw new Error('X is rate limiting us');
    throw new Error(`X API failed (${r.status})`);
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error('X returned an unreadable response');
  }
}

export interface XMentionRaw {
  id: string;
  text: string;
  authorId: string;
  authorHandle: string;
  conversationId: string;
  /** photo URLs attached to the mention itself */
  photos: string[];
}

/** The bot's own numeric id, needed for the mentions endpoint. */
export async function selfId(creds: XCreds): Promise<{ id: string; username: string }> {
  const d = await call(creds, 'GET', `${API}/2/users/me`);
  return { id: String(d?.data?.id || ''), username: String(d?.data?.username || '') };
}

/**
 * Mentions newer than `sinceId`.
 *
 * Deliberately NO `expansions` beyond the media attached to the mention: X
 * bills per resource returned, and a spam mention is usually a reply, so
 * expanding referenced posts pays the non-owned rate on every one of them
 * before any gate has run.
 */
export async function fetchMentions(
  creds: XCreds,
  userId: string,
  sinceId?: string,
  max = 20
): Promise<XMentionRaw[]> {
  const query: Record<string, string> = {
    max_results: String(Math.max(5, Math.min(100, max))),
    'tweet.fields': 'author_id,conversation_id,attachments',
    expansions: 'author_id,attachments.media_keys',
    'user.fields': 'username',
    'media.fields': 'url,type',
  };
  if (sinceId) query.since_id = sinceId;

  const d = await call(creds, 'GET', `${API}/2/users/${encodeURIComponent(userId)}/mentions`, query);
  const users = new Map<string, string>(
    (d?.includes?.users || []).map((u: any) => [String(u.id), String(u.username)])
  );
  const media = new Map<string, any>(
    (d?.includes?.media || []).map((m: any) => [String(m.media_key), m])
  );

  return (d?.data || []).map((t: any) => ({
    id: String(t.id),
    text: String(t.text || ''),
    authorId: String(t.author_id || ''),
    authorHandle: users.get(String(t.author_id)) || '',
    conversationId: String(t.conversation_id || t.id),
    photos: (t.attachments?.media_keys || [])
      .map((k: string) => media.get(String(k)))
      .filter((m: any) => m && m.type === 'photo' && m.url)
      .map((m: any) => String(m.url)),
  }));
}

/** Upload image bytes, returning a media id usable on a reply. */
export async function uploadMedia(creds: XCreds, bytes: Buffer, mime: string): Promise<string> {
  // v1.1 upload is multipart and NOT signed over the body.
  const boundary = '----sage' + crypto.randomBytes(8).toString('hex');
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="art"\r\n` +
      `Content-Type: ${mime}\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([head, bytes, tail]);

  const r = await fetch(UPLOAD, {
    method: 'POST',
    headers: {
      authorization: authHeader(creds, 'POST', UPLOAD),
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });
  const text = await r.text();
  if (!r.ok) {
    console.error('x media upload failed', r.status, text.slice(0, 300));
    throw new Error(`media upload failed (${r.status})`);
  }
  const id = JSON.parse(text)?.media_id_string;
  if (!id) throw new Error('media upload returned no id');
  return String(id);
}

/**
 * Reply to a tweet.
 *
 * X blocks API replies unless the account was SUMMONED — the original author
 * must have @mentioned us or quoted one of our posts. Every reply this bot
 * sends is to a mention, so that holds by construction; a 403 here means the
 * gate let through something that was not actually a summons.
 */
export async function postReply(
  creds: XCreds,
  inReplyTo: string,
  text: string,
  mediaIds: string[] = []
): Promise<{ id: string; dryRun: boolean }> {
  const trimmed = text.slice(0, 275);
  if (!isLive()) {
    console.log(`[x dry-run] reply to ${inReplyTo}${mediaIds.length ? ' (+media)' : ''}: ${trimmed}`);
    return { id: 'dryrun', dryRun: true };
  }
  const body: any = { text: trimmed, reply: { in_reply_to_tweet_id: inReplyTo } };
  if (mediaIds.length) body.media = { media_ids: mediaIds };
  const d = await call(creds, 'POST', `${API}/2/tweets`, {}, body);
  return { id: String(d?.data?.id || ''), dryRun: false };
}
