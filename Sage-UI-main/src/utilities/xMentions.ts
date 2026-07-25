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
  | 'ignored_not_addressed'
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
  /** who this reply is aimed at, and who we are — to tell addressed from carried */
  inReplyToUserId?: string;
  selfUserId?: string;
  selfHandle?: string;
}

/**
 * Was the bot ACTUALLY spoken to, or just carried along?
 *
 * X auto-prepends every participant's handle to a thread reply and hides them
 * in the display, so a reply aimed at someone else still arrives as a mention.
 * The bot answered a contract address posted to another user, in a thread it
 * merely happened to be in, and looked like it was butting in — because it was.
 *
 * Addressed means one of: the handle appears in the BODY rather than only in
 * the auto-prepended block; the bot is the first handle in that block (a
 * deliberate "@sage ..."); or the reply is aimed at the bot itself.
 */
export function isAddressed(m: IncomingMention): boolean {
  const handle = (m.selfHandle || 'sageartxyz').toLowerCase();
  const text = m.text || '';

  // a reply aimed straight at us is always addressed
  if (m.selfUserId && m.inReplyToUserId && m.inReplyToUserId === m.selfUserId) return true;

  const lead = (text.match(/^(?:\s*@\w+)+/) || [''])[0];
  const body = text.slice(lead.length);
  if (new RegExp(`@${handle}\\b`, 'i').test(body)) return true;

  const firstHandle = (lead.match(/@(\w+)/) || [])[1];
  if (firstHandle && firstHandle.toLowerCase() === handle) return true;

  return false;
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
 * Caps exist for PLATFORM risk, not cost — credits already bound spend, and a
 * user burning their own balance is their business. What these bound is how
 * many times THIS ACCOUNT posts in a day, which is what X polices.
 *
 * The global cap must stay comfortably above the per-author one or a single
 * enthusiastic user starves everyone else. Both are well under the volumes
 * that read as automated spam; raise them together, not separately.
 */
export const AUTHOR_DAILY_CAP = 50;
export const GLOBAL_DAILY_CAP = 200;

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
    intent?: 'critique' | 'generate' | 'restyle' | 'chat';
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
export type MentionIntent = 'critique' | 'generate' | 'restyle' | 'chat' | null;

const GENERATE_VERBS =
  /\b(mint|make|generate|create|draw|paint|render|imagine)\b/i;
/**
 * Asking for the picture AGAIN, changed. Checked before critique, because a
 * mention with an image attached is otherwise read as "tell me about this" —
 * and "regenerate this in my style" is a commission, not a request for an
 * opinion.
 */
const RESTYLE_VERBS = new RegExp(
  [
    // transformation verbs — "rework" was missing and is the most natural one
    '\\bre-?(work|generate|make|do|draw|paint|render|imagine|interpret|style|mix|cast)\\b',
    '\\b(rework|remake|restyle|reimagine|reinterpret)\\b',
    // "turn this into", "make it a", "do this as"
    '\\b(turn|convert|change|make|do)\\s+(this|it|that)\\s+(in)?to\\b',
    '\\b(turn|convert|change)\\s+(this|it|that)\\b',
    // "as a painting", "as an oil sketch" — a medium change IS a restyle
    '\\bas an?\\s+\\w*\\s*(painting|sketch|watercolou?r|drawing|photo(graph)?|render|sculpture|print|etching|collage|illustration|portrait|mural|fresco|woodcut|engraving|anime|cartoon|pixel art)\\b',
    // bare "version" is safe here: restyle only fires when an image is
    // present, and "a pixel art version" of a picture is a restyle
    '\\bversion\\b',
    '\\bin (my|your|his|her|their|another|a different) style\\b',
    '\\bin the style of\\b',
  ].join('|'),
  'i'
);

const CRITIQUE_VERBS =
  /\b(critique|criticism|critic|review|analy[sz]e|interpret|evaluate|thoughts on|what do you think)\b/i;

/**
 * Phrases that use an art verb but are ABOUT the bot, not a commission.
 *
 * "can you make sure it's always full screen" matched GENERATE on the word
 * "make", was stripped to "sure it's always full screen", and rendered as an
 * anime portrait — billed to the person who was trying to file a bug report.
 * The verbs that request art are the verbs people use to talk about software.
 */
const NOT_A_COMMISSION =
  /\b(make sure|make it so|can you (make sure|fix|change|update|stop|add|remove)|why did|why does|what happened|it'?s not|doesn'?t work|didn'?t work|broken|instead of|next time|always|please stop)\b/i;

export function routeMention(m: IncomingMention): MentionIntent {
  const text = m.text || '';
  const hasMedia = !!m.mediaUrls?.length;

  // Media plus a restyle verb is a commission from that image.
  if (hasMedia && RESTYLE_VERBS.test(text)) return 'restyle';

  // Media present -> criticism, unconditionally. Cheap, reversible, touches no
  // key. It wins even over a generate verb: "make something of this" alongside
  // an image should read the image, not spend a render guessing at it.
  if (hasMedia) return 'critique';
  // Upthread images are not known at routing time; the worker resolves them.
  if (RESTYLE_VERBS.test(text)) return 'restyle';
  if (CRITIQUE_VERBS.test(text)) return 'critique';

  // Feedback and questions about the bot are never a commission, whatever
  // verbs they happen to contain — they get answered, not rendered.
  if (NOT_A_COMMISSION.test(text)) return 'chat';

  // A QUESTION is never a commission, even when it names an art verb.
  // "how do I mint?" is someone asking how minting works, not ordering a
  // picture — and answering it costs a fraction of rendering one.
  const said = text.replace(/@\w+/g, ' ').trim();
  if (/^(how|what|why|when|where|who|which|do|does|did|is|are|should|would|could|will|can)\b/i.test(said)) {
    return 'chat';
  }

  if (GENERATE_VERBS.test(text)) {
    // A commission needs a SUBJECT. After the request framing is stripped,
    // "can you make sure..." leaves nothing worth drawing, and rendering that
    // residue is how the generator invents something nobody asked for.
    const subject = text
      .replace(/@\w+/g, ' ')
      .replace(
        /\b(make|create|generate|draw|paint|render|mint|imagine|me|my|a|an|the|please|can|could|you|it|is|are|for|of|some|something)\b/gi,
        ' '
      )
      .replace(/[^a-zA-Z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (subject.length < 3) return 'chat';
    return 'generate';
  }

  // Anything else addressed to us is conversation. Empty mentions (a bare
  // @handle, or only a link) still get nothing — there is no question there.
  const remainder = said.replace(/https?:\/\/\S+/g, ' ').trim();
  return remainder.length >= 4 ? 'chat' : null;
}
