#!/usr/bin/env node
// SAGE Social activity drip — keeps testnet alive until the real launch.
//
// A cast of 50 bot accounts, HD-derived from SOCIAL_DRIP_SEED (no key files),
// joins through the real invite tree and then keeps a human-looking pulse on
// the network: a few posts per tick, likes/replies/reposts/follows/DMs
// clustered around them, and an occasional "viral burst" where one post
// catches fire. Designed to run every ~10 minutes from launchd/cron; each
// run is stateless, short, and entirely off-chain (no gas).
//
// Env (required): SOCIAL_DRIP_SEED (mnemonic), POINTS_ORACLE_PK (root inviter)
// Env (optional): SOCIAL_DRIP_SITE (default https://testnet.sageart.xyz),
//                 SOCIAL_DRIP_CAST (default 50), SOCIAL_DRIP_NO_JITTER=1
//
// SAFETY: refuses to run against production. Synthetic activity is a testnet
// warm-up tool, never a prod growth hack.
import { ethers } from 'ethers';
import { SiweMessage } from 'siwe';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SITE = (process.env.SOCIAL_DRIP_SITE || 'https://testnet.sageart.xyz').replace(/\/+$/, '');
const CAST_SIZE = Number(process.env.SOCIAL_DRIP_CAST || 50);
const CHAIN_ID = 46630;
const SEED = process.env.SOCIAL_DRIP_SEED;
// root inviter key: env, or read in place from the repo's own .env (never
// copied elsewhere)
const ROOT_PK =
  process.env.POINTS_ORACLE_PK ||
  (() => {
    try {
      const repoEnv = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
      return fs.readFileSync(repoEnv, 'utf8').match(/^POINTS_ORACLE_PK=(.+)$/m)?.[1]?.trim();
    } catch {
      return undefined;
    }
  })();

if (/^https?:\/\/(www\.)?sageart\.xyz/.test(SITE)) {
  console.error('drip: refusing to run against production');
  process.exit(1);
}
if (!SEED || !ROOT_PK) {
  console.error('drip: SOCIAL_DRIP_SEED and POINTS_ORACLE_PK are required');
  process.exit(1);
}

// ── the cast: deterministic wallets + stable personas ──
const hd = ethers.utils.HDNode.fromMnemonic(SEED);
const ADJ = ['velvet','static','molten','hollow','prism','borrowed','late','feverish','glass','sunken','minor','patient','crooked','vivid','plain','northern','silent','double','paper','honest','lucid','broke','golden','soft','wild'];
const NOUN = ['horizon','minter','easel','archive','sketch','pigment','vertex','copyist','muralist','draft','patina','impasto','print','crop','study','field','varnish','stroke','carver','frame','still','tone','glaze','salon','atelier'];
const cast = Array.from({ length: CAST_SIZE }, (_, i) => {
  const node = hd.derivePath(`m/44'/60'/0'/0/${i}`);
  const name = `${ADJ[i % ADJ.length]}_${NOUN[Math.floor(i / ADJ.length + i * 7) % NOUN.length]}${i >= 25 ? i : ''}`;
  return { wallet: new ethers.Wallet(node.privateKey), name };
});

// ── content pools ──
const POSTS = [
  'gm from the drip. the feed never sleeps',
  'collected two posts before coffee. the brutalist cards go hard',
  'my pixels finally bought something — points-collect is the killer feature',
  'watching the leaderboard like it owes me money',
  'launched nothing today. respected the no-dump toggle anyway',
  'the curve giveth and the curve taketh away',
  'somebody boost something, the top of the feed is getting comfortable',
  'unpopular opinion: the light theme is the best theme',
  'tipped an artist 5 SAGE and felt like a medici',
  'alpha chat was cooking last night. get verified or miss it',
  'every invite code I drop is gone in an hour. growth is real',
  'if your pfp is not verified I am simply not reading the post',
  'the SVG card designs alone are worth the checkmark',
  'testnet is a vibe. mainnet is a promise',
  'who else refreshes their own profile. be honest',
  'edition mints where 99% goes to the artist — the math finally respects the work',
  'a post you collect is a post you keep',
  'the ticker moves faster than my group chat',
  'gm. wallet is the handle. sign and go',
  'today I followed ten artists and got allowlisted twice. follow-gates work',
  'DMed a stranger about their post. wallet-to-wallet feels different',
  'the migration reserve is just sitting there waiting for a DEX. patience',
  'creator fees streaming on every trade. pump economics but make it art',
  'my following feed finally beats global. curation wins',
  'drop your handle. building tomorrow’s follow list tonight',
];
const REPLIES = ['gm','based','real','collected 🔥','this','chartreuse gang','facts','wagmi','⬡','say it louder','minting this','fair','so true','💚','the feed hears you'];
const VIRAL = [
  'PSA: everything on this feed can be owned. act accordingly',
  'the entire timeline is art and the art is liquid. we are not going back',
  'one year from now you will wish you collected today’s posts. screenshot this',
  'hot take: social + market beats social + ads in every timeline that matters',
];
const DMS = ['yo, your last post deserved more', 'collect my pinned?', 'gm gm', 'that reply thread was gold', 'trade you a boost for a repost', 'alpha chat, now'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// ── combinatorial post generator: thousands of distinct lines so two bots
// almost never post the same thing. A post is opener + take (+ optional tag).
const P_OPEN = [
  'gm.', 'hot take:', 'unpopular opinion:', 'psa:', 'daily:', 'real talk —',
  'note to self:', 'shower thought:', 'ok but', 'genuinely,', 'not financial advice but',
  'been thinking —', 'reminder:', 'low-key,', 'watching the feed and', 'three coffees in and',
];
const P_TAKE = [
  'wallet-native social was the missing primitive',
  'a post you collect is a post you keep',
  'the checkmark means something when it costs real money',
  'tipping culture will out-earn ad culture for small artists',
  'the brutalist collect cards are unreasonably clean',
  'points-collect is the feature nobody saw coming',
  'my pixels finally do something around here',
  'the hot feed rewards good posts, not just new ones',
  'boosts fade — as they should. no permanent front page',
  'the leaderboard is proof-of-taste',
  'follow-to-allowlist is the quietest growth hack on this chain',
  'editions where 99% goes to the artist just feel correct',
  'the ticker moves faster than my group chat',
  'curation beats the algorithm when the algorithm is this legible',
  'every share is a storefront now',
  'owning the moment beats screenshotting it',
  'the following feed finally beats the global one',
  'launching a coin should be free and it is',
  'testnet is a vibe, mainnet is a promise',
  'art + market in one timeline is the whole thesis',
  'no email, no password, just keys — this is the way',
  'my invite tree is three layers deep already',
  'DMs behind the checkmark killed the spam overnight',
  'the migration reserve is just patience with a countdown',
  'chartreuse is a personality type at this point',
];
const P_TAG = ['🌱', '⬡', '💚', '🔥', 'gm', 'wagmi', 'onchain', '', '', '', ''];
// remember recent lines across ticks so we don't repeat network-wide
const recentPosts = new Set();
function uniquePost() {
  for (let tries = 0; tries < 40; tries++) {
    const open = pick(P_OPEN);
    const take = pick(P_TAKE);
    const tag = pick(P_TAG);
    const text = `${open} ${take}${tag ? ' ' + tag : ''}`.trim();
    if (!recentPosts.has(text)) {
      recentPosts.add(text);
      if (recentPosts.size > 400) recentPosts.delete(recentPosts.values().next().value);
      return text;
    }
  }
  // fallback: force uniqueness with a nonce fragment
  return `${pick(P_OPEN)} ${pick(P_TAKE)} · ${Math.random().toString(36).slice(2, 6)}`;
}

// ── minimal SIWE session (same flow the app uses) ──
class Session {
  constructor(wallet, name) { this.wallet = wallet; this.name = name; this.jar = {}; }
  cookies() { return Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; '); }
  absorb(res) {
    for (const c of (res.headers.getSetCookie ? res.headers.getSetCookie() : [])) {
      const [pair] = c.split(';'); const i = pair.indexOf('=');
      this.jar[pair.slice(0, i)] = pair.slice(i + 1);
    }
  }
  async signIn() {
    let res = await fetch(`${SITE}/api/auth/csrf`); this.absorb(res);
    const { csrfToken } = await res.json();
    const msg = new SiweMessage({
      domain: new URL(SITE).host, address: this.wallet.address,
      statement: 'I accept the SAGE Terms of Service and Privacy Policy.',
      uri: SITE, version: '1', chainId: CHAIN_ID, nonce: csrfToken, issuedAt: new Date().toISOString(),
    });
    const signature = await this.wallet.signMessage(msg.prepareMessage());
    let url = `${SITE}/api/auth/callback/credentials?`;
    const body = new URLSearchParams({ message: JSON.stringify(msg), signature, redirect: 'false', csrfToken, callbackUrl: SITE, json: 'true' }).toString();
    for (let hop = 0; hop < 3; hop++) {
      const cb = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: this.cookies() }, body, redirect: 'manual' });
      this.absorb(cb);
      if (cb.status === 307 || cb.status === 308) { url = new URL(cb.headers.get('location'), SITE).href; continue; }
      break;
    }
    if (!this.jar['next-auth.session-token'] && !this.jar['__Secure-next-auth.session-token'])
      throw new Error(`siwe failed: ${this.name}`);
    await fetch(`${SITE}/api/user/`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: this.cookies() }, body: '{}' }).catch(() => {});
  }
  async api(action, body) {
    const res = await fetch(`${SITE}/api/social/?action=${action}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: this.cookies() },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || String(res.status));
    return data;
  }
  async get(pathq) {
    const res = await fetch(`${SITE}${pathq}`, { headers: { Cookie: this.cookies() } });
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  }
  async profile(fields) {
    await fetch(`${SITE}/api/user/`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: this.cookies() }, body: JSON.stringify({ user: fields }) }).catch(() => {});
  }
}

// ── one tick ──
async function tick() {
  // organic pacing: start at a random point in the interval window
  if (!process.env.SOCIAL_DRIP_NO_JITTER) {
    await new Promise((r) => setTimeout(r, Math.random() * 30_000));
  }
  const stats = { joined: 0, posts: 0, replies: 0, likes: 0, reposts: 0, follows: 0, dms: 0, viral: 0, failures: 0 };

  // this tick's troupe: ~12 random cast members
  const troupe = [...cast].sort(() => Math.random() - 0.5).slice(0, 20)
    .map((c) => new Session(c.wallet, c.name));
  const live = [];
  for (const s of troupe) {
    try { await s.signIn(); live.push(s); } catch { stats.failures++; }
  }
  if (!live.length) throw new Error('no sessions — is the site up?');

  // lazy onboarding: at most 8 joins per tick so the cast ramps up organically
  let codePool = null;
  let joinsLeft = 20;
  for (const s of live) {
    if (joinsLeft <= 0) break;
    try {
      const me = await s.get(`/api/social/?action=GetProfile&address=${s.wallet.address}`);
      if (!me.needsInvite) continue;
      if (!codePool) {
        const root = new Session(new ethers.Wallet(ROOT_PK), 'root');
        await root.signIn();
        const inv = await root.get('/api/social/?action=GetMyInvites');
        codePool = inv.invites.flatMap((i) => Array(Math.max(0, i.maxUses - i.uses)).fill(i.code));
      }
      const code = codePool.shift();
      if (!code) break;
      await s.api('RedeemInvite', { code });
      const persona = cast.find((c) => c.wallet.address === s.wallet.address);
      // artsy generative avatar (DiceBear, CC0, deterministic per wallet)
      const style = ['shapes', 'glass', 'rings', 'thumbs'][
        Math.abs([...s.wallet.address].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % 4
      ];
      const pfp = `https://api.dicebear.com/9.x/${style}/png?seed=${s.wallet.address}&size=400&backgroundType=gradientLinear,solid`;
      await s.profile({
        username: persona?.name,
        bio: pick(['here for the art', 'collector', 'gm only', '', 'points maxi']) || null,
        profilePicture: pfp,
      });
      stats.joined++; joinsLeft--;
      // a joined member's own code feeds the pool for the rest of the ramp
      try {
        const inv = await s.get('/api/social/?action=GetMyInvites');
        for (const c of inv.invites) codePool.push(...Array(Math.max(0, c.maxUses - c.uses)).fill(c.code));
      } catch {}
    } catch { stats.failures++; }
  }
  const active = [];
  for (const s of live) {
    try {
      const me = await s.get(`/api/social/?action=GetProfile&address=${s.wallet.address}`);
      if (!me.needsInvite) active.push(s);
    } catch {}
  }
  if (!active.length) { console.log('drip: no active members yet', JSON.stringify(stats)); return; }

  const attempt = async (fn) => { try { await fn(); } catch { stats.failures++; } };

  // fresh posts (1-3)
  const newPosts = [];
  const nPosts = 5 + Math.floor(Math.random() * 6); // 5-10 posts/tick (~50% slower)
  for (let i = 0; i < nPosts; i++) {
    await attempt(async () => {
      const author = pick(active);
      const r = await author.api('CreatePost', { text: uniquePost() });
      newPosts.push(r.post.id); stats.posts++;
    });
  }

  // read the feed once — engagement targets mix fresh + recent posts
  const feed = await active[0].get('/api/social/?action=GetFeed&scope=global');
  const targets = [...newPosts, ...feed.posts.slice(0, 12).map((p) => p.id)];
  const hot = () => targets[Math.floor(Math.pow(Math.random(), 2) * targets.length)];

  // baseline engagement
  for (let i = 0; i < 40 + Math.floor(Math.random() * 40); i++)
    await attempt(async () => { await pick(active).api('ToggleLike', { postId: hot() }); stats.likes++; });
  for (let i = 0; i < 12 + Math.floor(Math.random() * 12); i++)
    await attempt(async () => { await pick(active).api('CreatePost', { text: pick(REPLIES), replyToId: hot() }); stats.replies++; });
  for (let i = 0; i < 8 + Math.floor(Math.random() * 10); i++)
    await attempt(async () => { await pick(active).api('ToggleRepost', { postId: hot() }); stats.reposts++; });
  for (let i = 0; i < 10 + Math.floor(Math.random() * 10); i++)
    await attempt(async () => {
      const from = pick(active); const to = pick(cast);
      if (from.wallet.address === to.wallet.address) return;
      await from.api('ToggleFollow', { address: to.wallet.address }); stats.follows++;
    });
  if (Math.random() < 0.5)
    await attempt(async () => {
      const from = pick(active); const to = pick(active);
      if (from === to) return;
      await from.api('SendMessage', { to: to.wallet.address, text: pick(DMS) }); stats.dms++;
    });

  // ~12% of ticks: a viral moment
  if (Math.random() < 0.35) {
    await attempt(async () => {
      const star = pick(active);
      // dedup viral lines network-wide too (only 4 of them)
      let vtext = pick(VIRAL);
      if (recentPosts.has(vtext)) vtext = `${vtext} — ${Math.random().toString(36).slice(2, 6)}`;
      else recentPosts.add(vtext);
      const r = await star.api('CreatePost', { text: vtext });
      stats.viral = 1;
      for (const s of active) {
        await attempt(async () => { await s.api('ToggleLike', { postId: r.post.id }); stats.likes++; });
        if (Math.random() < 0.5)
          await attempt(async () => { await s.api('CreatePost', { text: pick(REPLIES), replyToId: r.post.id }); stats.replies++; });
      }
    });
  }

  console.log(`drip ${new Date().toISOString()} ${JSON.stringify(stats)}`);
}

tick().catch((e) => { console.error('drip failed:', e.message); process.exit(1); });
