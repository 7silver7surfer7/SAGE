import type { NextApiRequest, NextApiResponse } from 'next';
import { ethers } from 'ethers';
import prisma from '@/prisma/client';
import { getRequester, isCrossSiteRequest } from '@/utilities/apiAuth';

/**
 * Claim an artwork the bot made for you on X, so you can mint it here.
 *
 * THE LINK IS NOT THE CAPABILITY. The reply carrying it is public — anyone
 * reading the thread can open it. Authorisation is that the signed-in wallet
 * owns the X account that SENT the mention, matched on the numeric id the
 * OAuth round trip verified. A tweet id is an identifier, not a secret, and
 * treating it as one is how somebody else's artwork gets minted out from
 * under them.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (isCrossSiteRequest(req, res)) return;

  const requester = await getRequester(req);
  if (!requester?.walletAddress) {
    return res.status(401).json({ error: 'sign in to claim this' });
  }
  const walletAddress = ethers.utils.getAddress(requester.walletAddress);

  const tweetId = String(req.query.tweet || req.body?.tweet || '');
  if (!/^\d{5,24}$/.test(tweetId)) return res.status(400).json({ error: 'bad claim id' });

  const [mention, user] = await Promise.all([
    prisma.xMention.findUnique({ where: { tweetId } }),
    prisma.user.findUnique({
      where: { walletAddress },
      select: { twitterUserId: true, twitterUsername: true },
    }),
  ]);

  if (!mention || !mention.imageUri) {
    return res.status(404).json({ error: 'nothing to claim for that post' });
  }
  if (!user?.twitterUserId) {
    return res.status(403).json({ error: 'link your X account to claim this' });
  }
  // The whole gate: same X account, matched on the id, not the handle.
  if (user.twitterUserId !== mention.authorXUserId) {
    return res.status(403).json({ error: 'that artwork was made for a different X account' });
  }

  if (req.method === 'GET') {
    return res.json({
      tweetId,
      imageUri: mention.imageUri,
      tokenUri: mention.tokenUri,
      prompt: mention.prompt,
      handle: mention.authorHandle,
      alreadyMinted: !!mention.claimedTxHash,
      txHash: mention.claimedTxHash,
    });
  }

  // Record the deploy. On-chain is the source of truth; this stops the same
  // artwork being offered again once it has been minted.
  if (req.method === 'POST') {
    const txHash = String(req.body?.txHash || '');
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      return res.status(400).json({ error: 'a valid transaction hash is required' });
    }
    if (mention.claimedTxHash) {
      return res.json({ ok: true, txHash: mention.claimedTxHash, alreadyMinted: true });
    }
    await prisma.xMention.update({ where: { tweetId }, data: { claimedTxHash: txHash } });
    return res.json({ ok: true, txHash });
  }

  return res.status(405).json({ error: 'method not allowed' });
}
