import crypto from 'crypto';
import { ethers } from 'ethers';
import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/prisma/client';
import { getRequester, isCrossSiteRequest } from '@/utilities/apiAuth';
import { PIXELS_TOKEN_ADDRESS, TRADE_CHAIN_ID, TRADE_RPC_URL } from '@/constants/config';
import { CAP_SAGE, RATE_SCALED, RATE_DIVISOR } from '@/constants/pixels';
import { dbResync } from '@/utilities/pixelsLedger';

/**
 * Link an external wallet so its SAGE balance accrues Pixels to this account.
 *
 * WHY THIS EXISTS
 * ---------------
 * Holdings moved into embedded/custodial wallets (Privy, via bankrbot) that the
 * holder controls but does not sign in with. Accrual reads balanceOf() on the
 * sign-in wallet, so those balances were invisible and earned nothing — the
 * people who migrated stopped earning while people who did not kept accruing.
 *
 * THE PROOF, AND WHY A BARE TRANSFER IS NOT ONE
 * ---------------------------------------------
 * "Send anything from the wallet to yourself" does NOT prove control: anyone
 * can send dust to anyone. A payout from a bot's hot wallet would let the
 * recipient claim that hot wallet and accrue on its entire balance. So the
 * server issues an EXACT random dust amount and only a transfer of precisely
 * that value counts. You cannot make someone else's wallet send an amount you
 * were just handed.
 *
 * Three further conditions, each closing a specific hole:
 *   - the sender must not be a CONTRACT  (else a pool or the token itself,
 *     which hold billions, could be claimed off an ordinary swap)
 *   - the transfer must land at or after the block the challenge was issued
 *     (an old transfer that happens to match cannot be replayed)
 *   - LinkedWallet.address is a PRIMARY KEY, so one wallet feeds exactly one
 *     account and a second claimant is rejected rather than paid alongside
 *
 * Balances are summed and the cap applied to the TOTAL (see pixelsLedger's
 * liveSageWhole), so linking can never earn more than holding in one wallet.
 */

/** Dust, but with enough entropy that an unrelated transfer never collides. */
// Written as BigInt(...) rather than 10n literals: this tsconfig targets below
// ES2020, which is why pixelsLedger.ts spells them the same way.
const MIN_DUST = BigInt('1000000000000'); // 0.000001 SAGE
const MAX_DUST = BigInt('10000000000000'); // 0.00001 SAGE
const CHALLENGE_MINUTES = 60;

/** This RPC rejects wider eth_getLogs windows — same cap as the indexer. */
const CHUNK = 2000;
const TRANSFER_TOPIC = ethers.utils.id('Transfer(address,address,uint256)');

function provider() {
  return new ethers.providers.StaticJsonRpcProvider(
    { url: TRADE_RPC_URL, timeout: 30000 },
    TRADE_CHAIN_ID
  );
}

/**
 * Is this `getCode` result an EIP-7702 delegated EOA rather than a contract?
 *
 * 7702 sets an EOA's code to exactly `0xef0100 || implementation` — 23 bytes,
 * nothing else. Modern embedded wallets (Privy, and Bankr on top of it) use it,
 * so a plain `getCode() !== '0x'` test rejects real personal wallets: the first
 * live attempt at this flow was refused for exactly that reason. The shape is
 * unforgeable by a normal contract, because no compiler emits a 23-byte runtime
 * beginning with the delegation prefix.
 *
 * This is NOT a general "is it a wallet" test and must not be loosened into
 * one — a true contract (the V4 PoolManager holds 77B, the token 15B) can be
 * made to emit an exact amount via a crafted swap, and linking it would credit
 * this account with balances it does not own.
 */
function isDelegatedEoa(code: string): boolean {
  return /^0xef0100[0-9a-fA-F]{40}$/.test(code);
}

function randomDust(): bigint {
  const span = MAX_DUST - MIN_DUST;
  // rejection-free: 8 random bytes reduced mod span is fine here — this value
  // only needs to be unguessable-by-accident, not key material
  const r = BigInt('0x' + crypto.randomBytes(8).toString('hex'));
  return MIN_DUST + (r % span);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (isCrossSiteRequest(req, res)) return;

  const requester = await getRequester(req);
  if (!requester?.walletAddress) {
    return res.status(401).json({ error: 'sign in to link a wallet' });
  }
  const address = ethers.utils.getAddress(requester.walletAddress);

  // ── list ────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const [links, challenge] = await Promise.all([
      prisma.linkedWallet.findMany({
        where: { walletAddress: address },
        select: { address: true, proof: true, verifiedAt: true },
      }),
      prisma.pixelLinkChallenge.findUnique({ where: { walletAddress: address } }),
    ]);
    return res.json({
      address,
      links,
      challenge:
        challenge && challenge.expiresAt > new Date()
          ? {
              token: PIXELS_TOKEN_ADDRESS,
              to: address,
              amountWei: challenge.amountWei,
              amount: ethers.utils.formatUnits(challenge.amountWei, 18),
              expiresAt: challenge.expiresAt,
            }
          : null,
    });
  }

  if (req.method === 'DELETE') {
    const target = String(req.query.address || '');
    if (!ethers.utils.isAddress(target)) return res.status(400).json({ error: 'bad address' });
    // scoped to THIS account: deleteMany with both keys, so a crafted request
    // cannot unlink somebody else's wallet
    await prisma.linkedWallet.deleteMany({
      where: { address: ethers.utils.getAddress(target), walletAddress: address },
    });
    return res.json({ unlinked: true });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  // ── issue a challenge ───────────────────────────────────────────────────
  if (req.body?.action === 'challenge') {
    const head = await provider().getBlockNumber();
    const amountWei = randomDust().toString();
    const expiresAt = new Date(Date.now() + CHALLENGE_MINUTES * 60_000);
    await prisma.pixelLinkChallenge.upsert({
      where: { walletAddress: address },
      create: { walletAddress: address, amountWei, fromBlock: head, expiresAt },
      update: { amountWei, fromBlock: head, expiresAt },
    });
    return res.json({
      token: PIXELS_TOKEN_ADDRESS,
      to: address,
      amountWei,
      amount: ethers.utils.formatUnits(amountWei, 18),
      expiresAt,
      instructions: `Send exactly ${ethers.utils.formatUnits(amountWei, 18)} SAGE from the wallet you want to link, to ${address}. The exact amount is what proves you control it.`,
    });
  }

  // ── verify ──────────────────────────────────────────────────────────────
  if (req.body?.action === 'verify') {
    const challenge = await prisma.pixelLinkChallenge.findUnique({
      where: { walletAddress: address },
    });
    if (!challenge) return res.status(400).json({ error: 'request a challenge first' });
    if (challenge.expiresAt < new Date()) {
      return res.status(400).json({ error: 'that challenge expired — request a new one' });
    }

    const p = provider();
    const head = await p.getBlockNumber();
    const want = ethers.BigNumber.from(challenge.amountWei);
    // topics: [Transfer, from=any, to=this account] — the node filters, so a
    // busy token does not stream every transfer back to us
    const toTopic = ethers.utils.hexZeroPad(address, 32);

    let match: { from: string } | null = null;
    for (let start = challenge.fromBlock; start <= head && !match; start += CHUNK) {
      const end = Math.min(start + CHUNK - 1, head);
      const logs = await p
        .getLogs({
          address: PIXELS_TOKEN_ADDRESS,
          topics: [TRANSFER_TOPIC, null, toTopic],
          fromBlock: start,
          toBlock: end,
        })
        .catch(() => []);
      for (const l of logs) {
        if (!ethers.BigNumber.from(l.data).eq(want)) continue;
        match = { from: ethers.utils.getAddress('0x' + l.topics[1].slice(26)) };
        break;
      }
    }

    if (!match) {
      return res.status(404).json({
        error: 'no matching transfer found yet',
        hint: `Send exactly ${ethers.utils.formatUnits(challenge.amountWei, 18)} SAGE to ${address}, then try again.`,
      });
    }

    // A CONTRACT sender is refused, and this is the load-bearing check rather
    // than a formality.
    //
    // Custodial bots (bankrbot) pool every user's tokens in ONE contract and
    // send from it on the user's behalf. The first real attempt at this flow
    // came from 0xe7222F…2164, which holds 5.24 BILLION SAGE — linking it
    // would have credited one account with everyone's balance, pinned at the
    // cap forever. The same is true of the V4 PoolManager (77B) and the token
    // itself (15B), either of which could emit an exact amount via a crafted
    // swap.
    //
    // The exact-amount challenge proves someone ARRANGED the send. It cannot
    // prove they OWN the sender's balance, and for a pooled custodian those
    // are different facts. So the balance is reported back: a user seeing
    // "that wallet holds 5.24B" understands the refusal immediately.
    const code = await p.getCode(match.from);
    if (code !== '0x' && !isDelegatedEoa(code)) {
      return res.status(400).json({
        error: 'that came from a contract, not a wallet',
        hint: `${match.from} is a contract. The pool and the token itself hold billions and can be made to emit an exact amount through a crafted swap, so linking one would hand this account the cap off balances it does not own.`,
      });
    }
    if (match.from === address) {
      return res.status(400).json({ error: 'that is already your sign-in wallet' });
    }

    const existing = await prisma.linkedWallet.findUnique({ where: { address: match.from } });
    if (existing) {
      return existing.walletAddress === address
        ? res.json({ linked: true, address: match.from, alreadyLinked: true })
        : res.status(409).json({ error: 'that wallet is already linked to another account' });
    }

    await prisma.$transaction([
      prisma.linkedWallet.create({
        data: { address: match.from, walletAddress: address, proof: 'transfer' },
      }),
      // one-shot: consume the challenge so the same dust cannot link a second
      // wallet, and so a replay of the scan cannot re-fire
      prisma.pixelLinkChallenge.delete({ where: { walletAddress: address } }),
    ]);

    // Re-checkpoint NOW. Without this the link is correct but inert: the sweep
    // takes the stalest accounts first, so a just-linked wallet sits at the
    // back of the queue and earns nothing until it happens to come round.
    // Best-effort — the link itself already succeeded and must not be undone
    // by a balance read failing.
    let rate: string | null = null;
    try {
      const live = await dbResync(address);
      const cap = BigInt(CAP_SAGE);
      const capped = live > cap ? cap : live;
      rate = ((capped * BigInt(RATE_SCALED)) / BigInt(RATE_DIVISOR)).toString();
    } catch (e: any) {
      console.error('pixels-link: linked but could not re-checkpoint', e?.message || e);
    }

    return res.json({ linked: true, address: match.from, proof: 'transfer', pixelsPerDay: rate });
  }

  return res.status(400).json({ error: 'unknown action' });
}
