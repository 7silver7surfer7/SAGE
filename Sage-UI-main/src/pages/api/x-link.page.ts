import type { NextApiRequest, NextApiResponse } from 'next';
import { ethers } from 'ethers';
import prisma from '@/prisma/client';
import { getRequester, isCrossSiteRequest } from '@/utilities/apiAuth';
import { AUTHOR_DAILY_CAP, MIN_CREDITS } from '@/utilities/xMentions';

/**
 * Whether this wallet has an X account linked, and on what terms.
 *
 * The console's social-agent panel previously offered a free-text "@handle to
 * link to this wallet" box that wrote to React state and nothing else. Typing
 * a handle there proved no ownership, persisted nothing, and granted nothing —
 * while the surrounding copy promised the handle could spend from the wallet.
 * A claim of authority that the server has never seen is worse than no UI at
 * all, so the box is gone and this reports the real state.
 *
 * Linking happens ONLY through the OAuth round trip at /api/twitter/authorize,
 * which is what proves the person holds the account. The numeric id it stores
 * is the identity the mention gate keys on.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (isCrossSiteRequest(req, res)) return;

  const requester = await getRequester(req);
  if (!requester?.walletAddress) return res.status(401).json({ error: 'sign in first' });
  const walletAddress = ethers.utils.getAddress(requester.walletAddress);

  if (req.method === 'GET') {
    const user = await prisma.user.findUnique({
      where: { walletAddress },
      select: { twitterUsername: true, twitterUserId: true },
    });
    const linked = !!user?.twitterUserId;

    // Served today, so the panel shows the cap that actually applies rather
    // than the invented per-tweet ETH allowance the design mocked.
    let servedToday = 0;
    if (linked) {
      servedToday = await prisma.xMention.count({
        where: {
          authorXUserId: user!.twitterUserId!,
          outcome: 'answered',
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      });
    }

    return res.json({
      linked,
      handle: user?.twitterUsername || null,
      // the numeric id is what authorises; surfaced so support can match it
      xUserId: user?.twitterUserId || null,
      authorizeUrl: '/api/twitter/authorize',
      dailyCap: AUTHOR_DAILY_CAP,
      servedToday,
      minCredits: MIN_CREDITS,
    });
  }

  if (req.method === 'DELETE') {
    // Unlink. The mention gate reads twitterUserId, so clearing it is what
    // actually revokes — the handle is only ever display.
    await prisma.user.update({
      where: { walletAddress },
      data: { twitterUserId: null },
    });
    return res.json({ linked: false });
  }

  return res.status(405).json({ error: 'method not allowed' });
}
