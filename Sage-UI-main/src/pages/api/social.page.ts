import { NextApiRequest, NextApiResponse } from 'next';
import { Role } from '@prisma/client';
import { requireRole, getRequester } from '@/utilities/apiAuth';
import prisma from '@/prisma/client';

/**
 * SAGE Social — a wallet-native BlueSky clone. Identity is the SIWE wallet
 * (requester.walletAddress, taken from the JWT — never the query, so it can't
 * be spoofed). Posts can be tipped in SAGE; avatars are the user's NFT pfp.
 *
 * All mutating actions require a signed-in wallet; reads (feeds/profiles) are
 * public so the network is browsable before connecting.
 */
const AUTHED: Role[] = [Role.USER, Role.ARTIST, Role.ADMIN];

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
      default:
        return response.status(400).json({ error: 'unknown action' });
    }
  } catch (e: any) {
    console.error('social api error', e);
    return response.status(500).json({ error: e?.message || 'server error' });
  }
}

async function withAuth(
  req: NextApiRequest,
  res: NextApiResponse,
  fn: (r: { walletAddress: string }) => Promise<void>
) {
  const requester = await requireRole(req, res, AUTHED);
  if (!requester) return; // requireRole already sent 401
  await fn({ walletAddress: requester.walletAddress.toLowerCase() });
}

// Shape a post row for the client, folding in the viewer's like/repost state.
function serializePost(p: any, viewer?: string) {
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
    author: {
      address: p.authorAddress,
      username: p.Author?.username || null,
      profilePicture: p.Author?.profilePicture || null,
    },
    likedByViewer: viewer ? (p.Likes?.length ?? 0) > 0 : false,
    repostedByViewer: viewer ? (p.Reposts?.length ?? 0) > 0 : false,
  };
}

const postInclude = (viewer?: string) => ({
  Author: { select: { username: true, profilePicture: true } },
  ...(viewer
    ? {
        Likes: { where: { userAddress: viewer }, select: { userAddress: true } },
        Reposts: { where: { userAddress: viewer }, select: { userAddress: true } },
      }
    : {}),
});

async function getFeed(req: NextApiRequest, res: NextApiResponse) {
  const scope = (req.query.scope as string) || 'global'; // 'global' | 'following'
  const cursor = req.query.cursor ? Number(req.query.cursor) : undefined;
  const viewer = (await getRequester(req))?.walletAddress?.toLowerCase();

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
    where: { replyToId: null, ...authorFilter }, // top-level only in feeds
    include: postInclude(viewer),
    orderBy: { id: 'desc' },
    take: 21,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const nextCursor = posts.length > 20 ? posts[19].id : null;
  res.json({ posts: posts.slice(0, 20).map((p) => serializePost(p, viewer)), nextCursor });
}

async function getUserPosts(address: string, req: NextApiRequest, res: NextApiResponse) {
  const addr = address?.toLowerCase();
  const viewer = (await getRequester(req))?.walletAddress?.toLowerCase();
  const posts = await prisma.socialPost.findMany({
    where: { authorAddress: addr, replyToId: null },
    include: postInclude(viewer),
    orderBy: { id: 'desc' },
    take: 40,
  });
  res.json({ posts: posts.map((p) => serializePost(p, viewer)) });
}

async function getPost(id: number, req: NextApiRequest, res: NextApiResponse) {
  const viewer = (await getRequester(req))?.walletAddress?.toLowerCase();
  const post = await prisma.socialPost.findUnique({ where: { id }, include: postInclude(viewer) });
  if (!post) return res.status(404).json({ error: 'not found' });
  const replies = await prisma.socialPost.findMany({
    where: { replyToId: id },
    include: postInclude(viewer),
    orderBy: { id: 'asc' },
    take: 100,
  });
  res.json({
    post: serializePost(post, viewer),
    replies: replies.map((p) => serializePost(p, viewer)),
  });
}

async function getProfile(address: string, req: NextApiRequest, res: NextApiResponse) {
  const addr = address?.toLowerCase();
  const viewer = (await getRequester(req))?.walletAddress?.toLowerCase();
  const [user, followers, following, postCount, followsViewer] = await Promise.all([
    prisma.user.findUnique({
      where: { walletAddress: addr },
      select: { walletAddress: true, username: true, profilePicture: true, bio: true, bannerImageS3Path: true },
    }),
    prisma.socialFollow.count({ where: { followingAddress: addr } }),
    prisma.socialFollow.count({ where: { followerAddress: addr } }),
    prisma.socialPost.count({ where: { authorAddress: addr, replyToId: null } }),
    viewer
      ? prisma.socialFollow.findUnique({
          where: { followerAddress_followingAddress: { followerAddress: viewer, followingAddress: addr } },
        })
      : null,
  ]);
  res.json({
    address: addr,
    username: user?.username || null,
    profilePicture: user?.profilePicture || null,
    bio: user?.bio || null,
    bannerImageS3Path: user?.bannerImageS3Path || null,
    followers,
    following,
    postCount,
    followedByViewer: !!followsViewer,
    isSelf: viewer === addr,
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
  res.json({ post: serializePost(post, r.walletAddress) });
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
  const target = (req.body?.address as string)?.toLowerCase();
  if (!target || target === r.walletAddress)
    return res.status(400).json({ error: 'cannot follow that' });
  const key = {
    followerAddress_followingAddress: { followerAddress: r.walletAddress, followingAddress: target },
  };
  const existing = await prisma.socialFollow.findUnique({ where: key });
  if (existing) {
    await prisma.socialFollow.delete({ where: key });
    return res.json({ following: false });
  }
  // the target must be a known user (has signed in at least once)
  const targetUser = await prisma.user.findUnique({ where: { walletAddress: target } });
  if (!targetUser) return res.status(404).json({ error: 'user not found' });
  await prisma.socialFollow.create({
    data: { followerAddress: r.walletAddress, followingAddress: target },
  });
  res.json({ following: true });
}

async function recordTip(req: NextApiRequest, res: NextApiResponse, r: { walletAddress: string }) {
  // The SAGE transfer happens client-side (wallet-signed); this records the
  // receipt AFTER the tx is mined and bumps the post's running tip total.
  const { postId, toAddress, amount, txHash } = req.body || {};
  const id = Number(postId);
  const amt = Number(amount);
  if (!id || !toAddress || !amt || !txHash) return res.status(400).json({ error: 'bad tip' });
  const post = await prisma.socialPost.findUnique({ where: { id } });
  if (!post) return res.status(404).json({ error: 'post not found' });
  await prisma.$transaction([
    prisma.socialTip.create({
      data: {
        postId: id,
        fromAddress: r.walletAddress,
        toAddress: (toAddress as string).toLowerCase(),
        amount: amt,
        txHash,
      },
    }),
    prisma.socialPost.update({ where: { id }, data: { tipTotal: { increment: amt } } }),
  ]);
  res.json({ ok: true });
}
