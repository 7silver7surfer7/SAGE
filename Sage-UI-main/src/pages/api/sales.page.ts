import { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from 'next-auth/react';
import prisma from '@/prisma/client';
import { SaleEventType } from '@prisma/client';
import { SAGE_PRICE_TOKEN_ADDRESS } from '@/constants/config';

export default async function (request: NextApiRequest, response: NextApiResponse) {
  const {
    query: { action },
    body,
  } = request;
  const session = await getSession({ req: request });
  const { address: walletAddress } = session!;
  if (!session || !walletAddress) {
    response.status(500).end();
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
    // SAGE/USD from the token's live DEX pair (Uniswap v2 on Robinhood Chain)
    const result = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${SAGE_PRICE_TOKEN_ADDRESS}`
    );
    const { pairs } = await result.json();
    const price = parseFloat(pairs?.[0]?.priceUsd);
    return isNaN(price) ? 0.0 : price;
  } catch (e) {
    console.log(e);
    return 0.0;
  }
}
