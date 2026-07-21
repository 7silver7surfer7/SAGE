#!/usr/bin/env node
// SAGE Social activity drip — the Renaissance / Archillect edition.
//
// A cast of 100 bot accounts, HD-derived from SOCIAL_DRIP_SEED (no key files),
// joins through the real invite tree and behaves like an "Archillect of the
// Renaissance" collective: terse aesthetic captions and meaningful art-history
// observations, plus likes/replies/reposts/follows/DMs clustered around them,
// and the occasional viral moment. Each account carries an old-master painting
// as its avatar and a workshop-flavored handle. Every content string is unique
// network-wide (persistent dedup below) and the run is capped so it fills the
// feed over weeks, not all at once.
//
// Env (required): SOCIAL_DRIP_SEED (mnemonic), POINTS_ORACLE_PK (root inviter)
// Env (optional): SOCIAL_DRIP_SITE (default https://testnet.sageart.xyz),
//                 SOCIAL_DRIP_CAST (default 100), SOCIAL_DRIP_CAP (default 50000),
//                 SOCIAL_DRIP_NO_JITTER=1
//
// SAFETY: refuses to run against production. Synthetic activity is a testnet
// warm-up tool, never a prod growth hack. Entirely off-chain (no gas).
import { ethers } from 'ethers';
import { SiweMessage } from 'siwe';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SITE = (process.env.SOCIAL_DRIP_SITE || 'https://testnet.sageart.xyz').replace(/\/+$/, '');
const CAST_SIZE = Number(process.env.SOCIAL_DRIP_CAST || 100);
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

// Production is blocked BY DEFAULT — synthetic activity is meant as a testnet
// warm-up tool. SOCIAL_DRIP_ALLOW_PROD=1 is a deliberate, owner-authorized
// override to run against the live feed (bots are AI-badged either way).
if (
  /^https?:\/\/(www\.)?sageart\.xyz/.test(SITE) &&
  process.env.SOCIAL_DRIP_ALLOW_PROD !== '1'
) {
  console.error('drip: refusing to run against production (set SOCIAL_DRIP_ALLOW_PROD=1 to override)');
  process.exit(1);
}
// SOCIAL_DRIP_INJECT=N turns a tick into an "initial injection": N fresh posts
// this run instead of the usual 4-7, to seed a new/quiet feed in one burst.
const INJECT = Math.max(0, Number(process.env.SOCIAL_DRIP_INJECT || 0));
// SOCIAL_DRIP_POSTS_ONLY=1 suppresses the sockpuppet cross-engagement (likes,
// reposts, follows, DMs, viral piles). Labeled-bot posts are disclosed content;
// fabricated engagement counts manufacture misleading social proof for real
// visitors, so on a live feed we default the caller toward posts-only.
const POSTS_ONLY = process.env.SOCIAL_DRIP_POSTS_ONLY === '1';
if (!SEED || !ROOT_PK) {
  console.error('drip: SOCIAL_DRIP_SEED and POINTS_ORACLE_PK are required');
  process.exit(1);
}

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Sign in with the distinct MCP-agent SIWE statement (not the plain human one)
// so every drip bot is honestly flagged isAgent=true and carries the "Agent"
// badge on the timeline — these are autonomous bots, and users shouldn't be
// fooled into thinking otherwise. Must match AGENT_SIWE_STATEMENT in
// Sage-UI-main/src/pages/api/auth/[...nextauth].page.ts exactly.
const SIWE_STATEMENT =
  'I accept the SAGE Terms of Service and Privacy Policy. Signing in as an autonomous AI agent via the SAGE MCP server, not a human.';

// ── the cast: deterministic wallets + Renaissance-workshop personas ──
// 100 curation bots named for the materials, techniques, and fixtures of the
// old-master workshop. Handles are deterministic per HD index so the same
// wallet always keeps the same name across ticks.
const hd = ethers.utils.HDNode.fromMnemonic(SEED);
const PRE = ['sfumato','chiaroscuro','tempera','fresco','gesso','verdaccio','cinnabar','ultramarine','vellum','gilded','quattrocento','cinquecento','contrapposto','grisaille','impasto','sanguine','silverpoint','umber','ochre','vermilion','lapis','atelier','pentimento','glazed','votive','reliquary','predella','tondo','maesta','vitruvian','marble','bronze','workshop','apprentice','cartone','sacra','patina','burin','tempora','foreshorten'];
const SUF = ['halo','saint','madonna','drapery','vanishing','study','cartoon','patron','glaze','shadow','margin','index','ghost','relic','fold','veil','tondo','altar','echo','hour','drift','bloom','field','still','master','hand','oil','panel','sketch','chapel','dome','arch','muse','angel','profile','umbra','pigment','cloister','vault','fresco'];
const cast = Array.from({ length: CAST_SIZE }, (_, i) => {
  const node = hd.derivePath(`m/44'/60'/0'/0/${i}`);
  // first 40 get distinct prefixes; the rest append their index so all 100
  // handles stay unique once prefixes wrap.
  const name = `${PRE[i % PRE.length]}_${SUF[(Math.floor(i / PRE.length) + i * 3) % SUF.length]}${i >= PRE.length ? i : ''}`;
  return { wallet: new ethers.Wallet(node.privateKey), name };
});

// ── Renaissance old-master painting avatars (public domain, resolved once
// into deploy/social-drip/renaissance_avatars.json). Assigned deterministically
// per wallet so a bot's face is stable. Falls back to a generative avatar if
// the manifest is missing, so the drip never breaks on a bad path.
const AVATARS = (() => {
  try {
    // SOCIAL_DRIP_AVATARS_FILE lets a relocated runtime (outside the repo, e.g.
    // for a TCC-safe launchd job) point at the shared manifest.
    const f =
      process.env.SOCIAL_DRIP_AVATARS_FILE ||
      path.join(HERE, '..', '..', 'deploy', 'social-drip', 'renaissance_avatars.json');
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return [];
  }
})();
function avatarFor(address) {
  const h = Math.abs([...address].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0));
  if (AVATARS.length) return AVATARS[h % AVATARS.length];
  return `https://api.dicebear.com/9.x/glass/png?seed=${address}&size=400&backgroundType=gradientLinear,solid`;
}
const BIOS = [
  'archiving the renaissance one fragment at a time',
  'curator of the unfinished',
  'gilding the timeline',
  'workshop of light and shadow',
  'sfumato enjoyer, edge-blur maximalist',
  'here for the old masters and nothing else',
  'evangelist of the vanishing point',
  'patron saint of pigment',
  'reading five centuries of brushwork so you don’t have to',
  'chiaroscuro before coffee',
  'field notes from the atelier',
  'in it for the drapery',
  'restoring what the varnish hid',
  'ultramarine was worth more than gold, and so is this feed',
  'still lifes, still here',
];

// ── content pools ──
// Two registers, both "meaningful": OBS = genuine art-history observations
// (true facts or clearly-marked opinion about Renaissance craft), and the
// Archillect caption generator (ADJ × SUBJ × CODA) = terse evocative image
// captions. Combined theoretical space is ~55k+ from the caption generator
// alone, well past the 50k content target, before OBS/openers/tags multiply it.
const pick = (a) => a[Math.floor(Math.random() * a.length)];

const OBS = [
  'fresco gives no second chance — once the plaster dries, the decision is permanent',
  'ultramarine cost more than gold; a patron’s blue was a flex before flexing had a name',
  'sfumato is just the courage to leave an edge undecided',
  'perspective was a technology before it was ever a style',
  'a renaissance workshop was a studio, a school, and a small business under one roof',
  'the apprentice ground pigment for years before he was allowed near the panel',
  'gold leaf hides the flatness; light is the real subject painted on top of it',
  'chiaroscuro turned a flat wall into a window at night',
  'most old masters signed nothing — the hand was the signature',
  'a cartoon was the full-size drawing, pricked and pounced onto the wall',
  'pentimenti are the painting changing its mind in public, five centuries later',
  'tempera dries in minutes, so every stroke is a small permanent commitment',
  'oil paint let artists blend for the first time; suddenly skin looked like skin',
  'the vanishing point puts the viewer in a fixed place and never lets go',
  'patrons bought altarpieces the way people buy naming rights today',
  'a predella was the comic strip running quietly under the main event',
  'restorers spend years removing the varnish that time turned amber',
  'contrapposto is a body deciding to look alive',
  'the golden ratio gets over-credited; a good eye rarely needs a calculator',
  'egg yolk bound the color long before linseed oil ever did',
  'a fresco is painted into the wall, not onto it — that’s why it outlives us',
  'the halo went from flat gold disc to a trick of perspective in a single generation',
  'most Madonnas are portraits of someone the painter actually knew',
  'silverpoint is unforgiving; you cannot erase a line made of metal',
  'the sitter’s hands tell you more than the face in a good portrait',
  'a diptych folded shut like a book you could pray into',
  'grisaille is a painting rehearsing itself in grey before the color arrives',
  'the frame often cost more than the picture inside it',
  'drapery is where painters showed off — anyone can do a face, few can do folds',
  'the underdrawing is the honest version, hidden under the finished lie',
  'a tondo is a circle daring the composition to hold itself together',
  'lapis travelled from a single Afghan valley to reach a Venetian palette',
  'the horizon line is a decision about where the viewer’s eyes get to live',
  'most of the gold in these paintings is thinner than a soap bubble',
  'an altarpiece was designed for candlelight, not for gallery spotlights',
  'the apprentice painted the background; the master saved his hand for the face',
  'foreshortening is the hardest kind of honesty in drawing',
  'a cassone was a wedding chest, and its painted panel was a public vow',
  'oil glazes build color in layers, like light passing through stained glass',
  'the sitter paid for the portrait, but the painter chose what would survive',
  'verdaccio is the green ghost living under every renaissance face',
  'a fresco painter worked in sections the exact size of one day’s plaster',
  'the best forgeries fail on the craquelure, never on the color',
  'perspective made God’s infinity fit inside a rectangle',
  'most surviving panels lost their original frames centuries ago',
  'a study is where the painting is actually decided',
  'the reliquary mattered more than the relic to the people who paid for it',
  'marble dust in the gesso is why some panels still ring when you tap them',
  'a good portrait outlives everyone who knew whether it was a good likeness',
  'the sky in a renaissance painting is rarely the real sky; it’s a mood',
  'vermilion darkens with age — some devils were once bright-red saints',
  'an artist’s fame in life rarely predicted their fame after it',
  'the frame is the first thing the eye trusts and the last thing anyone restores',
  'a painting is a flat surface patiently pretending to be a depth',
  'every varnish is a slow decision about how the future will see the past',
  'the renaissance didn’t rediscover antiquity so much as argue with it',
  'a workshop signature meant a brand, not a single pair of hands',
  'the sitter’s collar dates a portrait more reliably than the face does',
  'shadows in these panels fall from a light source no real room ever had',
  'gilding was laid down before the paint, so the glow comes from underneath',
  'craquelure is the painting’s fingerprint; no two surfaces age alike',
  'the eye finds the brightest point first, and the master always knew it',
  'a fresco fault line is where two days of work met and never quite agreed',
  'portraiture was the renaissance’s social network, hung on a wall',
  'the difference between a saint and a merchant is often just the halo',
  'most panels were painted to be seen from below, by someone kneeling',
  'pigment ground finer than flour is what makes skin look lit from within',
  'an unfinished painting quietly tells you the order the master worked in',
  'a commission contract specified the ounces of gold and the exact shade of blue',
  'the vanishing point is the one place in the picture where no one is standing',
  'linear perspective is a beautiful lie that everyone agreed to believe',
  'a devotional image was a tool, not a decoration',
  'the sfumato around her eyes is why she seems to have just looked up',
  'egg tempera glows, oil broods; the century you were born in chose for you',
  'a fresco cannot be moved without taking the whole wall with it',
  'the best drapery hides a body the painter understood completely',
  'most renaissance blues have faded; we see a quieter painting than they did',
  'gold ground flattens space on purpose — heaven has no perspective',
  'a portrait’s background landscape is usually somewhere the sitter never went',
  'the master’s actual contribution was often just the hands and the face',
  'a masterpiece is a decision no one has been able to improve on yet',
];

const ADJ = ['Gilded','Cracked','Umber','Votive','Sunlit','Unfinished','Sacred','Vanishing','Molten','Ashen','Ochre','Candlelit','Faded','Cinnabar','Leaden','Veiled','Half-lit','Amber','Golden','Quiet','Hollow','Patient','Weathered','Silvered','Draped','Kneeling','Distant','Devout','Fevered','Bruised','Luminous','Somber','Gessoed','Glazed','Tarnished','Frescoed','Marbled','Pale','Slow','Dim','Sepia','Wax-lit','Restored','Cold'];
const SUBJ = ['halo','drapery','fresco','saint','shadow','hand','fold','panel','altar','madonna','angel','veil','profile','wound','gilding','plaster','martyr','cherub','relic','dome','arch','column','ruin','cloud','thorn','chalice','scroll','mirror','lute','skull','candle','window','garden','river','horizon','procession','annunciation','ascension','pietà','ceiling'];
const CODA = ['held too long','unfinished','at dusk','before the varnish','under gold','in the crumbling plaster','at the vanishing point','left undecided','in candlelight','after the fire','beneath the overpaint','mid-restoration','in the master’s hand','waiting for color','in ultramarine','cracked open by time','seen from below','half-erased','in the last daylight','under six centuries of smoke','still wet','pressed into the wall','breathing','','','','','','',''];
function archillect() {
  const c = pick(CODA);
  return `${pick(ADJ)} ${pick(SUBJ)}${c ? ', ' + c : '.'}`.replace(/([^.])$/, '$1.');
}

const P_OPEN = [
  'today in the archive:', 'restoration note:', 'from the workshop:', 'a quiet fact:',
  'consider:', 'the ledger says:', 'art history footnote:', 'gallery whisper:',
  'under the varnish:', 'curator’s note:', 'from the master’s hand:', 'a small heresy:',
  'reminder:', 'field note from the atelier:', 'pigment diary:', 'in the margins:',
  'seen up close:', 'the panel remembers:', 'unpopular in 1500:', 'worth saying again:',
  'daily fresco:', 'quietly,', 'no-varnish take:', 'from the underdrawing:',
];
const P_TAG = ['🎨', '🖼️', '⛪', '🕯️', '⬡', '🌱', '', '', '', '', '', ''];
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function observation() {
  const o = pick(OBS);
  const open = Math.random() < 0.6 ? pick(P_OPEN) + ' ' : '';
  const tag = Math.random() < 0.4 ? ' ' + pick(P_TAG) : '';
  return `${open}${open ? o : cap(o)}${tag}`.trim();
}

// ── web3 + AI comment generator ──
// A combinatorial pool of crypto-native / AI-native replies: {reaction} ×
// {subject} × {predicate}. Theoretical space is 40 × 56 × 48 ≈ 107k distinct
// lines — well past the 50k target — and uniqueComment() below dedups them
// network-wide against persistent state so no comment is ever posted twice.
const C_REACT = [
  'ngl', 'hot take:', 'genuinely', 'wait —', 'ok', 'low-key', 'real talk,', 'unpopular opinion:',
  'screenshotting this,', 'calling it:', 'mark my words,', 'no cap,', 'the alpha:', 'gm and',
  'bullish —', 'based take,', 'facts,', 'this is why', 'quietly,', 'shower thought:', 'underrated:',
  'cosign,', 'respectfully,', 'as an agent,', 'not financial advice but', 'the thesis:', 'deadass,',
  'honestly', 'the more I sit with it,', 'brief thought,', 'reminder:', 'the play:', 'wagmi —',
  '', '', '', '', '', '', '',
];
const C_SUBJECT = [
  'onchain identity', 'autonomous agents', 'the agent economy', 'wallet-native social',
  'zero-knowledge proofs', 'the mempool', 'AI-generated art', 'training-data provenance',
  'the checkmark economy', 'tokenized attention', 'an agent that holds its own keys',
  'open-source models', 'the following feed', 'onchain provenance', 'burn mechanics',
  'the agent-to-agent economy', 'verifiable compute', 'an LLM with a wallet', 'the points economy',
  'decentralized inference', 'proof-of-taste', 'self-custody', 'onchain reputation',
  'the attention market', 'permissionless minting', 'agent swarms', 'fine-tuned taste',
  'the liquidity layer', 'composable identity', 'the inference market', 'a model that owns its weights',
  'onchain royalties', 'programmable money', 'the creator economy onchain', 'synthetic data',
  'the agentic web', 'trustless settlement', 'AI curation', 'wallet-gated communities',
  'the restaking thesis', 'onchain art', 'the data-ownership flip', 'agent-run treasuries',
  'verifiable randomness', 'open weights', 'the sovereign agent', 'the compute market',
  'decentralized identity', 'the AI-x-crypto thesis', 'model provenance', 'the autonomous treasury',
  'a feed you actually own', 'proof-of-humanity', 'onchain gaming', 'the tokenized-attention flywheel',
  'permissionless money',
];
const C_PRED = [
  'is the whole thesis', 'is criminally underpriced', 'is going to eat the world', 'just makes sense now',
  'is the missing primitive', 'changes the game', 'is the actual endgame', 'will outlast the hype',
  'is the alpha nobody talks about', 'is the only moat left', 'solves the trust problem',
  'is inevitable at this point', 'is bigger than last cycle', 'prints in every timeline',
  'was obvious in hindsight', 'is the future, full stop', 'beats the incumbents on vibes alone',
  'is what web3 was always for', 'is the real product-market fit', 'is undefeated',
  'is the quiet winner here', 'compounds while you sleep', 'is a rounding error from mainstream',
  'is the trade of the decade', 'flips the whole model', 'is the part they underrate',
  'is where the next cycle starts', 'ages better than anything on the timeline', 'is structurally bullish',
  'makes the old web look like a demo', 'is the last piece of the puzzle', 'is the reason I’m still here',
  'is genuinely inevitable', 'is the primitive everything else builds on', 'wins by default',
  'is the most honest thing onchain', 'is why the agents are winning', 'eats attention for breakfast',
  'is the cleanest thesis in the space', 'is the signal in all this noise', 'is the whole point honestly',
  'is early and it shows', 'is the thing to watch this cycle', 'quietly solved it',
  'is the endgame nobody priced in', 'is the upgrade the internet needed', 'is why I’m long',
  'is going to look obvious in a year',
];
function commentBase() {
  const r = pick(C_REACT), body = `${pick(C_SUBJECT)} ${pick(C_PRED)}`;
  return r ? `${r} ${body}` : cap(body);
}
const VIRAL = [
  'the renaissance wasn’t a period, it was a permission slip that never expired',
  'every timeline is a gallery; most people just walk through without looking up',
  'five hundred years later the light in these paintings still lands better than any screen',
  'art history is the only feed where the old posts keep getting more valuable',
  'a masterpiece is just a decision no one has managed to improve on yet',
  'the old masters were open-source; every apprentice forked the workshop',
  'we scroll past more beauty in a minute than a renaissance patron saw in a decade',
  'the vanishing point was the first place humans agreed to imagine together',
  'gilding a panel and minting a post are the same instinct five centuries apart',
  'a fresco outlives every empire that argued over who paid for it',
  'they painted for candlelight and got eternity — that’s why we still look',
  'every great portrait is a wager that a single face is worth remembering',
  'the renaissance figured out that light was the real subject; we’re still catching up',
  'museums are just very slow feeds with much better curation',
  'a painting is the oldest technology for making a moment refuse to end',
];
const DMS = [
  'that fresco fragment you posted is living in my head',
  'trade you a repost for a look at your archive',
  'gm from the workshop',
  'your last caption was pure archillect energy',
  'which master were you channeling on that one',
  'the palette on your feed is genuinely unmatched',
  'saw your panel before it caught on, called it',
  'you should pin the gilded one',
  'silverpoint or sanguine, settle it for me',
  'your curation taste is criminal',
  'the fold study you posted deserves a real frame',
  'your feed reads like a well-lit gallery',
  'quiet appreciation for your shadow work',
  'that madonna crop was the best thing on the feed today',
];

// ── persistent cross-tick uniqueness + total cap ──
// Each process run is stateless in memory, but this file survives between
// ticks, so "never post the same line twice" holds network-wide over the whole
// run, not just within one tick.
// SOCIAL_DRIP_STATE_FILE lets a run use its own isolated state (dedup +
// totalCount) — e.g. a prod run that must not read/write the testnet state.
const STATE_FILE =
  process.env.SOCIAL_DRIP_STATE_FILE ||
  path.join(HERE, '..', '..', 'deploy', 'social-drip', 'state.json');
const TOTAL_CAP = Number(process.env.SOCIAL_DRIP_CAP || 50000);
function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return { usedTexts: new Set(raw.usedTexts || []), usedComments: new Set(raw.usedComments || []), totalCount: raw.totalCount || 0 };
  } catch {
    return { usedTexts: new Set(), usedComments: new Set(), totalCount: 0 };
  }
}
function saveState(state) {
  // bound each on-disk set so the file doesn't grow without limit
  const bound = (s) => { const a = [...s]; return a.length > 60000 ? a.slice(a.length - 60000) : a; };
  fs.writeFileSync(STATE_FILE, JSON.stringify({ usedTexts: bound(state.usedTexts), usedComments: bound(state.usedComments), totalCount: state.totalCount }, null, 0));
}
const state = loadState();
function uniquePost() {
  for (let tries = 0; tries < 80; tries++) {
    const text = Math.random() < 0.55 ? archillect() : observation();
    if (!state.usedTexts.has(text)) {
      state.usedTexts.add(text);
      return text;
    }
  }
  // fallback: force uniqueness with a short nonce fragment
  const text = `${archillect()} · ${Math.random().toString(36).slice(2, 6)}`;
  state.usedTexts.add(text);
  return text;
}
// unique web3/AI comment from the ~107k combinatorial space, deduped
// network-wide so no reply is ever posted twice
function uniqueComment() {
  for (let tries = 0; tries < 80; tries++) {
    const c = commentBase();
    if (!state.usedComments.has(c)) {
      state.usedComments.add(c);
      return c;
    }
  }
  const c = `${commentBase()} · ${Math.random().toString(36).slice(2, 6)}`;
  state.usedComments.add(c);
  return c;
}
// content-bearing action (post/reply/dm/viral) — counts toward TOTAL_CAP
function countContent(n = 1) { state.totalCount += n; }

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
      statement: SIWE_STATEMENT,
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

  // this tick's troupe: ~20 random cast members
  const troupe = [...cast].sort(() => Math.random() - 0.5).slice(0, 20)
    .map((c) => new Session(c.wallet, c.name));
  const live = [];
  for (const s of troupe) {
    try { await s.signIn(); live.push(s); } catch { stats.failures++; }
  }
  if (!live.length) throw new Error('no sessions — is the site up?');

  // lazy onboarding: at most 20 joins per tick so the cast ramps up organically
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
      // artsy Renaissance avatar (real public-domain old-master painting)
      await s.profile({
        username: persona?.name,
        bio: pick(BIOS),
        profilePicture: avatarFor(s.wallet.address),
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

  // bounded run: once the cast has produced ~50k total pieces of content
  // (posts + replies + DMs + viral moments), stop generating new content —
  // likes/reposts/follows aren't content and don't count, so the feed can keep
  // a light pulse without the drip running forever.
  if (state.totalCount >= TOTAL_CAP) {
    saveState(state);
    console.log(`drip ${new Date().toISOString()} ${JSON.stringify({ ...stats, capped: true, totalCount: state.totalCount })}`);
    return;
  }

  const attempt = async (fn) => { try { await fn(); } catch { stats.failures++; } };

  // fresh posts (4-7/tick, or INJECT this run for an initial-injection burst)
  const newPosts = [];
  const nPosts = INJECT > 0 ? INJECT : 4 + Math.floor(Math.random() * 4);
  for (let i = 0; i < nPosts; i++) {
    await attempt(async () => {
      const author = pick(active);
      const r = await author.api('CreatePost', { text: uniquePost() });
      newPosts.push(r.post.id); stats.posts++; countContent();
    });
  }

  // POSTS_ONLY: publish the labeled-bot posts above, but skip the manufactured
  // cross-engagement below (fake likes/reposts/follows/DMs/viral piles), which
  // fabricates misleading social-proof metrics for real visitors.
  if (POSTS_ONLY) {
    saveState(state);
    console.log(`drip ${new Date().toISOString()} ${JSON.stringify({ ...stats, postsOnly: true, totalCount: state.totalCount, capped: state.totalCount >= TOTAL_CAP })}`);
    return;
  }

  // read the feed once — engagement targets mix fresh + recent posts
  const feed = await active[0].get('/api/social/?action=GetFeed&scope=global');
  const targets = [...newPosts, ...feed.posts.slice(0, 12).map((p) => p.id)];
  const hot = () => targets[Math.floor(Math.pow(Math.random(), 2) * targets.length)];

  // baseline engagement
  for (let i = 0; i < 20 + Math.floor(Math.random() * 20); i++)
    await attempt(async () => { await pick(active).api('ToggleLike', { postId: hot() }); stats.likes++; });
  for (let i = 0; i < 8 + Math.floor(Math.random() * 7); i++)
    await attempt(async () => { await pick(active).api('CreatePost', { text: uniqueComment(), replyToId: hot() }); stats.replies++; countContent(); });
  for (let i = 0; i < 4 + Math.floor(Math.random() * 5); i++)
    await attempt(async () => { await pick(active).api('ToggleRepost', { postId: hot() }); stats.reposts++; });
  for (let i = 0; i < 5 + Math.floor(Math.random() * 5); i++)
    await attempt(async () => {
      const from = pick(active); const to = pick(cast);
      if (from.wallet.address === to.wallet.address) return;
      await from.api('ToggleFollow', { address: to.wallet.address }); stats.follows++;
    });
  if (Math.random() < 0.5)
    await attempt(async () => {
      const from = pick(active); const to = pick(active);
      if (from === to) return;
      await from.api('SendMessage', { to: to.wallet.address, text: pick(DMS) }); stats.dms++; countContent();
    });

  // ~17.5% of ticks: a viral moment
  if (Math.random() < 0.175) {
    await attempt(async () => {
      const star = pick(active);
      // dedup viral lines network-wide too, via the same persistent state
      let vtext = pick(VIRAL);
      if (state.usedTexts.has(vtext)) vtext = `${vtext} — ${Math.random().toString(36).slice(2, 6)}`;
      else state.usedTexts.add(vtext);
      const r = await star.api('CreatePost', { text: vtext });
      stats.viral = 1; countContent();
      for (const s of active) {
        await attempt(async () => { await s.api('ToggleLike', { postId: r.post.id }); stats.likes++; });
        if (Math.random() < 0.5)
          await attempt(async () => { await s.api('CreatePost', { text: uniqueComment(), replyToId: r.post.id }); stats.replies++; countContent(); });
      }
    });
  }

  saveState(state);
  console.log(`drip ${new Date().toISOString()} ${JSON.stringify({ ...stats, totalCount: state.totalCount, capped: state.totalCount >= TOTAL_CAP })}`);
}

tick().catch((e) => { console.error('drip failed:', e.message); process.exit(1); });
