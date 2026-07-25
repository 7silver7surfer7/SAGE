import type { NextApiRequest, NextApiResponse } from 'next';
import { ethers } from 'ethers';
import prisma from '@/prisma/client';
import { getRequester, isCrossSiteRequest } from '@/utilities/apiAuth';
import { tradeProvider } from '@/components/Agent/trade';
import { TRADE_CHAIN_NAME } from '@/constants/config';
import {
  CREDIT_TREASURY,
  CREDIT_TIERS,
  PRICE_TOLERANCE_BPS,
  weiForUsd,
} from '@/constants/credits';
import { getEthUsd } from '@/utilities/sagePrice';

/**
 * SAGE Agent compute credits.
 *
 * WHY THIS EXISTS
 * ---------------
 * The design metered credits in React state seeded with a starting balance,
 * and "purchase" incremented that number against a hardcoded tx hash. Nothing
 * was paid and nothing was owed. This route makes the balance real: it lives
 * in one database row per wallet, new wallets start at ZERO, and the only way
 * the number goes up is a settled ETH payment to the treasury that this server
 * has verified on-chain itself.
 *
 * SECURITY POSTURE
 * ----------------
 * 1. The client never states a balance or an amount. It submits a tx hash; the
 *    tier, the price and the credits are all resolved HERE from the on-chain
 *    value, so a tampered client can at most claim what it actually paid.
 * 2. `txHash` is UNIQUE in the schema. That constraint — not a read-then-write
 *    check — is what makes claiming idempotent, so two concurrent claims of
 *    the same payment cannot both succeed.
 * 3. The payer must be the session wallet. Otherwise anyone could watch the
 *    treasury for incoming payments and claim a stranger's credits first.
 * 4. Debits happen in the agent route, server-side, from real token usage.
 */

/** Read a wallet's balance, creating the zero row on first sight. */
export async function getCreditBalance(address: string): Promise<number> {
  const account = await prisma.agentCreditAccount.findUnique({
    where: { address },
    select: { credits: true },
  });
  return account?.credits ?? 0;
}

/**
 * Spend credits, returning the remaining balance.
 *
 * The conditional update is the concurrency guard: `credits: { gte: cost }`
 * makes the check and the decrement a single statement, so two simultaneous
 * turns cannot both pass a balance check and drive the account negative.
 *
 * A turn that costs more than the wallet had floors the account at zero rather
 * than failing. The work was already done and paid for upstream, so refusing
 * to record the spend would just give it away; the pre-flight check in the
 * agent route is what stops the next turn.
 */
export async function debitCredits(address: string, cost: number): Promise<number> {
  if (cost <= 0) return getCreditBalance(address);

  const exact = await prisma.agentCreditAccount.updateMany({
    where: { address, credits: { gte: cost } },
    data: { credits: { decrement: cost }, spent: { increment: cost } },
  });
  if (exact.count > 0) return getCreditBalance(address);

  const remaining = await getCreditBalance(address);
  if (remaining > 0) {
    await prisma.agentCreditAccount.updateMany({
      where: { address, credits: { gte: remaining } },
      data: { credits: { decrement: remaining }, spent: { increment: remaining } },
    });
  }
  return getCreditBalance(address);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (isCrossSiteRequest(req, res)) return;

  const requester = await getRequester(req);
  if (!requester?.walletAddress) {
    return res.status(401).json({ error: 'sign in to view credits' });
  }
  const address = ethers.utils.getAddress(requester.walletAddress);

  if (req.method === 'GET') {
    // Quote each tier in ETH at the CURRENT rate. The client pays the wei it
    // is given here; the claim below re-derives value independently, so a
    // stale or tampered quote cannot buy a tier cheaply.
    let ethUsd = 0;
    try {
      ethUsd = await getEthUsd();
    } catch {
      /* priced in USD regardless; the client just cannot pay until it returns */
    }
    return res.json({
      address,
      credits: await getCreditBalance(address),
      treasury: CREDIT_TREASURY,
      chain: TRADE_CHAIN_NAME,
      ethUsd: ethUsd || null,
      tiers: CREDIT_TIERS.map((t) => ({
        ...t,
        wei: ethUsd > 0 ? weiForUsd(t.usd, ethUsd).toString() : null,
        eth: ethUsd > 0 ? Number((t.usd / ethUsd).toFixed(6)) : null,
      })),
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const txHash = String(req.body?.txHash || '');
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return res.status(400).json({ error: 'a valid transaction hash is required' });
  }

  // Already claimed? Answer idempotently rather than erroring — a client that
  // retries after a dropped response should see success, not a scary failure.
  const existing = await prisma.agentCreditPurchase.findUnique({ where: { txHash } });
  if (existing) {
    if (existing.address !== address) {
      return res.status(409).json({ error: 'that payment was claimed by another wallet' });
    }
    return res.json({ credits: await getCreditBalance(address), alreadyClaimed: true });
  }

  // Verify the payment against the chain, not against anything the client said.
  const provider = tradeProvider();
  let tx: ethers.providers.TransactionResponse | null = null;
  let receipt: ethers.providers.TransactionReceipt | null = null;
  try {
    [tx, receipt] = await Promise.all([
      provider.getTransaction(txHash),
      provider.getTransactionReceipt(txHash),
    ]);
  } catch {
    return res.status(502).json({ error: 'could not reach the chain to verify that payment' });
  }
  if (!tx || !receipt) {
    return res.status(404).json({ error: 'that transaction is not on chain yet — wait for it to confirm' });
  }
  if (receipt.status !== 1) return res.status(400).json({ error: 'that transaction failed on chain' });
  if (tx.to?.toLowerCase() !== CREDIT_TREASURY.toLowerCase()) {
    return res.status(400).json({ error: 'that payment did not go to the SAGE treasury' });
  }
  if (tx.from.toLowerCase() !== address.toLowerCase()) {
    return res.status(403).json({ error: 'that payment was sent from a different wallet' });
  }

  // The amount PAID decides the tier — never the client's claim. Value it in
  // USD, because that is the denomination of the price; a tolerance absorbs
  // the ETH drift between quoting and confirming.
  const paid = tx.value;
  let ethUsd = 0;
  try {
    ethUsd = await getEthUsd();
  } catch {
    /* reported below */
  }
  if (!(ethUsd > 0)) {
    return res
      .status(503)
      .json({ error: 'the ETH price feed is unavailable — retry claiming in a moment' });
  }
  const paidUsd = Number(ethers.utils.formatEther(paid)) * ethUsd;
  const allowance = 1 + PRICE_TOLERANCE_BPS / 10000;
  const tier = CREDIT_TIERS.filter((t) => t.usd <= paidUsd * allowance).sort(
    (a, b) => b.usd - a.usd
  )[0];
  if (!tier) {
    const cheapest = CREDIT_TIERS[0];
    return res.status(400).json({
      error: `that payment is worth about $${paidUsd.toFixed(2)}, below the smallest tier ($${cheapest.usd.toFixed(2)})`,
    });
  }

  try {
    await prisma.$transaction([
      prisma.agentCreditPurchase.create({
        data: {
          txHash,
          address,
          tier: tier.id,
          credits: tier.credits,
          weiPaid: paid.toString(),
        },
      }),
      prisma.agentCreditAccount.upsert({
        where: { address },
        create: { address, credits: tier.credits },
        update: { credits: { increment: tier.credits } },
      }),
    ]);
  } catch (e: any) {
    // Unique violation = another request claimed it first. Idempotent success.
    if (e?.code === 'P2002') {
      return res.json({ credits: await getCreditBalance(address), alreadyClaimed: true });
    }
    throw e;
  }

  return res.json({
    credits: await getCreditBalance(address),
    added: tier.credits,
    tier: tier.id,
    paidUsd: Number(paidUsd.toFixed(2)),
  });
}
