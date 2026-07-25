import prisma from '@/prisma/client';
import { getCreditBalance } from '@/utilities/credits';

/**
 * @SAGEARTXYZ mention gate.
 *
 * THE COST PROPERTY THIS EXISTS TO GUARANTEE
 * ------------------------------------------
 * The bot answers only X accounts that are linked to a sageart.xyz wallet AND
 * hold compute credits. Everyone else is ignored in silence — no reply, no
 * model call, no image. An ignored mention costs two indexed SELECTs and a
 * row insert. Nothing here may ever call a paid API before `gate()` returns
 * allow:true; that ordering IS the cost control, and it is why a public
 * trigger can be left running.
 *
 * Silence rather than a "link your account" reply is deliberate. Replying to
 * strangers would mean hundreds of unsolicited promotional posts a day from
 * the brand account, which is what gets accounts suspended under X's platform
 * manipulation rules. A mention that is not served produces no post at all.
 *
 * IDENTITY IS THE NUMERIC X USER ID, NEVER THE HANDLE
 * --------------------------------------------------
 * Handles can be renamed, and the freed handle can be registered by anyone
 * within minutes. Authorizing on a handle means the bot eventually serves
 * whoever bought the name. `User.twitterUserId` is the key; the handle is
 * carried for display and logging only.
 */

/** Ignored outcomes are recorded too — that is what makes refusals auditable. */
export type MentionOutcome =
  | 'ignored_unlinked'
  | 'ignored_no_credits'
  | 'ignored_author_cap'
  | 'ignored_global_cap'
  | 'answered'
  | 'failed';

export interface IncomingMention {
  tweetId: string;
  authorXUserId: string;
  authorHandle: string;
  text: string;
  /** photo URLs attached to the mention itself, if any */
  mediaUrls?: string[];
}

export interface GateResult {
  allow: boolean;
  outcome: MentionOutcome;
  walletAddress?: string;
  credits?: number;
  /** safe to say out loud; ignored mentions are never replied to anyway */
  reason?: string;
}

/**
 * Caps exist for PLATFORM risk, not cost — credits already bound spend. A
 * credited user could legitimately burn their own balance across 200 mentions
 * while this account posts 200 replies in an hour, which is precisely the
 * automated-volume pattern X actions accounts for.
 */
export const AUTHOR_DAILY_CAP = 5;
export const GLOBAL_DAILY_CAP = 60;

/** A turn costs at least this much; below it, do not start work we cannot bill. */
export const MIN_CREDITS = 1;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Decide whether a mention gets served. Cheapest checks first, and every check
 * is a database read — no network, no model, no paid API.
 */
export async function gateMention(m: IncomingMention): Promise<GateResult> {
  // 1. LINKED? One indexed lookup on the numeric id.
  const user = await prisma.user.findUnique({
    where: { twitterUserId: m.authorXUserId },
    select: { walletAddress: true },
  });
  if (!user?.walletAddress) {
    return {
      allow: false,
      outcome: 'ignored_unlinked',
      reason: 'X account is not linked to a sageart.xyz wallet',
    };
  }

  // 2. CREDITED? The whole point — no balance, no work.
  const credits = await getCreditBalance(user.walletAddress);
  if (credits < MIN_CREDITS) {
    return {
      allow: false,
      outcome: 'ignored_no_credits',
      walletAddress: user.walletAddress,
      credits,
      reason: 'linked wallet holds no compute credits',
    };
  }

  // 3. CAPS. Counted from the mention ledger, which records answers only.
  const since = new Date(Date.now() - DAY_MS);
  const [authorAnswered, globalAnswered] = await Promise.all([
    prisma.xMention.count({
      where: { authorXUserId: m.authorXUserId, outcome: 'answered', createdAt: { gte: since } },
    }),
    prisma.xMention.count({ where: { outcome: 'answered', createdAt: { gte: since } } }),
  ]);
  if (authorAnswered >= AUTHOR_DAILY_CAP) {
    return {
      allow: false,
      outcome: 'ignored_author_cap',
      walletAddress: user.walletAddress,
      credits,
      reason: `author already served ${authorAnswered} times in 24h`,
    };
  }
  if (globalAnswered >= GLOBAL_DAILY_CAP) {
    return {
      allow: false,
      outcome: 'ignored_global_cap',
      walletAddress: user.walletAddress,
      credits,
      reason: `global daily reply cap (${GLOBAL_DAILY_CAP}) reached`,
    };
  }

  return { allow: true, outcome: 'answered', walletAddress: user.walletAddress, credits };
}

/**
 * Claim a mention for processing.
 *
 * The insert IS the lock: tweetId is the primary key, so a poller that
 * overlaps itself or replays a window cannot answer the same mention twice —
 * the same trick AgentCreditPurchase.txHash uses for payments. Returns false
 * when this mention has already been seen.
 */
export async function claimMention(m: IncomingMention): Promise<boolean> {
  try {
    await prisma.xMention.create({
      data: {
        tweetId: m.tweetId,
        authorXUserId: m.authorXUserId,
        authorHandle: m.authorHandle.slice(0, 40),
        outcome: 'seen',
      },
    });
    return true;
  } catch (e: any) {
    if (e?.code === 'P2002') return false; // already claimed
    throw e;
  }
}

export async function recordOutcome(
  tweetId: string,
  outcome: MentionOutcome,
  extra: {
    walletAddress?: string;
    intent?: 'critique' | 'generate';
    creditsSpent?: number;
    replyTweetId?: string;
  } = {}
): Promise<void> {
  await prisma.xMention.update({
    where: { tweetId },
    data: {
      outcome,
      walletAddress: extra.walletAddress ?? null,
      intent: extra.intent ?? null,
      creditsSpent: extra.creditsSpent ?? 0,
      replyTweetId: extra.replyTweetId ?? null,
    },
  });
}

/**
 * What a mention is asking for, decided by STRUCTURE not by asking a model.
 *
 * Routing on model output would put an attacker-controlled string in charge of
 * which tool set runs. This is a fixed lexicon over the tweet's shape, and it
 * fails closed: anything unrecognised is ignored rather than guessed at.
 */
export type MentionIntent = 'critique' | 'generate' | null;

const GENERATE_VERBS =
  /\b(mint|make|generate|create|draw|paint|render|imagine)\b/i;
const CRITIQUE_VERBS =
  /\b(critique|criticism|critic|review|analy[sz]e|interpret|evaluate|thoughts on|what do you think)\b/i;

export function routeMention(m: IncomingMention): MentionIntent {
  const text = m.text || '';
  const hasMedia = !!m.mediaUrls?.length;

  // Media present -> criticism, unconditionally. Cheap, reversible, touches no
  // key. It wins even over a generate verb: "make something of this" alongside
  // an image should read the image, not spend a render guessing at it.
  if (hasMedia) return 'critique';
  if (CRITIQUE_VERBS.test(text)) return 'critique';
  if (GENERATE_VERBS.test(text)) return 'generate';
  return null;
}
