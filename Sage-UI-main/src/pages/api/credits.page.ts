import type { NextApiRequest, NextApiResponse } from 'next';
import { ethers } from 'ethers';
import prisma from '@/prisma/client';
import { getCreditBalance } from '@/utilities/credits';
import { getRequester, isCrossSiteRequest } from '@/utilities/apiAuth';
import { tradeProvider, explorerTx } from '@/components/Agent/trade';
import { sendMail, notifyAddress } from '@/utilities/mailer';
import { creditPurchaseEmail } from '@/utilities/emails/creditPurchase';
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

export { getCreditBalance, debitCredits } from '@/utilities/credits';

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

  const newBalance = await getCreditBalance(address);

  // Notify the operator. Deliberately AFTER the transaction committed and
  // after the unique-constraint guard above, so a client retrying a dropped
  // response returns early via `alreadyClaimed` and cannot send a second mail
  // for one payment. sendMail never throws — a mail outage must not turn a
  // settled payment into a 500 — so this is awaited but its result ignored.
  await notifyCreditPurchase({
    address,
    tier,
    newBalance,
    paidUsd,
    weiPaid: paid,
    txHash,
  });

  return res.json({
    credits: newBalance,
    added: tier.credits,
    tier: tier.id,
    paidUsd: Number(paidUsd.toFixed(2)),
  });
}

/**
 * Assemble and send the "credits purchased" notification.
 *
 * Kept out of the handler body so the payment logic above reads as one
 * sequence. Every lookup in here is best-effort: the X handle is a nicety, and
 * failing to find it must not cost the notification.
 */
async function notifyCreditPurchase(p: {
  address: string;
  tier: { id: string; title: string; credits: number };
  newBalance: number;
  paidUsd: number;
  weiPaid: ethers.BigNumber;
  txHash: string;
}): Promise<void> {
  const to = notifyAddress();
  if (!to) return;

  let xHandle: string | null = null;
  try {
    const u = await prisma.user.findUnique({
      where: { walletAddress: p.address },
      select: { twitterUsername: true },
    });
    xHandle = u?.twitterUsername || null;
  } catch {
    /* the handle is decoration; send without it */
  }

  const { subject, html, text } = creditPurchaseEmail({
    address: p.address,
    tierTitle: p.tier.title,
    tierId: p.tier.id,
    creditsAdded: p.tier.credits,
    newBalance: p.newBalance,
    paidUsd: Number(p.paidUsd.toFixed(2)),
    paidEth: ethers.utils.formatEther(p.weiPaid),
    txHash: p.txHash,
    explorerUrl: explorerTx(p.txHash),
    xHandle,
    at: new Date().toISOString(),
  });

  await sendMail({ to, subject, html, text });
}
