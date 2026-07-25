import prisma from '@/prisma/client';

/**
 * The compute-credit ledger.
 *
 * Lives in utilities rather than inside the API page because more than one
 * caller needs it — the agent route, the credits route, and the @SAGEARTXYZ
 * mention gate. Importing a page module from a utility drags Next's page
 * machinery along with it.
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
