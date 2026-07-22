import prisma from '@/prisma/client';
import { addToWhitelistOnChain } from '@/utilities/serverWallet';

/**
 * Batched allowlist sync — the zero-per-follow-gas replacement.
 *
 * Follow-gate (and any other enqueuer) writes DropAllowlistEntry rows with
 * syncedAt: null and sends NO transaction; this flush pushes every pending
 * address for a drop in ONE addAddresses batch and stamps syncedAt. The old
 * flow paid one tx (plus a read) per individual follow.
 *
 * Triggers: the drop detail page view (throttled — so anyone looking at a
 * gated drop drains its queue within seconds) and the 10-min cron's
 * SyncAllowlists poke (the backstop when nobody is looking). Idempotent and
 * crash-safe: a failed batch leaves syncedAt null and retries next trigger;
 * re-adding an already-whitelisted address on-chain is a harmless overwrite.
 */
const inFlight = new Map<number, Promise<number>>();

export async function flushDropAllowlist(dropId: number, whitelistAddress: string): Promise<number> {
  const running = inFlight.get(dropId);
  if (running) return running;
  const p = (async () => {
    const pending = await prisma.dropAllowlistEntry.findMany({
      where: { dropId, syncedAt: null },
      select: { address: true },
      take: 200, // one comfortable tx; the next trigger drains any remainder
    });
    if (!pending.length) return 0;
    const addrs = pending.map((e) => e.address);
    await addToWhitelistOnChain(whitelistAddress, addrs);
    await prisma.dropAllowlistEntry.updateMany({
      where: { dropId, address: { in: addrs } },
      data: { syncedAt: new Date() },
    });
    console.log(`allowlist flush: drop ${dropId} +${addrs.length} address(es) in one tx`);
    return addrs.length;
  })().finally(() => inFlight.delete(dropId));
  inFlight.set(dropId, p);
  return p;
}

/** Cron-facing sweep: flush every gated drop that has pending entries. */
export async function flushAllPendingAllowlists(): Promise<{ drops: number; synced: number }> {
  const gated = await prisma.drop.findMany({
    where: {
      whitelistContractAddress: { not: null },
      AllowlistEntries: { some: { syncedAt: null } },
    },
    select: { id: true, whitelistContractAddress: true },
  });
  let synced = 0;
  for (const d of gated) {
    try {
      synced += await flushDropAllowlist(d.id, d.whitelistContractAddress!);
    } catch (e) {
      console.error(`allowlist flush failed for drop ${d.id}`, e);
    }
  }
  return { drops: gated.length, synced };
}
