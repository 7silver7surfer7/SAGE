import { NextApiRequest, NextApiResponse } from 'next';
import { Role } from '@prisma/client';
import { ethers } from 'ethers';
import { requireRole, getRequester } from '@/utilities/apiAuth';
import prisma from '@/prisma/client';
import { parameters } from '@/constants/config';
import {
  verifySageTransfer,
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
    createdAt: p.createdAt,
    replyToId: p.replyToId,
    likeCount: p.likeCount,
    repostCount: p.repostCount,
    replyCount: p.replyCount,
    tipTotal: p.tipTotal,
    boostBurned: p.boostBurned,
    isBoosted: !!(p.boostedUntil && new Date(p.boostedUntil) > new Date()),
    collectPrice: p.collectPrice,
    collectCount: p.collectCount,
    author: {
      address: p.authorAddress,
      username: p.Author?.username || null,
      profilePicture: p.Author?.profilePicture || null,
      pfpVerified: verifiedMap?.[p.authorAddress] || false,
    },
    likedByViewer: viewer ? (p.Likes?.length ?? 0) > 0 : false,
    repostedByViewer: viewer ? (p.Reposts?.length ?? 0) > 0 : false,
    collectedByViewer: viewer ? (p.Collects?.length ?? 0) > 0 : false,
  };
}

const postInclude = (viewer?: string | null) => ({
  Author: { select: { username: true, profilePicture: true, pfpNftId: true } },
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
      where: { replyToId: null, boostedUntil: { gt: new Date() } },
      include: postInclude(viewer),
      orderBy: { boostBurned: 'desc' },
      take: 5,
    });
  }

  const posts = await prisma.socialPost.findMany({
    where: {
      replyToId: null,
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
    where: { authorAddress: addr, replyToId: null },
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
  if (!post) return res.status(404).json({ error: 'not found' });
  const replies = await prisma.socialPost.findMany({
    where: { replyToId: id },
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
        },
      }),
      prisma.socialFollow.count({ where: { followingAddress: addr } }),
      prisma.socialFollow.count({ where: { followerAddress: addr } }),
      prisma.socialPost.count({ where: { authorAddress: addr, replyToId: null } }),
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
  res.json({
    address: addr,
    username: user?.username || null,
    profilePicture: user?.profilePicture || null,
    pfpVerified: user ? await isPfpVerified(user) : false,
    bio: user?.bio || null,
    bannerImageS3Path: user?.bannerImageS3Path || null,
    followers,
    following,
    postCount,
    followedByViewer: !!followsViewer,
    isSelf,
    followGatedDrops,
    myDrops: isSelf ? myDrops : [],
  });
}

async function createPost(
  req: NextApiRequest,
  res: NextApiResponse,
  r: { walletAddress: string }
) {
  const { text, imageUrl, replyToId } = req.body || {};
  const trimmed = (text || '').trim();
  if (!trimmed && !imageUrl) return res.status(400).json({ error: 'empty post' });
  if (trimmed.length > 500) return res.status(400).json({ error: 'post too long (500 max)' });

  const post = await prisma.socialPost.create({
    data: {
      authorAddress: r.walletAddress,
      text: trimmed,
      imageUrl: imageUrl || null,
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
  const id = Number(postId);
  if (!id || !txHash) return res.status(400).json({ error: 'bad tip' });
  const post = await prisma.socialPost.findUnique({ where: { id } });
  if (!post) return res.status(404).json({ error: 'post not found' });
  let amount: number;
  try {
    amount = await verifySageTransfer(txHash, r.walletAddress, post.authorAddress, 0);
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
          txHash,
        },
      }),
      prisma.socialPost.update({ where: { id }, data: { tipTotal: { increment: amount } } }),
    ]);
  } catch {
    return res.status(400).json({ error: 'this transaction was already recorded' });
  }
  res.json({ ok: true, amount });
}

async function boostPost(req: NextApiRequest, res: NextApiResponse, r: { walletAddress: string }) {
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
  const { postId, price } = req.body || {};
  const id = Number(postId);
  const post = await prisma.socialPost.findUnique({ where: { id } });
  if (!post) return res.status(404).json({ error: 'post not found' });
  if (post.authorAddress !== r.walletAddress)
    return res.status(403).json({ error: 'only the author can do that' });
  // price null/undefined = stop new collects; 0 = free collect; >0 = SAGE price
  const p = price === null || price === undefined || price === '' ? null : Number(price);
  if (p !== null && (isNaN(p) || p < 0)) return res.status(400).json({ error: 'bad price' });
  if (p !== null && !parameters.SOCIAL_COLLECTS_ADDRESS)
    return res.status(400).json({ error: 'collecting is not enabled on this network yet' });
  await prisma.socialPost.update({ where: { id }, data: { collectPrice: p } });
  res.json({ ok: true, collectPrice: p });
}

async function collectPost(
  req: NextApiRequest,
  res: NextApiResponse,
  r: { walletAddress: string }
) {
  const { postId, txHash } = req.body || {};
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

  // paid collects: the SAGE payment to the author must be mined + sufficient
  let amount = 0;
  if (post.collectPrice > 0) {
    if (!txHash) return res.status(400).json({ error: 'payment tx required' });
    const spent = await prisma.socialCollect.findUnique({ where: { payTxHash: txHash } });
    if (spent) return res.status(400).json({ error: 'this payment was already used' });
    try {
      amount = await verifySageTransfer(
        txHash,
        r.walletAddress,
        post.authorAddress,
        post.collectPrice
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
        payTxHash: post.collectPrice > 0 ? txHash : null,
        mintTxHash: mint.txHash,
        contractAddress: parameters.SOCIAL_COLLECTS_ADDRESS,
        tokenId: mint.tokenId,
      },
    }),
    prisma.socialPost.update({ where: { id }, data: { collectCount: { increment: 1 } } }),
  ]);
  res.json({ ok: true, tokenId: mint.tokenId, mintTxHash: mint.txHash });
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
    image: post.imageUrl || postCardSvgDataUri(post.text, author, post.createdAt),
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
