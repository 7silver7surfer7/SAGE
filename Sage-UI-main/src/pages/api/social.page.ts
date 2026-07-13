import { NextApiRequest, NextApiResponse } from 'next';
import { Role } from '@prisma/client';
import { ethers } from 'ethers';
import { requireRole, getRequester } from '@/utilities/apiAuth';
import prisma from '@/prisma/client';
import { parameters } from '@/constants/config';
import {
  verifySageTransfer,
  verifyPayment,
  mintSocialCollectServerSide,
  addToWhitelistOnChain,
  isWhitelistedOnChain,
  DEAD_ADDRESS,
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

// burn-to-boost economics: 10 SAGE buys 24h at the top of the global feed,
// linear, capped 7 days out so a whale can't squat the feed for a year.
const BOOST_SAGE_PER_DAY = 10;
const BOOST_MAX_DAYS = 7;
const BOOST_MIN_SAGE = 1;

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
      case 'GetInvite':
        return await getInvite(String(request.query.code || ''), response);
      case 'InviteImage':
        return await inviteImage(String(request.query.code || ''), response);
      case 'GetLeaderboard':
        return await getLeaderboard(response);
      case 'GetUserMints':
        return await getUserMints(String(request.query.address || ''), response);
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
      case 'GetConversations':
        return await withAuth(request, response, (r) => getConversations(response, r));
      case 'GetMessages':
        return await withAuth(request, response, (r) => getMessages(request, response, r));
      case 'SendMessage':
        return await withAuth(request, response, (r) => sendMessage(request, response, r));
      case 'GetActivity':
        return await withAuth(request, response, (r) => getActivity(response, r));
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
  if (u && (u.verifiedAt || u.role === Role.ADMIN)) return true;
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

async function getFeed(req: NextApiRequest, res: NextApiResponse) {
  const scope = (req.query.scope as string) || 'global'; // 'global' | 'following'
  const cursor = req.query.cursor ? Number(req.query.cursor) : undefined;
  const viewer = canon((await getRequester(req))?.walletAddress);

  let authorFilter = {};
  if (scope === 'following') {
    if (!viewer) return res.json({ posts: [], nextCursor: null });
    const following = await prisma.socialFollow.findMany({
      where: { followerAddress: viewer },
      select: { followingAddress: true },
    });
    authorFilter = { authorAddress: { in: following.map((f) => f.followingAddress) } };
  }

  // burn-to-boost: active boosts open the global feed (first page only),
  // biggest lifetime burn first, then the normal reverse-chron river.
  let boosted: any[] = [];
  if (scope === 'global' && !cursor) {
    boosted = await prisma.socialPost.findMany({
      where: { replyToId: null, deletedAt: null, boostedUntil: { gt: new Date() } },
      include: postInclude(viewer),
      orderBy: { boostBurned: 'desc' },
      take: 5,
    });
  }

  const posts = await prisma.socialPost.findMany({
    where: {
      replyToId: null,
      deletedAt: null,
      ...authorFilter,
      ...(boosted.length ? { id: { notIn: boosted.map((b) => b.id) } } : {}),
    },
    include: postInclude(viewer),
    orderBy: { id: 'desc' },
    take: 21,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const nextCursor = posts.length > 20 ? posts[19].id : null;
  const page = [...boosted, ...posts.slice(0, 20)];
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
  const { text, imageUrl, mediaType, replyToId } = req.body || {};
  const trimmed = (text || '').trim();
  if (!trimmed && !imageUrl) return res.status(400).json({ error: 'empty post' });
  if (trimmed.length > 500) return res.status(400).json({ error: 'post too long (500 max)' });
  // media must come from our own uploader (S3 social/ folder) — no hotlinks
  if (imageUrl && !/^https:\/\/[a-z0-9.-]+\.amazonaws\.com\/social\//.test(imageUrl))
    return res.status(400).json({ error: 'media must be uploaded through SAGE Social' });

  const post = await prisma.socialPost.create({
    data: {
      authorAddress: r.walletAddress,
      text: trimmed,
      imageUrl: imageUrl || null,
      mediaType: imageUrl ? (mediaType === 'video' ? 'video' : 'image') : null,
      replyToId: replyToId ? Number(replyToId) : null,
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

async function boostPost(req: NextApiRequest, res: NextApiResponse, r: { walletAddress: string }) {
  if (!(await requireVerified(r.walletAddress, res))) return;
  const { postId, txHash } = req.body || {};
  const id = Number(postId);
  if (!id || !txHash) return res.status(400).json({ error: 'bad boost' });
  const post = await prisma.socialPost.findUnique({ where: { id } });
  if (!post) return res.status(404).json({ error: 'post not found' });

  let amount: number;
  try {
    amount = await verifySageTransfer(txHash, r.walletAddress, DEAD_ADDRESS, BOOST_MIN_SAGE);
  } catch (e: any) {
    return res.status(400).json({ error: `burn not verified: ${e.message}` });
  }

  const hours = (amount / BOOST_SAGE_PER_DAY) * 24;
  const now = new Date();
  const base = post.boostedUntil && post.boostedUntil > now ? post.boostedUntil : now;
  const cap = new Date(now.getTime() + BOOST_MAX_DAYS * 24 * 3600 * 1000);
  const boostedUntil = new Date(
    Math.min(base.getTime() + hours * 3600 * 1000, cap.getTime())
  );

  try {
    await prisma.$transaction([
      prisma.socialBoost.create({
        data: { postId: id, fromAddress: r.walletAddress, amount, hours, txHash },
      }),
      prisma.socialPost.update({
        where: { id },
        data: { boostedUntil, boostBurned: { increment: amount } },
      }),
    ]);
  } catch {
    return res.status(400).json({ error: 'this burn was already credited' });
  }
  res.json({ ok: true, amount, boostedUntil });
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
  // price null/undefined = stop new collects; 0 = free collect; >0 = SAGE price
  const p = price === null || price === undefined || price === '' ? null : Number(price);
  const currency = req.body?.currency === 'ETH' ? 'ETH' : 'SAGE';
  if (p !== null && (isNaN(p) || p < 0)) return res.status(400).json({ error: 'bad price' });
  if (p !== null && !parameters.SOCIAL_COLLECTS_ADDRESS)
    return res.status(400).json({ error: 'collecting is not enabled on this network yet' });
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
  if (post.authorAddress === r.walletAddress)
    return res.status(400).json({ error: 'you cannot collect your own post' });

  const already = await prisma.socialCollect.findUnique({
    where: { postId_collectorAddress: { postId: id, collectorAddress: r.walletAddress } },
  });
  if (already) return res.status(400).json({ error: 'already collected' });

  // pay in the post's currency straight to the author, or (points) burn pixels
  const currency = (post.collectCurrency === 'ETH' ? 'ETH' : 'SAGE') as 'SAGE' | 'ETH';
  let amount = 0;
  let pointsSpent: bigint | null = null;
  if (payWith === 'POINTS' && currency === 'ETH')
    return res.status(400).json({ error: 'points can only collect SAGE-priced posts' });
  if (payWith === 'POINTS' && post.collectPrice > 0) {
    const pointsPrice = BigInt(Math.ceil(post.collectPrice * POINTS_PER_SAGE));
    const [earned, spent] = await Promise.all([
      prisma.earnedPoints.findUnique({ where: { address: r.walletAddress } }),
      prisma.socialPointsSpend.aggregate({
        where: { address: r.walletAddress },
        _sum: { amount: true },
      }),
    ]);
    const available = (earned?.totalPointsEarned ?? BigInt(0)) - (spent._sum.amount ?? BigInt(0));
    if (available < pointsPrice)
      return res.status(400).json({
        error: `not enough pixels (need ${pointsPrice}, have ${available})`,
      });
    pointsSpent = pointsPrice;
  } else if (post.collectPrice > 0) {
    // the payment to the author must be mined + sufficient, in the post's currency
    if (!txHash) return res.status(400).json({ error: 'payment tx required' });
    const spent = await prisma.socialCollect.findUnique({ where: { payTxHash: txHash } });
    if (spent) return res.status(400).json({ error: 'this payment was already used' });
    try {
      amount = await verifyPayment(
        txHash,
        r.walletAddress,
        post.authorAddress,
        post.collectPrice,
        currency
      );
    } catch (e: any) {
      return res.status(400).json({ error: `payment not verified: ${e.message}` });
    }
  }

  // server-mints the post NFT to the collector (platform holds role.minter)
  const tokenUri = `${siteUrl()}/api/social/?action=GetPostMetadata&id=${id}`;
  const mint = await mintSocialCollectServerSide(r.walletAddress, tokenUri);

  await prisma.$transaction([
    prisma.socialCollect.create({
      data: {
        postId: id,
        collectorAddress: r.walletAddress,
        amount,
        currency,
        pointsSpent,
        payTxHash: amount > 0 ? txHash : null,
        mintTxHash: mint.txHash,
        contractAddress: parameters.SOCIAL_COLLECTS_ADDRESS,
        tokenId: mint.tokenId,
      },
    }),
    ...(pointsSpent !== null
      ? [
          prisma.socialPointsSpend.create({
            data: { address: r.walletAddress, amount: pointsSpent, reason: `collect:${id}` },
          }),
        ]
      : []),
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
        ? postCardSvgDataUri(post.text, author, post.createdAt)
        : post.imageUrl,
    ...(post.mediaType === 'video' && post.imageUrl ? { animation_url: post.imageUrl } : {}),
    attributes: [
      { trait_type: 'Author', value: author },
      { trait_type: 'Posted', display_type: 'date', value: Math.floor(post.createdAt.getTime() / 1000) },
    ],
  });
}

/** 800×800 dark card with the post text, in the SAGE design language. */
function postCardSvgDataUri(text: string, author: string, createdAt: Date): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // naive word wrap: ~34 chars/line, max 11 lines
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > 34) {
      lines.push(line.trim());
      line = w;
      if (lines.length === 10) break;
    } else line = (line + ' ' + w).trim();
  }
  if (line && lines.length < 11) lines.push(line.trim());
  if (words.join(' ').length > lines.join(' ').length) lines[lines.length - 1] += '…';
  const tspans = lines
    .map((l, i) => `<tspan x="60" dy="${i === 0 ? 0 : 44}">${esc(l)}</tspan>`)
    .join('');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">` +
    `<rect width="800" height="800" fill="#131917"/>` +
    `<rect x="24" y="24" width="752" height="752" fill="none" stroke="#d4fc52" stroke-width="2"/>` +
    `<text x="60" y="88" font-family="Space Grotesk,Arial,sans-serif" font-size="26" font-weight="800" fill="#d4fc52" letter-spacing="4">SAGE SOCIAL</text>` +
    `<text x="60" y="200" font-family="Space Grotesk,Arial,sans-serif" font-size="32" font-weight="600" fill="#eef3ec">${tspans}</text>` +
    `<text x="60" y="720" font-family="Arial,sans-serif" font-size="22" fill="#9daba0">${esc(author)} · ${createdAt.toISOString().slice(0, 10)}</text>` +
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

async function getLeaderboard(res: NextApiResponse) {
  const [tipped, tippers, burners, followed] = await Promise.all([
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
  ]);
  const cards = await userCards([
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
  });
}

async function getUserMints(address: string, res: NextApiResponse) {
  const addr = canon(address);
  if (!addr) return res.status(400).json({ error: 'bad address' });
  const collects = await prisma.socialCollect.findMany({
    where: { collectorAddress: addr },
    include: {
      Post: {
        include: { Author: { select: { username: true, profilePicture: true, verifiedAt: true } } },
      },
    },
    orderBy: { id: 'desc' },
    take: 60,
  });
  res.json({
    mints: collects.map((c) => ({
      tokenId: c.tokenId,
      contractAddress: c.contractAddress,
      amount: c.amount,
      pointsSpent: c.pointsSpent?.toString() ?? null,
      mintTxHash: c.mintTxHash,
      createdAt: c.createdAt,
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
    })),
  });
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

async function getConversations(res: NextApiResponse, r: { walletAddress: string }) {
  const me = r.walletAddress;
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
  res.json({
    conversations: partners.map((p) => ({
      partner: cards[p] || { address: p, username: null, verified: false },
      lastMessage: byPartner.get(p)!.last.text.slice(0, 80),
      lastAt: byPartner.get(p)!.last.createdAt,
      unread: byPartner.get(p)!.unread,
    })),
  });
}

async function getMessages(req: NextApiRequest, res: NextApiResponse, r: { walletAddress: string }) {
  const partner = canon(String(req.query.partner || req.body?.partner || ''));
  if (!partner) return res.status(400).json({ error: 'bad partner address' });
  const me = r.walletAddress;
  const messages = await prisma.socialMessage.findMany({
    where: {
      OR: [
        { fromAddress: me, toAddress: partner },
        { fromAddress: partner, toAddress: me },
      ],
    },
    orderBy: { id: 'desc' },
    take: 100,
  });
  // opening the thread reads it
  await prisma.socialMessage.updateMany({
    where: { fromAddress: partner, toAddress: me, readAt: null },
    data: { readAt: new Date() },
  });
  res.json({
    messages: messages.reverse().map((m) => ({
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
