import { NextApiRequest, NextApiResponse } from 'next';
import { ethers } from 'ethers';
import { getRequester } from '@/utilities/apiAuth';
import prisma from '@/prisma/client';
import { Role, SaleEventType } from '@prisma/client';
import { getSagePriceUsd } from '@/utilities/sagePrice';
import { parameters } from '@/constants/config';

export default async function (request: NextApiRequest, response: NextApiResponse) {
  const {
    query: { action },
    body,
  } = request;
  // was `const { address } = session!` — a null session crashed the destructure
  const requester = await getRequester(request);
  const walletAddress = requester?.walletAddress;
  if (!walletAddress) {
    response.status(401).end('Not Authenticated');
    return;
  }
  switch (action) {
    case 'RegisterSale':
      await registerSale(body, response);
      break;
    case 'RegisterRefund':
      await registerRefund(String(walletAddress), body, response);
      break;
    case 'GetSalesEvents':
      // full platform sales/revenue history — feeds the admin dashboard.
      // Only "signed in" was ever checked above, not role, so any regular
      // user could call this directly and see every sale platform-wide.
      if (requester?.role !== Role.ADMIN) {
        response.status(403).end('Forbidden');
        return;
      }
      await getSalesEvents(response);
      break;
  }
  response.end();
}

async function registerRefund(wallet: string, body: any, response: NextApiResponse) {
  const id = Number(body.refundId);
  if (isNaN(id)) {
    response.status(500).end();
    return;
  }
  const txHash = body.txHash;
  const blockTimestamp = body.blockTimestamp;
  const refundableResult = await prisma.refund.findMany({
    where: { id, buyer: wallet, txHash: null },
  });
  if (refundableResult.length == 1) {
    await prisma.refund.update({ where: { id }, data: { txHash, blockTimestamp } });
  }
  response.status(200);
}

async function registerSale(body: any, response: NextApiResponse) {
  var { eventType, eventId, amountTokens, amountPoints, buyer, txHash, blockTimestamp } = body;
  // No on-chain verification here (unlike social.page.ts's verifyPayment-
  // gated actions) — the amount/buyer/txHash are still self-reported by
  // whoever calls this, so this is a partial mitigation, not a full fix.
  // buyer is NOT required to match the caller — claimAuction's settleAuction
  // call is deliberately permissionless (anyone can finalize someone else's
  // won auction), so the caller registering the sale is often not the buyer.
  // What this DOES close: a caller can no longer spam-repeat the same fake
  // sale (each txHash counts once) or submit one with no txHash at all.
  if (!txHash) {
    response.status(400).json({ error: 'txHash required' });
    return;
  }
  // Reject nonsense/negative amounts — previously unvalidated, so any signed-
  // in wallet could record an arbitrary (e.g. wildly inflated) figure onto
  // the admin revenue dashboard with no numeric sanity check at all.
  const tokensNum = Number(amountTokens);
  if (amountTokens !== undefined && (!Number.isFinite(tokensNum) || tokensNum < 0)) {
    response.status(400).json({ error: 'bad amountTokens' });
    return;
  }
  const pointsNum = Number(amountPoints);
  if (amountPoints !== undefined && (!Number.isFinite(pointsNum) || pointsNum < 0)) {
    response.status(400).json({ error: 'bad amountPoints' });
    return;
  }
  const dupe = await prisma.saleEvent.findFirst({ where: { txHash } });
  if (dupe) {
    response.status(200).json({ ok: true }); // already recorded — not an error, just a no-op
    return;
  }
  // Doesn't verify the CLAIMED amount/buyer/eventId against the tx's actual
  // decoded logs (see the comment above — a full fix needs per-game-type
  // event decoding) but does close the "wholly fabricated, never-mined
  // txHash" gap: the transaction must at least genuinely exist and have
  // succeeded on the configured chain.
  try {
    const provider = new ethers.providers.StaticJsonRpcProvider(parameters.RPC_URL);
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt || receipt.status !== 1) {
      response.status(400).json({ error: 'txHash not found or not a successful transaction' });
      return;
    }
  } catch (e) {
    console.log(e);
    response.status(400).json({ error: 'could not verify txHash on-chain' });
    return;
  }
  const artistAddress = await findArtistAddress(eventType, Number(eventId));
  const tokenUSDValue = await getTokenUSDValue();
  const amountUSD = tokenUSDValue > 0 ? amountTokens * tokenUSDValue : null;
  const amountPixel = amountPoints && !isNaN(Number(amountPoints)) ? Number(amountPoints) : null;

  await prisma.saleEvent.create({
    data: {
      eventType,
      eventId,
      seller: artistAddress,
      buyer,
      txHash,
      blockTimestamp,
      amountUSD,
      amountPoints: amountPixel,
      amountTokens,
    },
  });
  response.status(200);
}

async function getSalesEvents(response: NextApiResponse) {
  console.log('getSalesEvents()');
  const result = await prisma.saleEvent.findMany({});
  response.json(result);
}

async function findArtistAddress(eventType: string, eventId: number) {
  var queryResult: any;
  switch (eventType) {
    case 'LOTTERY':
      queryResult = await prisma.lottery.findUnique({
        select: { Drop: { select: { artistAddress: true } } },
        where: { id: eventId },
      });
      return queryResult.Drop.artistAddress;
    case 'AUCTION':
      queryResult = await prisma.auction.findUnique({
        select: { Drop: { select: { artistAddress: true } } },
        where: { id: eventId },
      });
      return queryResult.Drop.artistAddress;
    case 'MARKETPLACE':
      queryResult = await prisma.nft.findUnique({
        select: { artistAddress: true },
        where: { id: eventId },
      });
      return queryResult.artistAddress;
  }
  throw new Error(`Unable to find a match for (${eventType}, ${eventId})`);
}

// TODO consider caching this value
async function getTokenUSDValue(): Promise<number> {
  try {
    // SAGE/USD from the token's live on-chain SAGE/WETH pair on Robinhood
    // mainnet. (DexScreener doesn't index Robinhood Chain, so the old lookup
    // here always returned 0.)
    const price = await getSagePriceUsd();
    return isNaN(price) ? 0.0 : price;
  } catch (e) {
    console.log(e);
    return 0.0;
  }
}
