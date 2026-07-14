import { NextApiRequest, NextApiResponse } from 'next';
import { Role } from '@prisma/client';
import { ethers } from 'ethers';
import { requireRole, getRequester } from '@/utilities/apiAuth';
import { extractFirstUrl, fetchLinkPreview } from '@/utilities/linkPreview';
import prisma from '@/prisma/client';
import { parameters } from '@/constants/config';
import {
  verifySageTransfer,
  verifyPayment,
  verifyEthTransfer,
  mintSocialCollectServerSide,
  addToWhitelistOnChain,
  isWhitelistedOnChain,
  uploadJsonToFilebase,
  signCollectVoucher,
  DEAD_ADDRESS,
  pixelsOf,
  transferPixelsOnChain,
} from '@/utilities/serverWallet';

/**
 * SAGE Social — a wallet-native BlueSky clone. Identity is the SIWE wallet
 * (requester.walletAddress, taken from the JWT — never the query, so it can't
 * be spoofed). Posts can be tipped in SAGE; avatars are the user's NFT pfp.
 *
 * All mutating actions require a signed-in wallet; reads (feeds/profiles) are
 * public so the network is browsable before connecting.
 *
 * Crypto-native mechanics (all SAGE amounts verified on-chain server-side
 * before anything is credited — the client only supplies the tx hash):
 *  - tips: plain SAGE transfer to the author, recorded on the post
 *  - burn-to-boost: SAGE sent to 0x…dEaD pins the post atop the global feed
 *  - collect: pay the author, the server mints the post as an NFT to you
 *  - follow-to-whitelist: following a gated artist adds you to their drop's
 *    on-chain allowlist
 */
const AUTHED: Role[] = [Role.USER, Role.ARTIST, Role.ADMIN];

// burn-to-boost — Twitter-style budget × duration, SOFT. You pick a daily
// budget ($/day) and a number of days; total = daily × days, burned in SAGE.
// The boost is a gentle, SUSTAINED lift in the ranked feed (not a pin and not
// a spike): a bonus that scales with the daily budget and fades linearly over
// the campaign window. Engagement still competes, so a boosted post surfaces
// but can be out-ranked by genuinely popular posts.
const BOOST_DAILY_MIN_USD = 5;
const BOOST_DAILY_MAX_USD = 50;
const BOOST_DAYS_MIN = 1;
const BOOST_DAYS_MAX = 10;
const BOOST_SAGE_PER_USD_FALLBACK = 10; // testnet SAGE has no market
// soft rank bonus at max daily budget & full strength; kept in the same
// ballpark as a strong post's engagement so it lifts without dominating
const BOOST_STRENGTH_MIN = 12; // at $5/day
const BOOST_STRENGTH_MAX = 45; // at $50/day

// ── feed ranking ("hot") — HN-style: engagement + boost, decayed by age ──
// score = (1 + engagement + boostBonus) / (ageHours + 2)^GRAVITY
const FEED_GRAVITY = 1.6;
const FEED_POOL = 600; // rank over the most recent N top-level posts
const FEED_PAGE = 20;

// paid verification: $10 worth of SAGE to the platform treasury buys the
// checkmark + premium features (sell/collect posts, points-collect, boost,
// DMs). Posting stays free. Price is computed live off the SAGE/WETH pair;
// FALLBACK_SAGE covers a dead price feed (testnet SAGE has no real market).
const VERIFICATION_PRICE_USD = 10;
const VERIFICATION_FALLBACK_SAGE = 100;
const VERIFICATION_FALLBACK_ETH = 0.003; // ≈$10 if the ETH/USD feed is down
const TREASURY_ADDRESS = '0x3E099aF007CaB8233D44782D8E6fe80FECDC321e'; // platform multisig

// points-collect: verified users may spend pixels instead of SAGE
const POINTS_PER_SAGE = 100;

// referral economics: every user has exactly ONE invite code — the tier only
// changes how many uses it carries (verified doubles it; admin is unbounded
// in practice).
const INVITE_USES_BASE = 5;
const INVITE_USES_VERIFIED = 10;
const INVITE_USES_ADMIN = 1000;

export default async function handler(request: NextApiRequest, response: NextApiResponse) {
  const { action } = request.query;
  try {
    switch (action) {
      // ---- public reads ----
      case 'GetFeed':
        return await getFeed(request, response);
      case 'GetPost':
        return await getPost(Number(request.query.id), request, response);
      case 'GetUserPosts':
        return await getUserPosts(request.query.address as string, request, response);
      case 'GetProfile':
        return await getProfile(request.query.address as string, request, response);
      case 'GetPostMetadata':
        return await getPostMetadata(Number(request.query.id), response);
      case 'GetVerificationInfo':
        return await getVerificationInfo(response);
      case 'GetBoostInfo':
        return await getBoostInfo(response);
      case 'GetInvite':
        return await getInvite(String(request.query.code || ''), response);
      case 'InviteImage':
        return await inviteImage(String(request.query.code || ''), response);
      case 'GetLeaderboard':
        return await getLeaderboard(response);
      case 'GetUserMints':
        return await getUserMints(String(request.query.address || ''), response);
      case 'GetProfileToken':
        return await getProfileToken(String(request.query.address || ''), response);
      case 'GetTokenDetail':
        return await getTokenDetail(String(request.query.address || ''), response);
      case 'GetTokens':
        return await getTokens(response);
      case 'GetProfileEditions':
        return await getProfileEditions(String(request.query.address || ''), response);
      case 'GetEditionMetadata':
        return await getEditionMetadata(Number(request.query.id), response);
      // alpha group chats were retired in favor of multi-recipient DMs —
      // keep the actions dead, not silently spammable
      case 'GetGroupChat':
      case 'SendGroupMessage':
      case 'ToggleGroupChat':
      case 'KickFromGroupChat':
        return response.status(410).json({ error: 'group chats have been retired' });
      case 'SetProfileImage':
        return await withAuth(request, response, (r) => setProfileImage(request, response, r));
      case 'GetGlobalActivity':
        return await getGlobalActivity(response);
      case 'Search':
        return await search(String(request.query.q || ''), request, response);
      // ---- authed writes ----
      case 'CreatePost':
        return await withAuth(request, response, (r) => createPost(request, response, r));
      case 'ToggleLike':
        return await withAuth(request, response, (r) => toggleLike(request, response, r));
      case 'ToggleRepost':
        return await withAuth(request, response, (r) => toggleRepost(request, response, r));
      case 'ToggleFollow':
        return await withAuth(request, response, (r) => toggleFollow(request, response, r));
      case 'RecordTip':
        return await withAuth(request, response, (r) => recordTip(request, response, r));
      case 'BoostPost':
        return await withAuth(request, response, (r) => boostPost(request, response, r));
      case 'SetCollectible':
        return await withAuth(request, response, (r) => setCollectible(request, response, r));
      case 'CollectPost':
        return await withAuth(request, response, (r) => collectPost(request, response, r));
      case 'GetOwnedNfts':
        return await withAuth(request, response, (r) => getOwnedNfts(response, r));
      case 'SetNftPfp':
        return await withAuth(request, response, (r) => setNftPfp(request, response, r));
      case 'SetFollowGate':
        return await withAuth(request, response, (r) => setFollowGate(request, response, r));
      case 'PurchaseVerification':
        return await withAuth(request, response, (r) => purchaseVerification(request, response, r));
      case 'GetMyInvites':
        return await withAuth(request, response, (r) => getMyInvites(response, r));
      case 'RedeemInvite':
        return await withAuth(request, response, (r) => redeemInvite(request, response, r));
      case 'GetMyFollowing':
        return await withAuth(request, response, (r) => getMyFollowing(response, r));
      case 'GetConversations':
        return await withAuth(request, response, (r) => getConversations(response, r));
      case 'GetMessages':
        return await withAuth(request, response, (r) => getMessages(request, response, r));
      case 'SendMessage':
        return await withAuth(request, response, (r) => sendMessage(request, response, r));
      case 'GetActivity':
        return await withAuth(request, response, (r) => getActivity(response, r));
      case 'ToggleHideItem':
        return await withAuth(request, response, (r) => toggleHideItem(request, response, r));
      case 'RecordTokenLaunch':
        return await withAuth(request, response, (r) => recordTokenLaunch(request, response, r));
      case 'RecordAirdrop':
        return await withAuth(request, response, (r) => recordAirdrop(request, response, r));
      case 'RecordTrade':
        return await withAuth(request, response, (r) => recordTrade(request, response, r));
      case 'RecordEditionLaunch':
        return await withAuth(request, response, (r) => recordEditionLaunch(request, response, r));
      case 'RequestCollectVoucher':
        return await withAuth(request, response, (r) => requestCollectVoucher(request, response, r));
      case 'DeletePost':
        return await withAuth(request, response, (r) => deletePost(request, response, r));
      default:
        return response.status(400).json({ error: 'unknown action' });
    }
  } catch (e: any) {
    console.error('social api error', e);
    return response.status(500).json({ error: e?.message || 'server error' });
  }
}

/**
 * Canonicalizes any address input to its EIP-55 checksummed form — the casing
 * User.walletAddress rows are stored in, so FK writes and findUnique lookups
 * hit. NEVER write a social row with a lowercased address: the FK against the
 * checksummed User PK would reject it.
 */
function canon(address?: string | null): string | null {
  try {
    return ethers.utils.getAddress((address || '').toLowerCase());
  } catch {
    return null;
  }
}

async function withAuth(
  req: NextApiRequest,
  res: NextApiResponse,
  fn: (r: { walletAddress: string; role: Role }) => Promise<void>
) {
  const requester = await requireRole(req, res, AUTHED);
  if (!requester) return; // requireRole already sent 401
  const wallet = canon(requester.walletAddress);
  if (!wallet) return void res.status(400).json({ error: 'bad wallet' });
  await fn({ walletAddress: wallet, role: requester.role });
}

// Shape a post row for the client, folding in the viewer's like/repost state
// and the author's pfp verification (computed in batch, passed via verifiedMap).
/**
 * Lightweight per-wallet rate limiting (in-memory sliding window). Cloud Run
 * keeps an instance warm, so this stops bursts/spam without infra; it is a
 * speed bump, not a hard quota across instances.
 */
const rateBuckets = new Map<string, number[]>();
function rateLimited(wallet: string, action: string, max: number, windowMs = 60_000): boolean {
  const key = `${action}:${wallet}`;
  const now = Date.now();
  const hits = (rateBuckets.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= max) return true;
  hits.push(now);
  rateBuckets.set(key, hits);
  if (rateBuckets.size > 20_000) rateBuckets.clear(); // crude memory cap
  return false;
}

/**
 * Debit pixels via the SagePoints contract: buyer→seller in ONE on-chain tx
 * (transferPoints), signed by the platform controller. The contract streams
 * accrual from live SAGE balances and enforces spendability atomically, so
 * concurrent collects can't overdraw — the chain serializes them.
 * Throws Error('not enough pixels …') or Error('pixels-conflict').
 */
async function debitPixelsAtomic(
  collector: string,
  seller: string,
  postId: number,
  pointsPrice: bigint
): Promise<void> {
  try {
    await transferPixelsOnChain(collector, seller, pointsPrice, `collect:${postId}`);
  } catch (e: any) {
    const msg = String(e?.error?.message || e?.reason || e?.message || '');
    if (/insufficient pixels/i.test(msg)) {
      const have = await pixelsOf(collector).catch(() => null);
      throw new Error(
        `not enough pixels (need ${pointsPrice}${have !== null ? `, have ${have}` : ''})`
      );
    }
    console.error('pixels transfer failed', msg.slice(0, 200));
    throw new Error('pixels-conflict');
  }
}

/** Compensate a debit if the step after it (mint/sign) fails. */
async function refundPixels(
  collector: string,
  seller: string,
  postId: number,
  amount: bigint
): Promise<void> {
  await transferPixelsOnChain(seller, collector, amount, `refund:${postId}`);
}

/**
 * Media/art URLs must point at OUR bucket — a loose *.amazonaws.com match
 * would accept anyone's bucket with a /social/ folder.
 */
function isOwnSocialMediaUrl(url: string): boolean {
  const bucket = process.env.S3_BUCKET;
  if (!bucket || typeof url !== 'string') return false;
  return url.startsWith(`https://${bucket}.s3.`) && url.includes('.amazonaws.com/social/');
}

function serializePost(p: any, viewer?: string | null, verifiedMap?: Record<string, boolean>) {
  return {
    id: p.id,
    text: p.text,
    imageUrl: p.imageUrl,
    mediaType: p.mediaType,
    createdAt: p.createdAt,
    replyToId: p.replyToId,
    likeCount: p.likeCount,
    repostCount: p.repostCount,
    replyCount: p.replyCount,
    tipTotal: p.tipTotal,
    tipTotalEth: p.tipTotalEth,
    boostBurned: p.boostBurned,
    isBoosted: !!(p.boostedUntil && new Date(p.boostedUntil) > new Date()),
    collectPrice: p.collectPrice,
    collectCurrency: p.collectCurrency,
    collectCount: p.collectCount,
    linkUrl: p.linkUrl || null,
    linkTitle: p.linkTitle || null,
    linkDesc: p.linkDesc || null,
    linkImage: p.linkImage || null,
    author: {
      address: p.authorAddress,
      username: p.Author?.username || null,
      profilePicture: p.Author?.profilePicture || null,
      pfpVerified: verifiedMap?.[p.authorAddress] || false,
      verified: !!p.Author?.verifiedAt, // paid checkmark
    },
    likedByViewer: viewer ? (p.Likes?.length ?? 0) > 0 : false,
    repostedByViewer: viewer ? (p.Reposts?.length ?? 0) > 0 : false,
    collectedByViewer: viewer ? (p.Collects?.length ?? 0) > 0 : false,
  };
}

const postInclude = (viewer?: string | null) => ({
  Author: { select: { username: true, profilePicture: true, pfpNftId: true, verifiedAt: true } },
  ...(viewer
    ? {
        Likes: { where: { userAddress: viewer }, select: { userAddress: true } },
        Reposts: { where: { userAddress: viewer }, select: { userAddress: true } },
        Collects: { where: { collectorAddress: viewer }, select: { collectorAddress: true } },
      }
    : {}),
});

/**
 * NFT-pfp verification, computed at read time so it self-heals: verified only
 * while (a) the avatar was picked from an NFT (pfpNftId set), (b) that NFT's
 * image is still the current profilePicture (a custom re-upload un-verifies),
 * and (c) the wallet still owns the NFT (selling it un-verifies).
 */
async function pfpVerifiedMap(posts: any[]): Promise<Record<string, boolean>> {
  const authors = new Map<string, { pfpNftId: number | null; profilePicture: string | null }>();
  for (const p of posts) {
    if (p.Author?.pfpNftId) authors.set(p.authorAddress, p.Author);
  }
  if (authors.size === 0) return {};
  const authorEntries = Array.from(authors.entries());
  const nfts = await prisma.nft.findMany({
    where: { id: { in: authorEntries.map(([, a]) => a.pfpNftId!) } },
    select: { id: true, ownerAddress: true, s3Path: true, s3PathOptimized: true },
  });
  const byId = new Map(nfts.map((n) => [n.id, n]));
  const map: Record<string, boolean> = {};
  for (const [address, a] of authorEntries) {
    const nft = byId.get(a.pfpNftId!);
    map[address] = !!(
      nft &&
      nft.ownerAddress?.toLowerCase() === address.toLowerCase() &&
      (a.profilePicture === nft.s3PathOptimized || a.profilePicture === nft.s3Path)
    );
  }
  return map;
}

/**
 * Referral gate: who may post/interact. Artists, admins, verified users and
 * anyone who redeemed an invite code participate; a brand-new USER wallet can
 * browse and read but the composer asks for an invite code.
 */
async function canParticipate(wallet: string): Promise<boolean> {
  const u = await prisma.user.findUnique({
    where: { walletAddress: wallet },
    select: { role: true, verifiedAt: true, invitedByCode: true },
  });
  if (!u) return false;
  return u.role !== Role.USER || !!u.verifiedAt || !!u.invitedByCode;
}

/** Premium gate: paid checkmark (admins ride free). Sends the 403 itself. */
async function requireVerified(wallet: string, res: NextApiResponse): Promise<boolean> {
  const u = await prisma.user.findUnique({
    where: { walletAddress: wallet },
    select: { role: true, verifiedAt: true },
  });
  // no admin free-ride: the checkmark is PAID for, full stop — admins see the
  // same paywall as everyone (per founder: 'I should be prompted to verify')
  if (u?.verifiedAt) return true;
  res.status(403).json({
    error: 'This is a premium feature — get verified to unlock it',
    needsVerification: true,
  });
  return false;
}

// module-level 5-min cache: the verification price only needs to be roughly
// live, and the SAGE/WETH pair read costs an RPC round-trip
let verificationPriceCache: { sage: number; eth: number; at: number } | null = null;
async function verificationPrices(): Promise<{ sage: number; eth: number }> {
  if (verificationPriceCache && Date.now() - verificationPriceCache.at < 300_000)
    return verificationPriceCache;
  let sage = VERIFICATION_FALLBACK_SAGE;
  let eth = VERIFICATION_FALLBACK_ETH;
  // live $10-worth SAGE pricing only on production — testnet SAGE isn't the
  // token the price feed tracks, and a mispriced feed would quote absurd
  // amounts. The ETH leg (CoinGecko ETH/USD) is real on every network.
  try {
    const priceUtils = await import('@/utilities/sagePrice');
    const ethUsd = await priceUtils.getEthUsd();
    if (ethUsd > 0) eth = Math.ceil((VERIFICATION_PRICE_USD / ethUsd) * 1e6) / 1e6;
    if (process.env.NEXT_PUBLIC_APP_MODE === 'production') {
      const usd = await priceUtils.getSagePriceUsd();
      if (usd && usd > 0) sage = Math.ceil((VERIFICATION_PRICE_USD / usd) * 100) / 100;
    }
  } catch {
    // dead feed → fallback prices
  }
  verificationPriceCache = { sage, eth, at: Date.now() };
  return verificationPriceCache;
}

async function isPfpVerified(user: {
  walletAddress: string;
  pfpNftId: number | null;
  profilePicture: string | null;
}): Promise<boolean> {
  const map = await pfpVerifiedMap([
    { authorAddress: user.walletAddress, Author: user },
  ]);
  return map[user.walletAddress] || false;
}

/**
 * A post's "hot" score — HN-style, so the global feed surfaces what's good
 * and fresh instead of merely newest. Engagement (likes/reposts/replies/tips/
 * collects) lifts a post; age drags it down via gravity; an active boost adds
 * a big bonus that decays across its window. Everything sinks over time, so a
 * boost is one surge, not a permanent pin.
 */
function hotScore(p: any, nowMs: number): number {
  const ageHours = Math.max(0, (nowMs - new Date(p.createdAt).getTime()) / 3.6e6);
  const engagement =
    p.likeCount +
    2 * p.repostCount +
    3 * p.replyCount +
    Math.min(30, p.tipTotal || 0) + // cap tip influence so whales don't dominate
    5 * p.collectCount;
  // SOFT boost: a budget-scaled bonus (boostStrength) that fades linearly
  // across the campaign window (boostedAt..boostedUntil). It ADDS to the
  // engagement score rather than overriding it, so a boosted post lifts but
  // still competes with genuinely popular posts.
  let boostBonus = 0;
  const until = p.boostedUntil ? new Date(p.boostedUntil).getTime() : 0;
  const started = p.boostedAt ? new Date(p.boostedAt).getTime() : 0;
  if (until > nowMs && started && until > started) {
    const remaining = (until - nowMs) / (until - started); // 1 at start → 0 at end
    boostBonus = (p.boostStrength || 0) * Math.max(0, Math.min(1, remaining));
  }
  return (1 + engagement + boostBonus) / Math.pow(ageHours + 2, FEED_GRAVITY);
}

async function getFeed(req: NextApiRequest, res: NextApiResponse) {
  // 'global' = the ranked "hot" feed (engagement + boost, decayed by age);
  // 'latest' = strict newest-first (no ranking, no boost);
  // 'following' = newest-first from wallets the viewer follows.
  const scope = (req.query.scope as string) || 'global';
  const viewer = canon((await getRequester(req))?.walletAddress);

  // ── global: hot-ranked over a recent pool, offset-paginated ──
  if (scope === 'global') {
    const offset = req.query.cursor ? Number(req.query.cursor) : 0;
    // Every refresh remixes the feed: the client sends a fresh `seed` per
    // page-load, and we jitter each post's hot score ±30% with a hash of
    // (seed, postId). Deterministic per seed, so pagination within one
    // refresh stays consistent — but the next refresh deals a new order.
    const seedStr = String(req.query.seed || '');
    const jitter = (id: number): number => {
      if (!seedStr) return 0.5;
      let h = 2166136261;
      const s = `${seedStr}:${id}`;
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return ((h >>> 0) % 10000) / 10000;
    };
    const pool = await prisma.socialPost.findMany({
      where: { replyToId: null, deletedAt: null },
      include: postInclude(viewer),
      orderBy: { id: 'desc' },
      take: FEED_POOL,
    });
    const now = Date.now();
    const ranked = pool
      .map((p) => ({ p, s: hotScore(p, now) * (0.7 + 0.6 * jitter(p.id)) }))
      .sort((a, b) => b.s - a.s)
      .map((x) => x.p);
    // Twitter behavior: YOUR own fresh posts lead your feed. A brand-new post
    // has zero engagement so ranking would bury it — pin the viewer's posts
    // from the last 10 minutes to the top of page 1 (any composer path, any
    // refetch), deduped from the ranked list.
    if (viewer && offset === 0) {
      const mine = await prisma.socialPost.findMany({
        where: {
          authorAddress: viewer,
          replyToId: null,
          deletedAt: null,
          createdAt: { gte: new Date(now - 10 * 60_000) },
        },
        include: postInclude(viewer),
        orderBy: { id: 'desc' },
        take: 3,
      });
      if (mine.length) {
        const mineIds = new Set(mine.map((m) => m.id));
        ranked.splice(0, ranked.length, ...mine, ...ranked.filter((p) => !mineIds.has(p.id)));
      }
    }
    const page = ranked.slice(offset, offset + FEED_PAGE);
    const nextOffset = offset + FEED_PAGE;
    const nextCursor = nextOffset < ranked.length ? nextOffset : null;
    const verified = await pfpVerifiedMap(page);
    return res.json({ posts: page.map((p) => serializePost(p, viewer, verified)), nextCursor });
  }

  // ── latest / following: pure reverse-chronological, id-cursor paginated ──
  const cursor = req.query.cursor ? Number(req.query.cursor) : undefined;
  let authorFilter = {};
  if (scope === 'following') {
    if (!viewer) return res.json({ posts: [], nextCursor: null });
    const following = await prisma.socialFollow.findMany({
      where: { followerAddress: viewer },
      select: { followingAddress: true },
    });
    authorFilter = { authorAddress: { in: following.map((f) => f.followingAddress) } };
  }
  const posts = await prisma.socialPost.findMany({
    where: { replyToId: null, deletedAt: null, ...authorFilter },
    include: postInclude(viewer),
    orderBy: { id: 'desc' },
    take: 21,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const nextCursor = posts.length > 20 ? posts[19].id : null;
  const page = posts.slice(0, 20);
  const verified = await pfpVerifiedMap(page);
  res.json({ posts: page.map((p) => serializePost(p, viewer, verified)), nextCursor });
}

async function getUserPosts(address: string, req: NextApiRequest, res: NextApiResponse) {
  const addr = canon(address);
  if (!addr) return res.status(400).json({ error: 'bad address' });
  const viewer = canon((await getRequester(req))?.walletAddress);
  const posts = await prisma.socialPost.findMany({
    where: { authorAddress: addr, replyToId: null, deletedAt: null },
    include: postInclude(viewer),
    orderBy: { id: 'desc' },
    take: 40,
  });
  const verified = await pfpVerifiedMap(posts);
  res.json({ posts: posts.map((p) => serializePost(p, viewer, verified)) });
}

async function getPost(id: number, req: NextApiRequest, res: NextApiResponse) {
  const viewer = canon((await getRequester(req))?.walletAddress);
  const post = await prisma.socialPost.findUnique({ where: { id }, include: postInclude(viewer) });
  if (!post || post.deletedAt) return res.status(404).json({ error: 'not found' });
  const replies = await prisma.socialPost.findMany({
    where: { replyToId: id, deletedAt: null },
    include: postInclude(viewer),
    orderBy: { id: 'asc' },
    take: 100,
  });
  const verified = await pfpVerifiedMap([post, ...replies]);
  res.json({
    post: serializePost(post, viewer, verified),
    replies: replies.map((p) => serializePost(p, viewer, verified)),
  });
}

async function getProfile(address: string, req: NextApiRequest, res: NextApiResponse) {
  const addr = canon(address);
  if (!addr) return res.status(400).json({ error: 'bad address' });
  const viewer = canon((await getRequester(req))?.walletAddress);
  const isSelf = viewer === addr;
  const [user, followers, following, postCount, followsViewer, followGatedDrops, myDrops] =
    await Promise.all([
      prisma.user.findUnique({
        where: { walletAddress: addr },
        select: {
          walletAddress: true,
          username: true,
          profilePicture: true,
          pfpNftId: true,
          bio: true,
          bannerImageS3Path: true,
          verifiedAt: true,
          role: true,
          invitedByCode: true,
        },
      }),
      prisma.socialFollow.count({ where: { followingAddress: addr } }),
      prisma.socialFollow.count({ where: { followerAddress: addr } }),
      prisma.socialPost.count({ where: { authorAddress: addr, replyToId: null, deletedAt: null } }),
      viewer
        ? prisma.socialFollow.findUnique({
            where: {
              followerAddress_followingAddress: { followerAddress: viewer, followingAddress: addr },
            },
          })
        : null,
      // public: drops whose allowlist this profile's follows feed into —
      // rendered as the "follow to get allowlisted" banner
      prisma.drop.findMany({
        where: {
          artistAddress: addr,
          followGateEnabled: true,
          whitelistContractAddress: { not: null },
        },
        select: { id: true, name: true },
      }),
      // own profile only: every drop the artist could follow-gate (has an
      // on-chain whitelist), for the toggle list
      isSelf
        ? prisma.drop.findMany({
            where: { artistAddress: addr, whitelistContractAddress: { not: null } },
            select: { id: true, name: true, followGateEnabled: true },
          })
        : [],
    ]);
  // self-only extras: does the composer need an invite code, unread DMs
  const needsInvite =
    isSelf && user ? user.role === Role.USER && !user.verifiedAt && !user.invitedByCode : false;
  const unreadMessages = isSelf
    ? await prisma.socialMessage.count({ where: { toAddress: addr, readAt: null } })
    : 0;
  // alpha chat visibility: exists+enabled, and the viewer is a follower/owner.
  // Lazily provision for verified users verified before the feature (or via SQL).
  let groupChat: { enabled: boolean; isMember: boolean } | null = null;
  if (user?.verifiedAt) {
    let chat = await prisma.socialGroupChat.findUnique({ where: { ownerAddress: addr } });
    if (!chat && isSelf) {
      chat = await prisma.socialGroupChat.create({ data: { ownerAddress: addr } }).catch(() => null);
    }
    if (chat) {
      groupChat = {
        enabled: chat.enabled,
        isMember: isSelf || !!followsViewer,
      };
    }
  }
  res.json({
    address: addr,
    username: user?.username || null,
    profilePicture: user?.profilePicture || null,
    pfpVerified: user ? await isPfpVerified(user) : false,
    verified: !!user?.verifiedAt, // paid checkmark
    bio: user?.bio || null,
    bannerImageS3Path: user?.bannerImageS3Path || null,
    followers,
    following,
    postCount,
    followedByViewer: !!followsViewer,
    isSelf,
    needsInvite,
    unreadMessages,
    followGatedDrops,
    myDrops: isSelf ? myDrops : [],
    groupChat,
  });
}

async function createPost(
  req: NextApiRequest,
  res: NextApiResponse,
  r: { walletAddress: string }
) {
  if (!(await canParticipate(r.walletAddress)))
    return res.status(403).json({
      error: 'SAGE Social is invite-only — redeem an invite code to start posting',
      needsInvite: true,
    });
  if (rateLimited(r.walletAddress, 'post', 10))
    return res.status(429).json({ error: 'slow down — 10 posts per minute max' });
  const { text, imageUrl, mediaType, replyToId } = req.body || {};
  const trimmed = (text || '').trim();
  if (!trimmed && !imageUrl) return res.status(400).json({ error: 'empty post' });
  if (trimmed.length > 500) return res.status(400).json({ error: 'post too long (500 max)' });
  // media must come from our own uploader (our bucket only) — no hotlinks
  if (imageUrl && !isOwnSocialMediaUrl(imageUrl))
    return res.status(400).json({ error: 'media must be uploaded through SAGE Social' });

  // unfurl the first URL into a Twitter-style preview card (best-effort;
  // capped at ~5s so a slow site can't stall posting)
  let link: Awaited<ReturnType<typeof fetchLinkPreview>> = null;
  const firstUrl = extractFirstUrl(trimmed);
  if (firstUrl) {
    try {
      link = await fetchLinkPreview(firstUrl);
    } catch {
      link = null;
    }
  }

  const post = await prisma.socialPost.create({
    data: {
      authorAddress: r.walletAddress,
      text: trimmed,
      imageUrl: imageUrl || null,
      mediaType: imageUrl ? (mediaType === 'video' ? 'video' : 'image') : null,
      replyToId: replyToId ? Number(replyToId) : null,
      linkUrl: link?.url || null,
      linkTitle: link?.title || null,
      linkDesc: link?.desc || null,
      linkImage: link?.image || null,
    },
    include: postInclude(r.walletAddress),
  });
  if (replyToId) {
    await prisma.socialPost.update({
      where: { id: Number(replyToId) },
      data: { replyCount: { increment: 1 } },
    });
  }
  const verified = await pfpVerifiedMap([post]);
  res.json({ post: serializePost(post, r.walletAddress, verified) });
}

async function toggleLike(req: NextApiRequest, res: NextApiResponse, r: { walletAddress: string }) {
  const postId = Number(req.body?.postId);
  const key = { postId_userAddress: { postId, userAddress: r.walletAddress } };
  const existing = await prisma.socialLike.findUnique({ where: key });
  if (existing) {
    await prisma.$transaction([
      prisma.socialLike.delete({ where: key }),
      prisma.socialPost.update({ where: { id: postId }, data: { likeCount: { decrement: 1 } } }),
    ]);
    return res.json({ liked: false });
  }
  await prisma.$transaction([
    prisma.socialLike.create({ data: { postId, userAddress: r.walletAddress } }),
    prisma.socialPost.update({ where: { id: postId }, data: { likeCount: { increment: 1 } } }),
  ]);
  res.json({ liked: true });
}

async function toggleRepost(
  req: NextApiRequest,
  res: NextApiResponse,
  r: { walletAddress: string }
) {
  const postId = Number(req.body?.postId);
  const key = { postId_userAddress: { postId, userAddress: r.walletAddress } };
  const existing = await prisma.socialRepost.findUnique({ where: key });
  if (existing) {
    await prisma.$transaction([
      prisma.socialRepost.delete({ where: key }),
      prisma.socialPost.update({ where: { id: postId }, data: { repostCount: { decrement: 1 } } }),
    ]);
    return res.json({ reposted: false });
  }
  await prisma.$transaction([
    prisma.socialRepost.create({ data: { postId, userAddress: r.walletAddress } }),
    prisma.socialPost.update({ where: { id: postId }, data: { repostCount: { increment: 1 } } }),
  ]);
  res.json({ reposted: true });
}

async function toggleFollow(
  req: NextApiRequest,
  res: NextApiResponse,
  r: { walletAddress: string }
) {
  const target = canon(req.body?.address as string);
  if (!target || target === r.walletAddress)
    return res.status(400).json({ error: 'cannot follow that' });
  const key = {
    followerAddress_followingAddress: { followerAddress: r.walletAddress, followingAddress: target },
  };
  const existing = await prisma.socialFollow.findUnique({ where: key });
  if (existing) {
    await prisma.socialFollow.delete({ where: key });
    // unfollowing does NOT revoke allowlist spots already granted — on-chain
    // adds are one-way by design (same as unclaiming an IP-gated spot)
    return res.json({ following: false });
  }
  // the target must be a known user (has signed in at least once)
  const targetUser = await prisma.user.findUnique({ where: { walletAddress: target } });
  if (!targetUser) return res.status(404).json({ error: 'user not found' });
  await prisma.socialFollow.create({
    data: { followerAddress: r.walletAddress, followingAddress: target },
  });
  // follow-to-whitelist: a new follow of a gated artist earns allowlist spots
  const whitelistedFor = await syncFollowerIntoGatedDrops(target, r.walletAddress);
  res.json({ following: true, whitelistedFor });
}

/**
 * Adds a follower to every follow-gated drop of the artist they just
 * followed: ledger row (lowercase, like the allowlist UI expects) + on-chain
 * SageWhitelist add. Chain failures leave the row unsynced — the admin
 * allowlist tooling picks those up later — and never fail the follow itself.
 */
async function syncFollowerIntoGatedDrops(artist: string, follower: string): Promise<string[]> {
  const drops = await prisma.drop.findMany({
    where: {
      artistAddress: artist,
      followGateEnabled: true,
      whitelistContractAddress: { not: null },
    },
    select: { id: true, name: true, whitelistContractAddress: true },
  });
  const granted: string[] = [];
  for (const d of drops) {
    try {
      let syncedAt: Date | null = null;
      if (!(await isWhitelistedOnChain(d.whitelistContractAddress!, follower))) {
        await addToWhitelistOnChain(d.whitelistContractAddress!, [follower]);
      }
      syncedAt = new Date();
      await prisma.dropAllowlistEntry.upsert({
        where: { dropId_address: { dropId: d.id, address: follower.toLowerCase() } },
        update: { syncedAt },
        create: { dropId: d.id, address: follower.toLowerCase(), syncedAt },
      });
      granted.push(d.name);
    } catch (e) {
      console.error(`follow-gate sync failed for drop ${d.id}`, e);
      // keep the ledger truthful even when the chain write failed
      await prisma.dropAllowlistEntry
        .upsert({
          where: { dropId_address: { dropId: d.id, address: follower.toLowerCase() } },
          update: {},
          create: { dropId: d.id, address: follower.toLowerCase() },
        })
        .catch(() => {});
    }
  }
  return granted;
}

async function setFollowGate(
  req: NextApiRequest,
  res: NextApiResponse,
  r: { walletAddress: string; role: Role }
) {
  const dropId = Number(req.body?.dropId);
  const enabled = !!req.body?.enabled;
  const drop = await prisma.drop.findUnique({
    where: { id: dropId },
    select: { id: true, artistAddress: true, whitelistContractAddress: true },
  });
  if (!drop) return res.status(404).json({ error: 'drop not found' });
  const isOwner = canon(drop.artistAddress) === r.walletAddress;
  if (!isOwner && r.role !== Role.ADMIN)
    return res.status(403).json({ error: 'not your drop' });
  if (enabled && !drop.whitelistContractAddress)
    return res.status(400).json({
      error: 'this drop has no on-chain allowlist yet — enable its allowlist or IP gate first',
    });

  await prisma.drop.update({ where: { id: dropId }, data: { followGateEnabled: enabled } });

  // backfill: existing followers earned their spot the moment the gate opens
  let backfilled = 0;
  if (enabled) {
    const followers = await prisma.socialFollow.findMany({
      where: { followingAddress: canon(drop.artistAddress)! },
      select: { followerAddress: true },
    });
    for (const f of followers) {
      const granted = await syncFollowerIntoGatedDrops(
        canon(drop.artistAddress)!,
        f.followerAddress
      );
      if (granted.length) backfilled++;
    }
  }
  res.json({ ok: true, enabled, backfilled });
}

async function recordTip(req: NextApiRequest, res: NextApiResponse, r: { walletAddress: string }) {
  // The SAGE transfer happens client-side (wallet-signed); the server checks
  // the mined tx actually paid the AUTHOR before crediting, and the unique
  // txHash column stops the same transfer being recorded twice.
  const { postId, txHash } = req.body || {};
  const currency = req.body?.currency === 'ETH' ? 'ETH' : 'SAGE';
  const id = Number(postId);
  if (!id || !txHash) return res.status(400).json({ error: 'bad tip' });
  const post = await prisma.socialPost.findUnique({ where: { id } });
  if (!post) return res.status(404).json({ error: 'post not found' });
  // self-tips would let authors pump their own feed rank + leaderboard for
  // free (the money round-trips to themselves)
  if (post.authorAddress.toLowerCase() === r.walletAddress.toLowerCase())
    return res.status(400).json({ error: 'you cannot tip your own post' });
  let amount: number;
  try {
    amount = await verifyPayment(txHash, r.walletAddress, post.authorAddress, 0, currency);
  } catch (e: any) {
    return res.status(400).json({ error: `tip not verified: ${e.message}` });
  }
  try {
    await prisma.$transaction([
      prisma.socialTip.create({
        data: {
          postId: id,
          fromAddress: r.walletAddress,
          toAddress: post.authorAddress,
          amount,
          currency,
          txHash,
        },
      }),
      prisma.socialPost.update({
        where: { id },
        data:
          currency === 'ETH'
            ? { tipTotalEth: { increment: amount } }
            : { tipTotal: { increment: amount } },
      }),
    ]);
  } catch {
    return res.status(400).json({ error: 'this transaction was already recorded' });
  }
  res.json({ ok: true, amount, currency });
}

/** SAGE per USD for boost pricing; live on prod, flat fallback elsewhere. */
let boostSagePerUsdCache: { rate: number; at: number } | null = null;
async function boostSagePerUsd(): Promise<number> {
  if (boostSagePerUsdCache && Date.now() - boostSagePerUsdCache.at < 300_000)
    return boostSagePerUsdCache.rate;
  let rate = BOOST_SAGE_PER_USD_FALLBACK;
  if (process.env.NEXT_PUBLIC_APP_MODE === 'production') {
    try {
      const { getSagePriceUsd } = await import('@/utilities/sagePrice');
      const usd = await getSagePriceUsd();
      if (usd && usd > 0) rate = 1 / usd; // SAGE per $1
    } catch {
      // dead feed → fallback
    }
  }
  boostSagePerUsdCache = { rate, at: Date.now() };
  return rate;
}

// ETH/USD from Uniswap (5-min cache) — boosts are priced in dollars, paid in ETH
let boostEthUsdCache: { rate: number; at: number } | null = null;
async function boostEthUsd(): Promise<number> {
  if (boostEthUsdCache && Date.now() - boostEthUsdCache.at < 300_000) return boostEthUsdCache.rate;
  let rate = 3500; // fallback if every feed is down
  try {
    rate = await (await import('@/utilities/sagePrice')).getEthUsd();
  } catch {
    /* keep fallback */
  }
  boostEthUsdCache = { rate, at: Date.now() };
  return rate;
}

async function getBoostInfo(res: NextApiResponse) {
  res.json({
    dailyMinUsd: BOOST_DAILY_MIN_USD,
    dailyMaxUsd: BOOST_DAILY_MAX_USD,
    daysMin: BOOST_DAYS_MIN,
    daysMax: BOOST_DAYS_MAX,
    ethUsd: await boostEthUsd(),
    treasury: TREASURY_ADDRESS,
  });
}

async function boostPost(req: NextApiRequest, res: NextApiResponse, r: { walletAddress: string }) {
  if (!(await requireVerified(r.walletAddress, res))) return;
  const { postId, txHash, dailyUsd, days } = req.body || {};
  const id = Number(postId);
  const daily = Number(dailyUsd);
  const nDays = Math.round(Number(days));
  if (!id || !txHash) return res.status(400).json({ error: 'bad boost' });
  if (!(daily >= BOOST_DAILY_MIN_USD && daily <= BOOST_DAILY_MAX_USD))
    return res.status(400).json({ error: `daily budget must be $${BOOST_DAILY_MIN_USD}–$${BOOST_DAILY_MAX_USD}` });
  if (!(nDays >= BOOST_DAYS_MIN && nDays <= BOOST_DAYS_MAX))
    return res.status(400).json({ error: `duration must be ${BOOST_DAYS_MIN}–${BOOST_DAYS_MAX} days` });
  const post = await prisma.socialPost.findUnique({ where: { id } });
  if (!post) return res.status(404).json({ error: 'post not found' });

  // total = daily × days in USD, PAID IN ETH to the treasury (Uniswap rate,
  // 5% price-drift tolerance)
  const totalUsd = daily * nDays;
  const requiredEth = totalUsd / (await boostEthUsd());
  let amount: number;
  try {
    amount = await verifyPayment(txHash, r.walletAddress, TREASURY_ADDRESS, requiredEth * 0.95, 'ETH');
  } catch (e: any) {
    return res.status(400).json({ error: `payment not verified: ${e.message}` });
  }

  // strength scales with the DAILY budget (how strong), window with the
  // DURATION (how long). A fresh boost resets the campaign from now; it's a
  // soft, decaying lift, never a pin (see hotScore).
  const t = (daily - BOOST_DAILY_MIN_USD) / (BOOST_DAILY_MAX_USD - BOOST_DAILY_MIN_USD);
  const boostStrength = BOOST_STRENGTH_MIN + t * (BOOST_STRENGTH_MAX - BOOST_STRENGTH_MIN);
  const now = new Date();
  const boostedUntil = new Date(now.getTime() + nDays * 24 * 3600 * 1000);

  try {
    await prisma.$transaction([
      prisma.socialBoost.create({
        data: { postId: id, fromAddress: r.walletAddress, amount, hours: nDays * 24, txHash },
      }),
      prisma.socialPost.update({
        where: { id },
        data: { boostedAt: now, boostedUntil, boostStrength, boostBurned: { increment: amount } },
      }),
    ]);
  } catch {
    return res.status(400).json({ error: 'this payment was already credited' });
  }
  res.json({ ok: true, amount, boostedUntil, days: nDays });
}

async function setCollectible(
  req: NextApiRequest,
  res: NextApiResponse,
  r: { walletAddress: string }
) {
  if (!(await requireVerified(r.walletAddress, res))) return;
  const { postId, price } = req.body || {};
  const id = Number(postId);
  const post = await prisma.socialPost.findUnique({ where: { id } });
  if (!post) return res.status(404).json({ error: 'post not found' });
  if (post.authorAddress !== r.walletAddress)
    return res.status(403).json({ error: 'only the author can do that' });
  // price null/undefined = stop new collects; 0 = free collect
  const p = price === null || price === undefined || price === '' ? null : Number(price);
  if (p !== null && (isNaN(p) || p < 0)) return res.status(400).json({ error: 'bad price' });
  if (p !== null && !parameters.SOCIAL_COLLECTS_ADDRESS)
    return res.status(400).json({ error: 'collecting is not enabled on this network yet' });
  // IMAGE posts sell for ETH (the artist sells the artwork, real money);
  // text posts sell for pixels (the points economy).
  const currency = post.imageUrl && post.mediaType !== 'video' ? 'ETH' : 'POINTS';
  await prisma.socialPost.update({
    where: { id },
    data: { collectPrice: p, collectCurrency: currency },
  });
  res.json({ ok: true, collectPrice: p, collectCurrency: currency });
}

async function collectPost(
  req: NextApiRequest,
  res: NextApiResponse,
  r: { walletAddress: string }
) {
  if (!(await requireVerified(r.walletAddress, res))) return;
  const { postId, txHash, payWith } = req.body || {};
  const id = Number(postId);
  const post = await prisma.socialPost.findUnique({ where: { id } });
  if (!post) return res.status(404).json({ error: 'post not found' });
  if (post.collectPrice === null) return res.status(400).json({ error: 'post is not collectible' });

  const already = await prisma.socialCollect.findUnique({
    where: { postId_collectorAddress: { postId: id, collectorAddress: r.walletAddress } },
  });
  if (already) return res.status(400).json({ error: 'already collected' });

  // ETH-priced posts (image art): the buyer pays the AUTHOR directly with a
  // wallet tx; we verify it on-chain (amount + recipient + replay via the
  // unique payTxHash) and then mint. Pixels never enter the picture.
  let amount = 0;
  let currency: 'ETH' | 'POINTS' = 'POINTS';
  let ethTxHash: string | null = null;
  if (post.collectCurrency === 'ETH') {
    currency = 'ETH';
    if (post.collectPrice > 0) {
      if (!txHash) return res.status(400).json({ error: 'payment tx required' });
      const dupe = await prisma.socialCollect.findUnique({ where: { payTxHash: txHash } });
      if (dupe) return res.status(400).json({ error: 'this payment was already used' });
      try {
        // 5% tolerance for rounding between quote and signed value
        amount = await verifyPayment(
          txHash,
          r.walletAddress,
          post.authorAddress,
          post.collectPrice * 0.95,
          'ETH'
        );
      } catch (e: any) {
        return res.status(400).json({ error: `payment not verified: ${e.message}` });
      }
      ethTxHash = txHash;
    }
    const tokenUriEth = `${siteUrl()}/api/social/?action=GetPostMetadata&id=${id}`;
    let mintEth: Awaited<ReturnType<typeof mintSocialCollectServerSide>>;
    try {
      mintEth = await mintSocialCollectServerSide(r.walletAddress, tokenUriEth);
    } catch (e: any) {
      return res.status(500).json({ error: `mint failed: ${e?.message?.slice(0, 100) || 'unknown'}` });
    }
    await prisma.$transaction([
      prisma.socialCollect.create({
        data: {
          postId: id,
          collectorAddress: r.walletAddress,
          amount,
          currency,
          pointsSpent: null,
          payTxHash: ethTxHash,
          mintTxHash: mintEth.txHash,
          contractAddress: parameters.SOCIAL_COLLECTS_ADDRESS,
          tokenId: mintEth.tokenId,
        },
      }),
      prisma.socialPost.update({ where: { id }, data: { collectCount: { increment: 1 } } }),
    ]);
    return res.json({ ok: true, tokenId: mintEth.tokenId, mintTxHash: mintEth.txHash, pointsSpent: null });
  }

  // pixels path: hold SAGE (skin in the game), spend pixels, seller earns them.
  // collectPrice holds the pixel price directly.
  let pointsSpent: bigint | null = null;
  if (post.collectPrice > 0) {
    try {
      const { ethers: e } = await import('ethers');
      const token = new e.Contract(
        parameters.ASHTOKEN_ADDRESS,
        ['function balanceOf(address) view returns (uint256)'],
        new e.providers.StaticJsonRpcProvider(parameters.RPC_URL)
      );
      const bal = Number(e.utils.formatEther(await token.balanceOf(r.walletAddress)));
      const minHold = process.env.NEXT_PUBLIC_APP_MODE === 'production' ? 1 : 0;
      if (bal < minHold)
        return res.status(400).json({ error: `hold at least ${minHold} SAGE to collect` });
    } catch (e) {
      console.error('collect hold-check RPC failed', e);
    }
    const pointsPrice = BigInt(Math.ceil(post.collectPrice));
    try {
      await debitPixelsAtomic(r.walletAddress, post.authorAddress, id, pointsPrice);
    } catch (e: any) {
      return res
        .status(e?.message === 'pixels-conflict' ? 409 : 400)
        .json({ error: e?.message === 'pixels-conflict' ? 'pixels are busy — try again' : e.message });
    }
    pointsSpent = pointsPrice;
  }

  // server-mints the post NFT to the collector (platform holds role.minter)
  const tokenUri = `${siteUrl()}/api/social/?action=GetPostMetadata&id=${id}`;
  let mint: Awaited<ReturnType<typeof mintSocialCollectServerSide>>;
  try {
    mint = await mintSocialCollectServerSide(r.walletAddress, tokenUri);
  } catch (e: any) {
    // the debit already happened — put the pixels back before failing
    if (pointsSpent !== null) await refundPixels(r.walletAddress, post.authorAddress, id, pointsSpent).catch(() => {});
    return res.status(500).json({ error: `mint failed: ${e?.message?.slice(0, 100) || 'unknown'}` });
  }

  // (the pixels ledger rows were written atomically in debitPixelsAtomic)
  await prisma.$transaction([
    prisma.socialCollect.create({
      data: {
        postId: id,
        collectorAddress: r.walletAddress,
        amount,
        currency,
        pointsSpent,
        payTxHash: null,
        mintTxHash: mint.txHash,
        contractAddress: parameters.SOCIAL_COLLECTS_ADDRESS,
        tokenId: mint.tokenId,
      },
    }),
    prisma.socialPost.update({ where: { id }, data: { collectCount: { increment: 1 } } }),
  ]);
  res.json({ ok: true, tokenId: mint.tokenId, mintTxHash: mint.txHash, pointsSpent: pointsSpent?.toString() ?? null });
}

async function getOwnedNfts(res: NextApiResponse, r: { walletAddress: string }) {
  const nfts = await prisma.nft.findMany({
    where: { ownerAddress: { equals: r.walletAddress, mode: 'insensitive' }, isHidden: false },
    select: { id: true, name: true, s3Path: true, s3PathOptimized: true },
    orderBy: { id: 'desc' },
    take: 60,
  });
  res.json({ nfts });
}

async function setNftPfp(req: NextApiRequest, res: NextApiResponse, r: { walletAddress: string }) {
  const nftId = Number(req.body?.nftId);
  const nft = await prisma.nft.findUnique({
    where: { id: nftId },
    select: { id: true, ownerAddress: true, s3Path: true, s3PathOptimized: true },
  });
  if (!nft) return res.status(404).json({ error: 'NFT not found' });
  if (nft.ownerAddress?.toLowerCase() !== r.walletAddress.toLowerCase())
    return res.status(403).json({ error: 'you do not own that NFT' });
  const image = nft.s3PathOptimized || nft.s3Path;
  await prisma.user.update({
    where: { walletAddress: r.walletAddress },
    data: { profilePicture: image, pfpNftId: nft.id },
  });
  res.json({ ok: true, profilePicture: image, pfpVerified: true });
}

function siteUrl(): string {
  return (process.env.NEXTAUTH_URL || parameters.APP_URL || '').replace(/\/+$/, '');
}

/**
 * ERC-721 metadata for a collected post — this is the collect NFT's tokenURI.
 * Text-only posts get a generated SAGE-styled SVG card as their image, so
 * every collect renders on external marketplaces.
 */
async function getPostMetadata(id: number, res: NextApiResponse) {
  const post = await prisma.socialPost.findUnique({
    where: { id },
    include: { Author: { select: { username: true } } },
  });
  if (!post) return res.status(404).json({ error: 'not found' });
  const author = post.Author?.username || `${post.authorAddress.slice(0, 6)}…${post.authorAddress.slice(-4)}`;
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
  res.json({
    name: `SAGE Social #${id}`,
    description: `${post.text}\n\n— ${author} on SAGE Social`,
    external_url: `${siteUrl()}/social/post/${id}/`,
    image:
      post.mediaType === 'video' || !post.imageUrl
        ? postCardSvgDataUri(post.text, author, post.createdAt, id)
        : post.imageUrl,
    ...(post.mediaType === 'video' && post.imageUrl ? { animation_url: post.imageUrl } : {}),
    attributes: [
      { trait_type: 'Author', value: author },
      { trait_type: 'Posted', display_type: 'date', value: Math.floor(post.createdAt.getTime() / 1000) },
    ],
  });
}

/**
 * The collected-post NFT card (800×800) — the BRUTALIST treatment the user
 * picked from the ten candidates: shouting uppercase type on charcoal, a
 * lime plinth carrying the REAL SAGE mark, serial and credits on the plinth.
 */
function postCardSvgDataUri(text: string, author: string, createdAt: Date, postId?: number): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // heavy display setting: ~18 chars/line, up to 7 lines. The text keeps the
  // TWEET'S OWN casing — the card frames the post, it doesn't shout over it.
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > 18) {
      lines.push(line.trim());
      line = w;
      if (lines.length === 6) break;
    } else line = (line + ' ' + w).trim();
  }
  if (line && lines.length < 7) lines.push(line.trim());
  if (words.join(' ').length > lines.join(' ').length + 8) lines[lines.length - 1] += '…';
  const tspans = lines
    .map((l, i) => `<tspan x="56" dy="${i === 0 ? 0 : 58}">${esc(l)}</tspan>`)
    .join('');
  const logo = sageLogoInner()?.replace(/#d4fc52/g, '#101613');
  const mark = logo
    ? `<g transform="translate(56,568) scale(1.35)">${logo}</g>`
    : `<text x="56" y="640" font-family="DejaVu Sans,Arial,sans-serif" font-size="52" font-weight="900" fill="#101613">SAGE</text>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">` +
    `<rect width="800" height="800" fill="#131917"/>` +
    `<rect x="0" y="530" width="800" height="270" fill="#d4fc52"/>` +
    `<text y="150" font-family="DejaVu Sans,Arial,sans-serif" font-size="44" font-weight="900" fill="#eef3ec">${tspans}</text>` +
    mark +
    `<text x="56" y="720" font-family="DejaVu Sans,Arial,sans-serif" font-size="34" font-weight="900" fill="#101613">SOCIAL №${postId ?? ''}</text>` +
    `<text x="744" y="720" text-anchor="end" font-family="DejaVu Sans Mono,monospace" font-size="22" fill="#101613">${esc(author)} · ${createdAt.toISOString().slice(0, 10)}</text>` +
    `<rect x="56" y="480" width="120" height="14" fill="#d4fc52"/>` +
    `</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

// ─────────────────────── paid verification ($10 checkmark) ───────────────────────

async function getVerificationInfo(res: NextApiResponse) {
  const prices = await verificationPrices();
  res.json({
    priceUsd: VERIFICATION_PRICE_USD,
    priceSage: prices.sage,
    priceEth: prices.eth,
    treasury: TREASURY_ADDRESS,
    pointsPerSage: POINTS_PER_SAGE,
  });
}

async function purchaseVerification(
  req: NextApiRequest,
  res: NextApiResponse,
  r: { walletAddress: string }
) {
  const { txHash } = req.body || {};
  if (!txHash) return res.status(400).json({ error: 'payment tx required' });
  const me = await prisma.user.findUnique({
    where: { walletAddress: r.walletAddress },
    select: { verifiedAt: true },
  });
  if (me?.verifiedAt) return res.status(400).json({ error: 'already verified' });
  const dupe = await prisma.user.findFirst({ where: { verifiedTxHash: txHash } });
  if (dupe) return res.status(400).json({ error: 'this payment was already used' });
  const currency = req.body?.currency === 'ETH' ? 'ETH' : 'SAGE';
  const prices = await verificationPrices();
  const price = currency === 'ETH' ? prices.eth : prices.sage;
  try {
    // 5% tolerance: the quoted price can drift between quote and mined tx
    await verifyPayment(txHash, r.walletAddress, TREASURY_ADDRESS, price * 0.95, currency);
  } catch (e: any) {
    return res.status(400).json({ error: `payment not verified: ${e.message}` });
  }
  await prisma.user.update({
    where: { walletAddress: r.walletAddress },
    data: { verifiedAt: new Date(), verifiedTxHash: txHash },
  });
  // premium perk: the alpha group chat spins up automatically
  await prisma.socialGroupChat
    .create({ data: { ownerAddress: r.walletAddress } })
    .catch(() => {}); // already exists — fine
  res.json({ ok: true, verified: true });
}

// ───────────────────────── referral system (invite codes) ─────────────────────────

function generateInviteCode(): string {
  // unambiguous alphabet (no 0/O/1/I/L), 6 chars after the SAGE- prefix
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  let s = '';
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `SAGE-${s}`;
}

/** Ensures the user's SINGLE invite code exists at their tier's use count. */
async function provisionInvites(wallet: string) {
  const u = await prisma.user.findUnique({
    where: { walletAddress: wallet },
    select: { role: true, verifiedAt: true, invitedByCode: true },
  });
  if (!u) return [];
  const participates = u.role !== Role.USER || !!u.verifiedAt || !!u.invitedByCode;
  if (!participates) return [];
  const maxUses =
    u.role === Role.ADMIN
      ? INVITE_USES_ADMIN
      : u.verifiedAt
      ? INVITE_USES_VERIFIED
      : INVITE_USES_BASE;
  const existing = await prisma.socialInviteCode.findMany({
    where: { ownerAddress: wallet },
    orderBy: { createdAt: 'asc' },
  });
  let code = existing[0];
  if (!code) {
    for (let attempt = 0; attempt < 5 && !code; attempt++) {
      try {
        code = await prisma.socialInviteCode.create({
          data: { code: generateInviteCode(), ownerAddress: wallet, maxUses },
        });
      } catch {
        // code collision — regenerate
      }
    }
    if (!code) return [];
  }
  // tier upgrades raise the SAME code's capacity; extra codes from the old
  // multi-code scheme are retired once unused
  if (code.maxUses < maxUses) {
    code = await prisma.socialInviteCode.update({
      where: { code: code.code },
      data: { maxUses },
    });
  }
  if (existing.length > 1) {
    await prisma.socialInviteCode.deleteMany({
      where: { ownerAddress: wallet, uses: 0, NOT: { code: code.code } },
    });
  }
  return [code];
}

async function getMyInvites(res: NextApiResponse, r: { walletAddress: string }) {
  const codes = await provisionInvites(r.walletAddress);
  res.json({
    invites: codes.map((c) => ({
      code: c.code,
      uses: c.uses,
      maxUses: c.maxUses,
      url: `${siteUrl()}/invite/${c.code}/`,
    })),
  });
}

async function redeemInvite(req: NextApiRequest, res: NextApiResponse, r: { walletAddress: string }) {
  const code = String(req.body?.code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'invite code required' });
  const me = await prisma.user.findUnique({
    where: { walletAddress: r.walletAddress },
    select: { invitedByCode: true },
  });
  if (me?.invitedByCode) return res.status(400).json({ error: 'you already joined' });
  const invite = await prisma.socialInviteCode.findUnique({ where: { code } });
  if (!invite) return res.status(404).json({ error: 'invalid invite code' });
  if (invite.ownerAddress === r.walletAddress)
    return res.status(400).json({ error: 'you cannot redeem your own code' });
  if (invite.uses >= invite.maxUses)
    return res.status(400).json({ error: 'this invite code is used up' });
  await prisma.$transaction([
    prisma.socialInviteCode.update({ where: { code }, data: { uses: { increment: 1 } } }),
    prisma.user.update({
      where: { walletAddress: r.walletAddress },
      data: { invitedByCode: code },
    }),
  ]);
  res.json({ ok: true, joined: true });
}

async function getInvite(code: string, res: NextApiResponse) {
  const invite = await prisma.socialInviteCode.findUnique({
    where: { code: code.trim().toUpperCase() },
    include: { Owner: { select: { username: true, walletAddress: true, profilePicture: true } } },
  });
  if (!invite) return res.status(404).json({ error: 'invalid invite code' });
  res.json({
    code: invite.code,
    valid: invite.uses < invite.maxUses,
    usesLeft: invite.maxUses - invite.uses,
    owner: {
      address: invite.Owner.walletAddress,
      username: invite.Owner.username,
      profilePicture: invite.Owner.profilePicture,
    },
  });
}

// The REAL brand mark for the invite card: read the shipped logo SVG once and
// recolor it lime. Falls back to a drawn approximation if the file is absent.
let sageLogoCache: string | null | undefined;
function sageLogoInner(): string | null {
  if (sageLogoCache !== undefined) return sageLogoCache;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    const raw = fs.readFileSync(process.cwd() + '/public/branding/sage-full-logo.svg', 'utf8');
    sageLogoCache = raw
      .replace(/^[\s\S]*?<svg[^>]*>/, '')
      .replace(/<\/svg>[\s\S]*$/, '')
      .replace(/currentColor/g, '#d4fc52');
  } catch {
    sageLogoCache = null;
  }
  return sageLogoCache;
}

/**
 * The Twitter-card PNG for /invite/{code} (1200×630). SAGE design language:
 * dark canvas, lime accents, the REAL SAGE logo (public/branding), the
 * inviter's name and the code front and center. Rasterized with sharp
 * (librsvg) — the Docker image ships fonts-dejavu-core for the text.
 */
async function inviteImage(code: string, res: NextApiResponse) {
  const invite = await prisma.socialInviteCode.findUnique({
    where: { code: code.trim().toUpperCase() },
    include: { Owner: { select: { username: true, walletAddress: true } } },
  });
  if (!invite) return res.status(404).json({ error: 'invalid invite code' });
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const name = esc(
    invite.Owner.username ||
      `${invite.Owner.walletAddress.slice(0, 6)}…${invite.Owner.walletAddress.slice(-4)}`
  );
  const host = siteUrl().replace(/^https?:\/\//, '');
  const logo = sageLogoInner();
  const logoBlock = logo
    ? `<g transform="translate(96,64) scale(1.9)">${logo}</g>` +
      `<text x="580" y="164" font-family="DejaVu Sans,Arial,sans-serif" font-size="52" font-weight="bold" fill="#d4fc52" letter-spacing="14">SOCIAL</text>`
    : `<circle cx="140" cy="140" r="52" fill="none" stroke="#d4fc52" stroke-width="6"/>` +
      `<path d="M140 104 L172 168 L108 168 Z" fill="none" stroke="#d4fc52" stroke-width="6" stroke-linejoin="round"/>` +
      `<text x="220" y="128" font-family="DejaVu Sans,Arial,sans-serif" font-size="40" font-weight="bold" fill="#d4fc52" letter-spacing="8">SAGE SOCIAL</text>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">` +
    `<rect width="1200" height="630" fill="#131917"/>` +
    `<rect x="28" y="28" width="1144" height="574" fill="none" stroke="#d4fc52" stroke-width="3"/>` +
    logoBlock +
    `<text x="96" y="230" font-family="DejaVu Sans,Arial,sans-serif" font-size="24" fill="#9daba0">your wallet is your handle · tip in SAGE</text>` +
    `<text x="96" y="330" font-family="DejaVu Sans,Arial,sans-serif" font-size="52" fill="#eef3ec">${name} invited you</text>` +
    `<text x="96" y="440" font-family="DejaVu Sans,Arial,sans-serif" font-size="88" font-weight="bold" fill="#d4fc52" letter-spacing="6">${esc(invite.code)}</text>` +
    `<text x="96" y="540" font-family="DejaVu Sans,Arial,sans-serif" font-size="30" fill="#9daba0">${esc(host)}/invite/${esc(invite.code)}</text>` +
    `</svg>`;
  const sharp = (await import('sharp')).default;
  const png = await sharp(Buffer.from(svg), { density: 96 }).png().toBuffer();
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  res.send(png);
}

// ─────────────────────────── leaderboard / activity / mints ───────────────────────────

async function userCards(addresses: string[]) {
  const users = await prisma.user.findMany({
    where: { walletAddress: { in: addresses } },
    select: { walletAddress: true, username: true, profilePicture: true, verifiedAt: true },
  });
  const map: Record<string, any> = {};
  for (const u of users)
    map[u.walletAddress] = {
      address: u.walletAddress,
      username: u.username,
      profilePicture: u.profilePicture,
      verified: !!u.verifiedAt,
    };
  return map;
}

// Pixels leaderboard is contract-based: batch pointsOf() over the user base
// (bounded + cached — one RPC sweep per minute at most).
let pixelsBoardCache: { rows: { address: string; net: bigint }[]; at: number } | null = null;
async function pixelsLeaderboard(): Promise<{ address: string; net: bigint }[]> {
  if (pixelsBoardCache && Date.now() - pixelsBoardCache.at < 60_000) return pixelsBoardCache.rows;
  if (!parameters.SAGE_POINTS_ADDRESS) return [];
  const users = await prisma.user.findMany({ select: { walletAddress: true }, take: 300 });
  const rows: { address: string; net: bigint }[] = [];
  // chunked so we don't blast the RPC with 300 parallel calls
  for (let i = 0; i < users.length; i += 25) {
    const chunk = users.slice(i, i + 25);
    const balances = await Promise.all(
      chunk.map((u) => pixelsOf(u.walletAddress).catch(() => BigInt(0)))
    );
    chunk.forEach((u, j) => rows.push({ address: u.walletAddress, net: balances[j] }));
  }
  rows.sort((a, b) => (b.net > a.net ? 1 : b.net < a.net ? -1 : 0));
  pixelsBoardCache = { rows: rows.slice(0, 10), at: Date.now() };
  return pixelsBoardCache.rows;
}

async function getLeaderboard(res: NextApiResponse) {
  const [tipped, tippers, burners, followed, pointsPool] = await Promise.all([
    prisma.socialTip.groupBy({
      by: ['toAddress'],
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
      take: 10,
    }),
    prisma.socialTip.groupBy({
      by: ['fromAddress'],
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
      take: 10,
    }),
    prisma.socialBoost.groupBy({
      by: ['fromAddress'],
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
      take: 10,
    }),
    prisma.socialFollow.groupBy({
      by: ['followingAddress'],
      _count: { _all: true },
      orderBy: { _count: { followerAddress: 'desc' } },
      take: 10,
    }),
    pixelsLeaderboard(),
  ]);
  const cards = await userCards([
    ...pointsPool.map((p) => p.address),
    ...tipped.map((t) => t.toAddress),
    ...tippers.map((t) => t.fromAddress),
    ...burners.map((b) => b.fromAddress),
    ...followed.map((f) => f.followingAddress),
  ]);
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
  res.json({
    topEarners: tipped.map((t) => ({ user: cards[t.toAddress], sage: t._sum.amount || 0 })),
    topTippers: tippers.map((t) => ({ user: cards[t.fromAddress], sage: t._sum.amount || 0 })),
    topBurners: burners.map((b) => ({ user: cards[b.fromAddress], sage: b._sum.amount || 0 })),
    mostFollowed: followed.map((f) => ({
      user: cards[f.followingAddress],
      count: f._count._all,
    })),
    topPoints: pointsPool.map((p) => ({ user: cards[p.address], count: Number(p.net) })),
  });
}

async function getUserMints(address: string, res: NextApiResponse) {
  const addr = canon(address);
  if (!addr) return res.status(400).json({ error: 'bad address' });
  const [collects, ownedNfts, hidden] = await Promise.all([
    // 1) posts this wallet collected on SAGE Social
    prisma.socialCollect.findMany({
      where: { collectorAddress: addr },
      include: {
        Post: { include: { Author: { select: { username: true, profilePicture: true, verifiedAt: true } } } },
      },
      orderBy: { id: 'desc' },
      take: 60,
    }),
    // 2) ANY NFT this wallet owns in the SAGE marketplace (incl. ones the
    //    wallet minted itself or acquired elsewhere on-chain, not just
    //    platform collects). True cross-contract holdings need an indexer;
    //    this covers every SAGE-tracked NFT.
    prisma.nft.findMany({
      where: { ownerAddress: { equals: addr, mode: 'insensitive' }, isHidden: false },
      select: { id: true, name: true, s3Path: true, s3PathOptimized: true, tokenId: true },
      orderBy: { id: 'desc' },
      take: 100,
    }),
    prisma.socialHiddenItem.findMany({ where: { ownerAddress: addr, kind: 'nft' } }),
  ]);
  const hiddenRefs = new Set(hidden.map((h) => h.ref));
  const isHidden = (contract: string, tokenId: number | null) =>
    hiddenRefs.has(`${contract}:${tokenId}`.toLowerCase());

  const collectMints = collects
    .filter((c) => !isHidden(c.contractAddress, c.tokenId))
    .map((c) => ({
      source: 'collect' as const,
      kind: 'nft' as const,
      ref: `${c.contractAddress}:${c.tokenId}`.toLowerCase(),
      tokenId: c.tokenId,
      contractAddress: c.contractAddress,
      pointsSpent: c.pointsSpent?.toString() ?? null,
      createdAt: c.createdAt,
      image: null as string | null,
      title: `SAGE Social #${c.Post.id}`,
      post: {
        id: c.Post.id,
        text: c.Post.text,
        imageUrl: c.Post.imageUrl,
        author: {
          address: c.Post.authorAddress,
          username: c.Post.Author?.username || null,
          verified: !!c.Post.Author?.verifiedAt,
        },
      },
    }));
  const ownedMints = ownedNfts
    .filter((n) => !isHidden('nft', n.id))
    .map((n) => ({
      source: 'owned' as const,
      kind: 'nft' as const,
      ref: `nft:${n.id}`.toLowerCase(),
      tokenId: n.tokenId ?? n.id,
      contractAddress: '',
      pointsSpent: null,
      createdAt: null,
      image: n.s3PathOptimized || n.s3Path,
      title: n.name,
      post: null as any,
    }));
  res.json({ mints: [...collectMints, ...ownedMints] });
}

async function getActivity(res: NextApiResponse, r: { walletAddress: string }) {
  const me = r.walletAddress;
  const myPosts = { Post: { authorAddress: me } };
  const [likes, reposts, tips, collects, follows, replies] = await Promise.all([
    prisma.socialLike.findMany({
      where: { ...myPosts, NOT: { userAddress: me } },
      include: { Post: { select: { id: true, text: true } } },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
    prisma.socialRepost.findMany({
      where: { ...myPosts, NOT: { userAddress: me } },
      include: { Post: { select: { id: true, text: true } } },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
    prisma.socialTip.findMany({
      where: { toAddress: me },
      include: { Post: { select: { id: true, text: true } } },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
    prisma.socialCollect.findMany({
      where: { ...myPosts, NOT: { collectorAddress: me } },
      include: { Post: { select: { id: true, text: true } } },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
    prisma.socialFollow.findMany({
      where: { followingAddress: me },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
    prisma.socialPost.findMany({
      where: { ReplyTo: { authorAddress: me }, NOT: { authorAddress: me } },
      select: { id: true, text: true, authorAddress: true, createdAt: true, replyToId: true },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
  ]);
  type Item = {
    type: string;
    actor: string;
    postId?: number;
    snippet?: string;
    amount?: number;
    createdAt: Date;
  };
  const items: Item[] = [
    ...likes.map((x) => ({ type: 'like', actor: x.userAddress, postId: x.postId, snippet: x.Post.text.slice(0, 60), createdAt: x.createdAt })),
    ...reposts.map((x) => ({ type: 'repost', actor: x.userAddress, postId: x.postId, snippet: x.Post.text.slice(0, 60), createdAt: x.createdAt })),
    ...tips.map((x) => ({ type: 'tip', actor: x.fromAddress, postId: x.postId, snippet: x.Post.text.slice(0, 60), amount: x.amount, createdAt: x.createdAt })),
    ...collects.map((x) => ({ type: 'collect', actor: x.collectorAddress, postId: x.postId, snippet: x.Post.text.slice(0, 60), amount: x.amount, createdAt: x.createdAt })),
    ...follows.map((x) => ({ type: 'follow', actor: x.followerAddress, createdAt: x.createdAt })),
    ...replies.map((x) => ({ type: 'reply', actor: x.authorAddress, postId: x.replyToId ?? x.id, snippet: x.text.slice(0, 60), createdAt: x.createdAt })),
  ]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 50);
  const cards = await userCards(items.map((i) => i.actor));
  res.json({
    activity: items.map((i) => ({
      ...i,
      actor: cards[i.actor] || { address: i.actor, username: null, verified: false },
    })),
  });
}

// ───────────────────────────── messaging (premium DMs) ─────────────────────────────

/** People the signed-in user follows — powers the DM compose suggestions. */
async function getMyFollowing(res: NextApiResponse, r: { walletAddress: string }) {
  const follows = await prisma.socialFollow.findMany({
    where: { followerAddress: r.walletAddress },
    orderBy: { createdAt: 'desc' },
    take: 24,
    select: { followingAddress: true },
  });
  const cards = await userCards(follows.map((f) => f.followingAddress));
  res.json({
    users: follows.map(
      (f) => cards[f.followingAddress] || { address: f.followingAddress, username: null, verified: false }
    ),
  });
}

async function getConversations(res: NextApiResponse, r: { walletAddress: string }) {
  const me = r.walletAddress;
  // Direct messages only — one row per person you've talked to, newest first.
  const recent = await prisma.socialMessage.findMany({
    where: { OR: [{ fromAddress: me }, { toAddress: me }] },
    orderBy: { id: 'desc' },
    take: 300,
  });
  const byPartner = new Map<string, { last: (typeof recent)[0]; unread: number }>();
  for (const m of recent) {
    const partner = m.fromAddress === me ? m.toAddress : m.fromAddress;
    const entry = byPartner.get(partner) || { last: m, unread: 0 };
    if (m.toAddress === me && !m.readAt) entry.unread++;
    byPartner.set(partner, entry);
  }
  const partners = Array.from(byPartner.keys());
  const cards = await userCards(partners);
  const dms = partners.map((p) => ({
    partner: cards[p] || { address: p, username: null, verified: false },
    lastMessage: byPartner.get(p)!.last.text.slice(0, 80),
    lastAt: byPartner.get(p)!.last.createdAt,
    unread: byPartner.get(p)!.unread,
  }));
  res.json({ conversations: dms });
}

async function getMessages(req: NextApiRequest, res: NextApiResponse, r: { walletAddress: string }) {
  const partner = canon(String(req.query.partner || req.body?.partner || ''));
  if (!partner) return res.status(400).json({ error: 'bad partner address' });
  const me = r.walletAddress;
  // `before` powers scroll-up infinite loading: fetch the page of messages
  // older than the given id. The initial (no-cursor) load returns the latest
  // window and marks the thread read; older pages never re-mark.
  const before = Number(req.query.before || req.body?.before || 0);
  const pageSize = before > 0 ? 30 : 40;
  const convo = {
    OR: [
      { fromAddress: me, toAddress: partner },
      { fromAddress: partner, toAddress: me },
    ],
  };
  const messages = await prisma.socialMessage.findMany({
    where: before > 0 ? { AND: [convo, { id: { lt: before } }] } : convo,
    orderBy: { id: 'desc' },
    take: pageSize + 1, // +1 sentinel tells us whether older messages remain
  });
  const hasMore = messages.length > pageSize;
  const page = hasMore ? messages.slice(0, pageSize) : messages;
  if (before <= 0) {
    // opening the thread reads it
    await prisma.socialMessage.updateMany({
      where: { fromAddress: partner, toAddress: me, readAt: null },
      data: { readAt: new Date() },
    });
  }
  res.json({
    hasMore,
    messages: page.reverse().map((m) => ({
      id: m.id,
      from: m.fromAddress,
      text: m.text,
      createdAt: m.createdAt,
      mine: m.fromAddress === me,
    })),
  });
}

async function sendMessage(req: NextApiRequest, res: NextApiResponse, r: { walletAddress: string }) {
  if (!(await requireVerified(r.walletAddress, res))) return;
  if (rateLimited(r.walletAddress, 'dm', 30))
    return res.status(429).json({ error: 'slow down — 30 messages per minute max' });
  const to = canon(req.body?.to as string);
  const text = String(req.body?.text || '').trim();
  if (!to || to === r.walletAddress) return res.status(400).json({ error: 'bad recipient' });
  if (!text || text.length > 1000) return res.status(400).json({ error: 'message must be 1-1000 chars' });
  const target = await prisma.user.findUnique({ where: { walletAddress: to } });
  if (!target) return res.status(404).json({ error: 'user not found' });
  const message = await prisma.socialMessage.create({
    data: { fromAddress: r.walletAddress, toAddress: to, text },
  });
  res.json({ ok: true, id: message.id });
}


// ─────────────────────── delete / search / global ticker ───────────────────────

async function deletePost(req: NextApiRequest, res: NextApiResponse, r: { walletAddress: string; role: Role }) {
  const id = Number(req.body?.postId);
  const post = await prisma.socialPost.findUnique({ where: { id } });
  if (!post || post.deletedAt) return res.status(404).json({ error: 'post not found' });
  if (post.authorAddress !== r.walletAddress && r.role !== Role.ADMIN)
    return res.status(403).json({ error: 'not your post' });
  if (post.collectCount > 0)
    return res.status(400).json({
      error: 'collected posts are permanent — their NFTs point at this post',
    });
  await prisma.$transaction([
    prisma.socialPost.update({ where: { id }, data: { deletedAt: new Date() } }),
    ...(post.replyToId
      ? [
          prisma.socialPost.update({
            where: { id: post.replyToId },
            data: { replyCount: { decrement: 1 } },
          }),
        ]
      : []),
  ]);
  res.json({ ok: true });
}

async function search(q: string, req: NextApiRequest, res: NextApiResponse) {
  const query = q.trim();
  if (query.length < 2) return res.json({ users: [], posts: [] });
  const viewer = canon((await getRequester(req))?.walletAddress);
  const [users, posts] = await Promise.all([
    prisma.user.findMany({
      where: {
        OR: [
          { username: { contains: query, mode: 'insensitive' } },
          { walletAddress: { startsWith: query, mode: 'insensitive' } },
        ],
      },
      select: { walletAddress: true, username: true, profilePicture: true, verifiedAt: true },
      take: 10,
    }),
    prisma.socialPost.findMany({
      where: { text: { contains: query, mode: 'insensitive' }, deletedAt: null },
      include: postInclude(viewer),
      orderBy: { id: 'desc' },
      take: 20,
    }),
  ]);
  const verified = await pfpVerifiedMap(posts);
  res.json({
    users: users.map((u) => ({
      address: u.walletAddress,
      username: u.username,
      profilePicture: u.profilePicture,
      verified: !!u.verifiedAt,
    })),
    posts: posts.map((p) => serializePost(p, viewer, verified)),
  });
}

/** The right-rail ticker: everything the network just did, money first. */
async function getGlobalActivity(res: NextApiResponse) {
  const [tips, collects, boosts, follows, posts] = await Promise.all([
    prisma.socialTip.findMany({ orderBy: { id: 'desc' }, take: 10 }),
    prisma.socialCollect.findMany({
      orderBy: { id: 'desc' },
      take: 10,
      include: { Post: { select: { authorAddress: true } } },
    }),
    prisma.socialBoost.findMany({ orderBy: { id: 'desc' }, take: 10 }),
    prisma.socialFollow.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
    prisma.socialPost.findMany({
      where: { deletedAt: null, replyToId: null },
      orderBy: { id: 'desc' },
      take: 10,
      select: { id: true, authorAddress: true, createdAt: true },
    }),
  ]);
  type Ev = {
    type: string;
    actor: string;
    target?: string;
    postId?: number;
    amount?: number;
    currency?: string;
    createdAt: Date;
  };
  const events: Ev[] = [
    ...tips.map((t) => ({ type: 'tip', actor: t.fromAddress, target: t.toAddress, postId: t.postId, amount: t.amount, currency: t.currency, createdAt: t.createdAt })),
    ...collects.map((c) => ({ type: 'collect', actor: c.collectorAddress, target: c.Post.authorAddress, postId: c.postId, amount: c.amount, currency: c.currency, createdAt: c.createdAt })),
    ...boosts.map((b) => ({ type: 'boost', actor: b.fromAddress, postId: b.postId, amount: b.amount, currency: 'SAGE', createdAt: b.createdAt })),
    ...follows.map((f) => ({ type: 'follow', actor: f.followerAddress, target: f.followingAddress, createdAt: f.createdAt })),
    ...posts.map((p) => ({ type: 'post', actor: p.authorAddress, postId: p.id, createdAt: p.createdAt })),
  ]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 20);
  const cards = await userCards([
    ...events.map((e) => e.actor),
    ...events.map((e) => e.target).filter(Boolean),
  ] as string[]);
  res.setHeader('Cache-Control', 'public, s-maxage=20, stale-while-revalidate=60');
  res.json({
    events: events.map((e) => ({
      ...e,
      actor: cards[e.actor] || { address: e.actor, username: null, verified: false },
      target: e.target
        ? cards[e.target] || { address: e.target, username: null, verified: false }
        : null,
    })),
  });
}


// ─────────────────────── token launchpad (pump.fun-style) ───────────────────────

/** Records a token the creator already launched on-chain (they paid the fee). */
async function recordTokenLaunch(
  req: NextApiRequest,
  res: NextApiResponse,
  r: { walletAddress: string }
) {
  if (!(await requireVerified(r.walletAddress, res))) return; // premium: launching is a paid perk
  const { tokenAddress, name, symbol, launchTxHash, imageUrl, airdropEnabled, description } = req.body || {};
  const token = canon(tokenAddress);
  if (!token || !launchTxHash || !name || !symbol)
    return res.status(400).json({ error: 'tokenAddress, name, symbol, launchTxHash required' });
  const factory = parameters.SOCIAL_TOKEN_FACTORY_ADDRESS;
  if (!factory) return res.status(400).json({ error: 'token launches are not enabled here' });
  // verify the launch tx really came from this creator to the factory, AND
  // that the TokenLaunched event in that tx emitted exactly this token — a
  // caller must not be able to record someone else's token under their name
  try {
    const { ethers } = await import('ethers');
    const provider = new ethers.providers.StaticJsonRpcProvider(parameters.RPC_URL);
    const rcpt = await provider.getTransactionReceipt(launchTxHash);
    if (!rcpt || rcpt.status !== 1) throw new Error('launch tx not mined');
    if (rcpt.from.toLowerCase() !== r.walletAddress.toLowerCase()) throw new Error('not your launch');
    if (rcpt.to?.toLowerCase() !== factory.toLowerCase()) throw new Error('wrong factory');
    const iface = new ethers.utils.Interface([
      'event TokenLaunched(address indexed token, address indexed creator, string name, string symbol, bool airdropEnabled)',
    ]);
    const launched = rcpt.logs
      .map((l) => { try { return iface.parseLog(l); } catch { return null; } })
      .find((p) => p?.name === 'TokenLaunched');
    if (!launched) throw new Error('no TokenLaunched event in tx');
    if (launched.args.token.toLowerCase() !== token.toLowerCase())
      throw new Error('token does not match the launch tx');
  } catch (e: any) {
    return res.status(400).json({ error: `launch not verified: ${e.message}` });
  }
  try {
    const launch = await prisma.socialTokenLaunch.create({
      data: {
        creatorAddress: r.walletAddress,
        tokenAddress: token,
        name: String(name).slice(0, 40),
        symbol: String(symbol).slice(0, 12),
        launchTxHash,
        imageUrl: imageUrl || null,
        description: description ? String(description).slice(0, 300) : null,
        airdropEnabled: airdropEnabled !== false,
      },
    });
    res.json({ ok: true, token: launch.tokenAddress });
  } catch {
    // tokenAddress/launchTxHash are unique — a duplicate means this exact
    // launch was already recorded (multiple launches per creator are fine)
    return res.status(400).json({ error: 'this launch is already recorded' });
  }
}

async function recordAirdrop(
  req: NextApiRequest,
  res: NextApiResponse,
  r: { walletAddress: string }
) {
  const count = Number(req.body?.count || 0);
  const token = canon(req.body?.tokenAddress) || null;
  // creators can hold several launches now — target the given token, else the
  // profile (first) one
  const launch = token
    ? await prisma.socialTokenLaunch.findFirst({
        where: { creatorAddress: r.walletAddress, tokenAddress: token },
      })
    : await prisma.socialTokenLaunch.findFirst({
        where: { creatorAddress: r.walletAddress },
        orderBy: { id: 'asc' },
      });
  if (!launch) return res.status(404).json({ error: 'no token to airdrop' });
  await prisma.socialTokenLaunch.update({
    where: { id: launch.id },
    data: { airdropCount: { increment: Math.max(0, count) } },
  });
  res.json({ ok: true });
}

/** Followers of a creator — the airdrop recipient list for the launch UI. */
async function getProfileToken(address: string, res: NextApiResponse) {
  const addr = canon(address);
  if (!addr) return res.status(400).json({ error: 'bad address' });
  const [launch, followers, hidden] = await Promise.all([
    // the first launch is the profile token; later launches trade via their
    // own token pages but are NOT listed on the profile
    prisma.socialTokenLaunch.findFirst({ where: { creatorAddress: addr }, orderBy: { id: 'asc' } }),
    prisma.socialFollow.findMany({
      where: { followingAddress: addr },
      select: { followerAddress: true },
      take: 200,
    }),
    prisma.socialHiddenItem.findMany({ where: { ownerAddress: addr, kind: 'token' } }),
  ]);
  const tokenHidden =
    launch && hidden.some((h) => h.ref === launch.tokenAddress.toLowerCase());
  res.json({
    token: launch && !tokenHidden
      ? {
          tokenAddress: launch.tokenAddress,
          name: launch.name,
          symbol: launch.symbol,
          imageUrl: launch.imageUrl,
          airdropEnabled: launch.airdropEnabled,
          airdropCount: launch.airdropCount,
        }
      : null,
    factory: parameters.SOCIAL_TOKEN_FACTORY_ADDRESS || null,
    followers: followers.map((f) => f.followerAddress),
  });
}

async function getTokens(res: NextApiResponse) {
  const launches = await prisma.socialTokenLaunch.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { Creator: { select: { username: true, profilePicture: true, verifiedAt: true } } },
  });
  res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
  res.json({
    tokens: launches.map((l) => ({
      tokenAddress: l.tokenAddress,
      name: l.name,
      symbol: l.symbol,
      imageUrl: l.imageUrl,
      creator: {
        address: l.creatorAddress,
        username: l.Creator?.username || null,
        profilePicture: l.Creator?.profilePicture || null,
        verified: !!l.Creator?.verifiedAt,
      },
    })),
  });
}

// ─────────────── buyer-pays-gas collect: settle payment, hand back a voucher ───────────────

/**
 * The buyer-pays-gas collect path. The server settles payment exactly like
 * CollectPost (points/SAGE/ETH, replay-safe), freezes the NFT metadata to
 * Filebase (falling back to the on-site tokenURI), and returns an EIP-712
 * voucher the collector redeems on SocialCollectMinter — so THE COLLECTOR
 * pays the mint gas, not the platform.
 */
async function requestCollectVoucher(
  req: NextApiRequest,
  res: NextApiResponse,
  r: { walletAddress: string }
) {
  if (!(await requireVerified(r.walletAddress, res))) return;
  const minterAddress = parameters.SOCIAL_COLLECT_MINTER_ADDRESS;
  if (!minterAddress)
    return res.status(400).json({ error: 'buyer-paid minting is not enabled here' });
  const { postId, txHash, payWith } = req.body || {};
  const id = Number(postId);
  const post = await prisma.socialPost.findUnique({ where: { id } });
  if (!post) return res.status(404).json({ error: 'post not found' });
  if (post.collectPrice === null) return res.status(400).json({ error: 'post is not collectible' });
  const already = await prisma.socialCollect.findUnique({
    where: { postId_collectorAddress: { postId: id, collectorAddress: r.walletAddress } },
  });
  if (already) return res.status(400).json({ error: 'already collected' });

  // points-only: collectPrice holds the pixel price directly
  const currency = 'POINTS' as const;
  const amount = 0;
  let pointsSpent: bigint | null = null;
  if (post.collectPrice > 0) {
    const pointsPrice = BigInt(Math.ceil(post.collectPrice));
    try {
      await debitPixelsAtomic(r.walletAddress, post.authorAddress, id, pointsPrice);
    } catch (e: any) {
      return res
        .status(e?.message === 'pixels-conflict' ? 409 : 400)
        .json({ error: e?.message === 'pixels-conflict' ? 'pixels are busy — try again' : e.message });
    }
    pointsSpent = pointsPrice;
  }

  // freeze metadata (Filebase/IPFS if configured, else the on-site tokenURI)
  const author =
    (await prisma.user.findUnique({ where: { walletAddress: post.authorAddress }, select: { username: true } }))
      ?.username || `${post.authorAddress.slice(0, 6)}…${post.authorAddress.slice(-4)}`;
  const metadata = {
    name: `SAGE Social #${id}`,
    description: `${post.text}\n\n— ${author} on SAGE Social`,
    external_url: `${siteUrl()}/social/post/${id}/`,
    image:
      post.mediaType === 'video' || !post.imageUrl
        ? postCardSvgDataUri(post.text, author, post.createdAt, id)
        : post.imageUrl,
    ...(post.mediaType === 'video' && post.imageUrl ? { animation_url: post.imageUrl } : {}),
  };
  let uri: string;
  try {
    uri = (await uploadJsonToFilebase(`social/post-${id}.json`, metadata)) || '';
  } catch (e) {
    console.error('filebase upload failed, falling back', e);
    uri = '';
  }
  if (!uri) uri = `${siteUrl()}/api/social/?action=GetPostMetadata&id=${id}`;

  const chainId = Number(parameters.CHAIN_ID);
  let signature: string;
  try {
    signature = await signCollectVoucher(minterAddress, chainId, id, r.walletAddress, uri);
  } catch (e: any) {
    // debit already happened — put the pixels back before failing
    if (pointsSpent !== null) await refundPixels(r.walletAddress, post.authorAddress, id, pointsSpent).catch(() => {});
    return res.status(500).json({ error: `voucher signing failed: ${e?.message?.slice(0, 100) || 'unknown'}` });
  }

  // record the collect NOW (payment already settled); the on-chain mint the
  // collector then submits is idempotent (minter rejects a second redeem)
  await prisma.$transaction([
    prisma.socialCollect.create({
      data: {
        postId: id,
        collectorAddress: r.walletAddress,
        amount,
        currency,
        pointsSpent,
        payTxHash: amount > 0 ? txHash : null,
        mintTxHash: 'voucher', // buyer submits the mint; tx not known server-side
        contractAddress: parameters.SOCIAL_COLLECTS_ADDRESS,
        tokenId: 0, // assigned on-chain when the collector redeems
      },
    }),
    prisma.socialPost.update({ where: { id }, data: { collectCount: { increment: 1 } } }),
  ]);

  res.json({ ok: true, minter: minterAddress, postId: id, uri, signature });
}


// ───────────────────── alpha group chats (premium perk) ─────────────────────

/** Membership: the owner, or any follower of the owner. */
async function groupChatAccess(owner: string, viewer: string) {
  const chat = await prisma.socialGroupChat.findUnique({ where: { ownerAddress: owner } });
  if (!chat) return { chat: null, member: false };
  const member =
    owner === viewer ||
    !!(await prisma.socialFollow.findUnique({
      where: { followerAddress_followingAddress: { followerAddress: viewer, followingAddress: owner } },
    }));
  return { chat, member };
}

async function getGroupChat(req: NextApiRequest, res: NextApiResponse, r: { walletAddress: string }) {
  const owner = canon(String(req.query.owner || req.body?.owner || ''));
  if (!owner) return res.status(400).json({ error: 'bad owner address' });
  const { chat, member } = await groupChatAccess(owner, r.walletAddress);
  if (!chat || !chat.enabled) return res.status(404).json({ error: 'no alpha chat here' });
  if (!member) return res.status(403).json({ error: 'follow to enter the alpha chat' });
  const messages = await prisma.socialGroupMessage.findMany({
    where: { ownerAddress: owner },
    orderBy: { id: 'desc' },
    take: 100,
  });
  // the owner sees who's posted (their kick targets)
  const posterAddrs = Array.from(new Set(messages.map((m) => m.fromAddress)));
  const cards = await userCards([...posterAddrs, owner]);
  const members =
    owner === r.walletAddress
      ? posterAddrs
          .filter((a) => a !== owner)
          .map((a) => cards[a] || { address: a, username: null, verified: false })
      : [];
  res.json({
    enabled: chat.enabled,
    isOwner: owner === r.walletAddress,
    members,
    messages: messages.reverse().map((m) => ({
      id: m.id,
      from: cards[m.fromAddress] || { address: m.fromAddress, username: null, verified: false },
      text: m.text,
      createdAt: m.createdAt,
      mine: m.fromAddress === r.walletAddress,
    })),
  });
}

async function sendGroupMessage(req: NextApiRequest, res: NextApiResponse, r: { walletAddress: string }) {
  const owner = canon(req.body?.owner as string);
  const text = String(req.body?.text || '').trim();
  if (!owner) return res.status(400).json({ error: 'bad owner address' });
  if (!text || text.length > 1000) return res.status(400).json({ error: 'message must be 1-1000 chars' });
  const { chat, member } = await groupChatAccess(owner, r.walletAddress);
  if (!chat || !chat.enabled) return res.status(404).json({ error: 'no alpha chat here' });
  if (!member) return res.status(403).json({ error: 'follow to enter the alpha chat' });
  const m = await prisma.socialGroupMessage.create({
    data: { ownerAddress: owner, fromAddress: r.walletAddress, text },
  });
  res.json({ ok: true, id: m.id });
}

/** The owner's kill switch. */
async function toggleGroupChat(req: NextApiRequest, res: NextApiResponse, r: { walletAddress: string }) {
  const enabled = !!req.body?.enabled;
  const chat = await prisma.socialGroupChat.findUnique({ where: { ownerAddress: r.walletAddress } });
  if (!chat) return res.status(404).json({ error: 'you have no alpha chat' });
  await prisma.socialGroupChat.update({ where: { ownerAddress: r.walletAddress }, data: { enabled } });
  res.json({ ok: true, enabled });
}

// ───────────── avatar / banner set (image already compressed by social-upload) ─────────────

async function setProfileImage(req: NextApiRequest, res: NextApiResponse, r: { walletAddress: string }) {
  const { url, kind } = req.body || {};
  if (!url || !isOwnSocialMediaUrl(url))
    return res.status(400).json({ error: 'image must be uploaded through SAGE Social' });
  if (kind === 'banner') {
    await prisma.user.update({
      where: { walletAddress: r.walletAddress },
      data: { bannerImageS3Path: url },
    });
  } else {
    // custom avatar replaces any NFT pfp (verification ring self-heals off)
    await prisma.user.update({
      where: { walletAddress: r.walletAddress },
      data: { profilePicture: url, pfpNftId: null },
    });
  }
  res.json({ ok: true, url, kind: kind === 'banner' ? 'banner' : 'avatar' });
}


// ─────────────── NFT edition launcher (artists + project mints) ───────────────

async function recordEditionLaunch(
  req: NextApiRequest,
  res: NextApiResponse,
  r: { walletAddress: string }
) {
  if (!(await requireVerified(r.walletAddress, res))) return; // premium perk
  const { editionAddress, name, symbol, imageUrl, priceEth, maxSupply, launchTxHash } = req.body || {};
  const edition = canon(editionAddress);
  const launcher = parameters.SOCIAL_NFT_LAUNCHER_ADDRESS;
  if (!launcher) return res.status(400).json({ error: 'edition launches are not enabled here' });
  if (!edition || !name || !symbol || !imageUrl || !launchTxHash)
    return res.status(400).json({ error: 'editionAddress, name, symbol, imageUrl, launchTxHash required' });
  if (!isOwnSocialMediaUrl(imageUrl))
    return res.status(400).json({ error: 'edition art must be uploaded through SAGE Social' });
  try {
    const { ethers } = await import('ethers');
    const provider = new ethers.providers.StaticJsonRpcProvider(parameters.RPC_URL);
    const rcpt = await provider.getTransactionReceipt(launchTxHash);
    if (!rcpt || rcpt.status !== 1) throw new Error('launch tx not mined');
    if (rcpt.from.toLowerCase() !== r.walletAddress.toLowerCase()) throw new Error('not your launch');
    if (rcpt.to?.toLowerCase() !== launcher.toLowerCase()) throw new Error('wrong launcher');
  } catch (e: any) {
    return res.status(400).json({ error: `launch not verified: ${e.message}` });
  }
  try {
    const row = await prisma.socialNftEdition.create({
      data: {
        artistAddress: r.walletAddress,
        editionAddress: edition,
        name: String(name).slice(0, 60),
        symbol: String(symbol).slice(0, 12),
        imageUrl,
        priceEth: Number(priceEth) || 0,
        maxSupply: Number(maxSupply) || 0,
        launchTxHash,
      },
    });
    res.json({ ok: true, id: row.id });
  } catch {
    return res.status(400).json({ error: 'edition already recorded' });
  }
}

async function getProfileEditions(address: string, res: NextApiResponse) {
  const addr = canon(address);
  if (!addr) return res.status(400).json({ error: 'bad address' });
  const [rows, hidden] = await Promise.all([
    prisma.socialNftEdition.findMany({ where: { artistAddress: addr }, orderBy: { id: 'desc' }, take: 20 }),
    prisma.socialHiddenItem.findMany({ where: { ownerAddress: addr, kind: 'edition' } }),
  ]);
  const hiddenRefs = new Set(hidden.map((h) => h.ref));
  res.json({
    launcher: parameters.SOCIAL_NFT_LAUNCHER_ADDRESS || null,
    editions: rows.filter((e) => !hiddenRefs.has(e.editionAddress.toLowerCase())).map((e) => ({
      id: e.id,
      editionAddress: e.editionAddress,
      name: e.name,
      symbol: e.symbol,
      imageUrl: e.imageUrl,
      priceEth: e.priceEth,
      maxSupply: e.maxSupply,
    })),
  });
}

/** ERC-721 metadata for an edition (every token shares it). */
async function getEditionMetadata(id: number, res: NextApiResponse) {
  const e = await prisma.socialNftEdition.findUnique({ where: { id } });
  if (!e) return res.status(404).json({ error: 'not found' });
  res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=86400');
  res.json({
    name: e.name,
    description: `${e.name} — an open edition by ${e.artistAddress} on SAGE Social.`,
    image: e.imageUrl,
    external_url: `${siteUrl()}/social/${e.artistAddress}/`,
  });
}


// ─────────────────────── token trade recording + detail page ───────────────────────

const FACTORY_ABI = [
  'function curves(address) view returns (uint256 virtualTokenReserves, uint256 virtualEthReserves, uint256 realTokenReserves, uint256 realEthReserves, address creator, bool complete, bool airdropEnabled)',
  'function spotPriceWei(address) view returns (uint256)',
];

/** Records a mined buy/sell so the chart, trades feed and holders stay live. */
async function recordTrade(req: NextApiRequest, res: NextApiResponse, r: { walletAddress: string }) {
  const { tokenAddress, side, txHash } = req.body || {};
  const token = canon(tokenAddress);
  const factory = parameters.SOCIAL_TOKEN_FACTORY_ADDRESS;
  if (!token || !txHash || (side !== 'buy' && side !== 'sell'))
    return res.status(400).json({ error: 'tokenAddress, side, txHash required' });
  if (!factory) return res.status(400).json({ error: 'trading not enabled here' });
  const dupe = await prisma.socialTokenTrade.findUnique({ where: { txHash } });
  if (dupe) return res.json({ ok: true, already: true });
  try {
    const { ethers } = await import('ethers');
    const provider = new ethers.providers.StaticJsonRpcProvider(parameters.RPC_URL);
    // the load-balanced RPC pool can lag a block behind the client's node —
    // retry briefly instead of failing the record
    let rcpt = await provider.getTransactionReceipt(txHash);
    for (let i = 0; !rcpt && i < 5; i++) {
      await new Promise((r) => setTimeout(r, 500));
      rcpt = await provider.getTransactionReceipt(txHash);
    }
    if (!rcpt || rcpt.status !== 1) throw new Error('trade tx not mined');
    if (rcpt.from.toLowerCase() !== r.walletAddress.toLowerCase()) throw new Error('not your trade');
    if (rcpt.to?.toLowerCase() !== factory.toLowerCase()) throw new Error('wrong factory');
    // decode the Bought/Sold event to get amounts
    const iface = new ethers.utils.Interface([
      'event Bought(address indexed token, address indexed buyer, uint256 ethIn, uint256 tokensOut, uint256 fee, uint256 creatorFee)',
      'event Sold(address indexed token, address indexed seller, uint256 tokensIn, uint256 ethOut, uint256 fee, uint256 creatorFee)',
    ]);
    let ethAmount = 0;
    let tokenAmount = 0;
    for (const log of rcpt.logs) {
      try {
        const parsed = iface.parseLog(log);
        // the event must be about THIS token — otherwise a cheap trade in
        // token A could be recorded to poison token B's chart/holders
        if (parsed.args.token.toLowerCase() !== token.toLowerCase()) continue;
        if (parsed.name === 'Bought' && side === 'buy') {
          ethAmount = Number(ethers.utils.formatEther(parsed.args.ethIn));
          tokenAmount = Number(ethers.utils.formatEther(parsed.args.tokensOut));
        } else if (parsed.name === 'Sold' && side === 'sell') {
          ethAmount = Number(ethers.utils.formatEther(parsed.args.ethOut));
          tokenAmount = Number(ethers.utils.formatEther(parsed.args.tokensIn));
        }
      } catch {
        /* not our event */
      }
    }
    if (tokenAmount <= 0) throw new Error('no trade event found');
    // spot price AFTER the trade, ETH per 1M tokens, straight off the curve
    const f = new ethers.Contract(factory, FACTORY_ABI, provider);
    const spotWei = await f.spotPriceWei(token);
    const priceEth = Number(ethers.utils.formatEther(spotWei.mul(1_000_000)));
    await prisma.socialTokenTrade.create({
      data: { tokenAddress: token, trader: r.walletAddress, side, ethAmount, tokenAmount, priceEth, txHash },
    });
    res.json({ ok: true, priceEth });
  } catch (e: any) {
    return res.status(400).json({ error: `trade not verified: ${e.message}` });
  }
}

/** Everything the pump.fun-style token page needs. */
async function getTokenDetail(address: string, res: NextApiResponse) {
  const token = canon(address);
  if (!token) return res.status(400).json({ error: 'bad address' });
  const launch = await prisma.socialTokenLaunch.findUnique({
    where: { tokenAddress: token },
    include: { Creator: { select: { username: true, profilePicture: true, verifiedAt: true } } },
  });
  if (!launch) return res.status(404).json({ error: 'token not found' });

  const trades = await prisma.socialTokenTrade.findMany({
    where: { tokenAddress: token },
    orderBy: { id: 'asc' },
    take: 500,
  });

  // holders derived from recorded trades (buys add, sells subtract) — a
  // testnet approximation; the chain is authoritative for real balances
  const balances = new Map<string, number>();
  for (const t of trades) {
    const d = t.side === 'buy' ? t.tokenAmount : -t.tokenAmount;
    balances.set(t.trader, (balances.get(t.trader) || 0) + d);
  }
  const holders = Array.from(balances.entries())
    .filter(([, b]) => b > 0.000001)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);
  const holderCards = await userCards(holders.map(([a]) => a));

  // live curve state for the bonding-curve progress bar + price
  let curve: { realTokenReserves: number; complete: boolean; priceEth: number } | null = null;
  try {
    const { ethers } = await import('ethers');
    const provider = new ethers.providers.StaticJsonRpcProvider(parameters.RPC_URL);
    const f = new ethers.Contract(parameters.SOCIAL_TOKEN_FACTORY_ADDRESS, FACTORY_ABI, provider);
    const [c, spot] = await Promise.all([f.curves(token), f.spotPriceWei(token)]);
    curve = {
      realTokenReserves: Number(ethers.utils.formatEther(c.realTokenReserves)),
      complete: c.complete,
      priceEth: Number(ethers.utils.formatEther(spot.mul(1_000_000))),
    };
  } catch (e) {
    console.error('curve read failed', e);
  }
  const INITIAL_REAL = 793_100_000; // pump.fun-shaped initial real reserves
  const soldPct = curve ? Math.min(100, ((INITIAL_REAL - curve.realTokenReserves) / INITIAL_REAL) * 100) : 0;

  // market header numbers (pump.fun-style): USD mcap, ATH, 24h change.
  // priceEth is ETH per 1M tokens → mcap = price × 1000 (1B supply) × ETH/USD
  const ethUsd = await boostEthUsd();
  const athPriceEth = trades.reduce((m, t) => Math.max(m, t.priceEth), curve?.priceEth || 0);
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  const before24h = [...trades].reverse().find((t) => +t.createdAt <= dayAgo);
  // baseline: last trade before the 24h window; if the token is younger than
  // 24h, the curve's initial price (its true starting point)
  const INITIAL_PRICE = 2_000_000 / 1_073_000_000;
  const price24hAgoEth = before24h ? before24h.priceEth : trades.length ? INITIAL_PRICE : curve?.priceEth || 0;

  // live trading view (1s client poll) — a CDN cache here would freeze the tape
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    token: {
      tokenAddress: launch.tokenAddress,
      name: launch.name,
      symbol: launch.symbol,
      imageUrl: launch.imageUrl,
      description: launch.description || null,
      airdropEnabled: launch.airdropEnabled,
      creator: {
        address: launch.creatorAddress,
        username: launch.Creator?.username || null,
        profilePicture: launch.Creator?.profilePicture || null,
        verified: !!launch.Creator?.verifiedAt,
      },
    },
    priceEth: curve?.priceEth ?? (trades.length ? trades[trades.length - 1].priceEth : 0),
    ethUsd,
    athPriceEth,
    price24hAgoEth,
    complete: curve?.complete ?? false,
    bondingProgressPct: Math.round(soldPct * 10) / 10,
    holderCount: holders.length,
    tradeCount: trades.length,
    series: trades.map((t) => ({ t: t.createdAt, price: t.priceEth })),
    trades: trades
      .slice(-30)
      .reverse()
      .map((t) => ({
        side: t.side,
        trader: t.trader,
        ethAmount: t.ethAmount,
        tokenAmount: t.tokenAmount,
        createdAt: t.createdAt,
      })),
    holders: holders.map(([addr, bal]) => ({
      user: holderCards[addr] || { address: addr, username: null, verified: false },
      balance: bal,
    })),
  });
}


/**
 * The owner kicks a member from their alpha chat: their follow is removed
 * (membership is follow-based) and their messages are cleared from the room.
 */
async function kickFromGroupChat(req: NextApiRequest, res: NextApiResponse, r: { walletAddress: string }) {
  const target = canon(req.body?.address as string);
  if (!target) return res.status(400).json({ error: 'bad address' });
  const chat = await prisma.socialGroupChat.findUnique({ where: { ownerAddress: r.walletAddress } });
  if (!chat) return res.status(404).json({ error: 'you have no alpha chat' });
  if (target === r.walletAddress) return res.status(400).json({ error: 'you cannot kick yourself' });
  await prisma.$transaction([
    // drop their membership (they followed to get in)
    prisma.socialFollow.deleteMany({
      where: { followerAddress: target, followingAddress: r.walletAddress },
    }),
    // scrub their posts from the room
    prisma.socialGroupMessage.deleteMany({
      where: { ownerAddress: r.walletAddress, fromAddress: target },
    }),
  ]);
  res.json({ ok: true });
}


/** Hide/show a token, edition or owned NFT on your own profile. */
async function toggleHideItem(req: NextApiRequest, res: NextApiResponse, r: { walletAddress: string }) {
  const kind = String(req.body?.kind || '');
  const ref = String(req.body?.ref || '').toLowerCase();
  const hide = req.body?.hide !== false;
  if (!['token', 'edition', 'nft'].includes(kind) || !ref)
    return res.status(400).json({ error: 'kind + ref required' });
  if (hide) {
    await prisma.socialHiddenItem
      .create({ data: { ownerAddress: r.walletAddress, kind, ref } })
      .catch(() => {});
  } else {
    await prisma.socialHiddenItem
      .delete({ where: { ownerAddress_kind_ref: { ownerAddress: r.walletAddress, kind, ref } } })
      .catch(() => {});
  }
  res.json({ ok: true, hidden: hide });
}
