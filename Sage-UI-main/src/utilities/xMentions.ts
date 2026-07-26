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
    // Transformation verbs. "rework" was missing once; "create" was missing
    // too, and "recreate this artwork as pixel art" is about the most natural
    // phrasing there is — it fell through to GENERATE on the word "mint" later
    // in the sentence and invented an unrelated picture instead of reworking
    // the image being replied to.
    '\\bre-?(work|create|generate|make|do|draw|paint|render|imagine|interpret|style|mix|cast)\\b',
    '\\b(rework|remake|restyle|reimagine|reinterpret)\\b',
    // "turn this into", "make it a", "do this as"
    '\\b(turn|convert|change|make|do)\\s+(this|it|that)\\s+(in)?to\\b',
    '\\b(turn|convert|change)\\s+(this|it|that)\\b',
    // "as a painting", "as an oil sketch" — a medium change IS a restyle.
    // The article is OPTIONAL: "as pixel art" and "as anime" are mass nouns
    // and take none, which is exactly how people write them. Requiring "as a"
    // missed "recreate this artwork as pixel art" entirely.
    '\\bas\\s+(an?\\s+)?\\w*\\s*(painting|sketch|watercolou?r|drawing|photo(graph)?|render|sculpture|print|etching|collage|illustration|portrait|mural|fresco|woodcut|engraving|anime|cartoon|pixel art)\\b',
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
const NOT_A_COMMISSION = new RegExp(
  [
    "\\b(make sure|make it so)\\b",
    "\\bcan you (make sure|fix|change|update|stop|add|remove)\\b",
    "\\b(why did|why does|what happened|it'?s not|doesn'?t work|didn'?t work|broken)\\b",
    "\\b(instead of|next time|always|please stop)\\b",
    // A suggestion thrown to the timeline is not an order to us: "someone
    // should make a series about @sage" is a thought, not a commission.
    "\\b(some(one|body)|y'?all|people|we)\\s+(should|ought to|need(s)? to)\\b",
    // THE AUTHOR is the one doing the making, so nothing is being asked of us:
    // "just tell me what feature you want implemented on @sage and I'll make
    // it happen" was rendered as an abstract painting and billed as a
    // commission. Someone offering to build something is not ordering art.
    "\\b(i|we)\\s*(?:'|’)?(?:ll|d|ve)?\\s*(?:will|can|could|shall|am gonna|'?m gonna)?\\s*(make|build|implement|create|add|ship|do|draw|paint)\\b",
  ].join('|'),
  'i'
);

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
  // NB: can/could/would/will are deliberately absent. "can you paint me a
  // quiet harbour" is a polite commission, and treating it as a question sent
  // it to chat. The genuine questions those words open ("can I mint?") fall
  // through to the subject test below and land on chat anyway, because
  // stripping the framing leaves nothing to draw.
  if (/^(how|what|why|when|where|who|which|do|does|did|is|are|should)\b/i.test(said)) {
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
  // Two characters is enough for "gm" — someone typed our handle on purpose.
  // The floor is that SOMETHING was said: punctuation and a lone emoji are not
  // a message, and answering them spends a credit on noise.
  const remainder = said.replace(/https?:\/\/\S+/g, ' ').trim();
  const hasWords = /[a-z0-9]{2}/i.test(remainder);
  return hasWords ? 'chat' : null;
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

  /**
   * A handle sitting after a preposition is a REFERENT, not an addressee. In
   * "just tell me what feature you want implemented on @sageartxyz", the author
   * is talking to their own audience ABOUT us — the same way "I minted on
   * @sageartxyz" or "check out @sageartxyz" is. Addressing us puts the handle
   * where a name goes in direct speech: "@sage what do you think", "hey @sage".
   *
   * This used to return true on ANY body occurrence, so every brand mention
   * read as a summons. `to` is deliberately excluded — "gm to @sage" really is
   * addressed — and so is the rest of the vocative-shaped punctuation.
   */
  const referential = new RegExp(
    `\\b(on|at|from|with|about|via|through|using|over|into|onto|by|out)\\s+@${handle}\\b`,
    'i'
  );
  if (new RegExp(`@${handle}\\b`, 'i').test(body) && !referential.test(body)) return true;

  /**
   * ANYWHERE in the leading handle block, not just first.
   *
   * This checked only the FIRST handle, which quietly made the bot unreachable
   * from the most ordinary way to summon it. Reply to somebody else's tweet
   * and tag us, and X auto-prepends the parent author's handle — so the text
   * that arrives is "@vladtenev @sageartxyz do some advanced math for us" and
   * our handle is in second position. The user typed us first; X put someone
   * else in front of us.
   *
   * The failure was silent and looked like nothing: the mention was read,
   * recorded ignored_not_addressed, and the cursor moved on. It only surfaced
   * because a human noticed a reply that never came. Every chat-shaped request
   * made this way had been dropped — generate/restyle/critique survived only
   * because the body check below rescues them.
   *
   * RESIDUAL, accepted knowingly: X also auto-prepends us when we are further
   * up a thread somebody else is replying to, and that shape is
   * indistinguishable from a typed summons without fetching the parent tweet
   * to see whether we are actually in it. Telling them apart costs a read per
   * ambiguous mention. Not paying that yet, because the credit gate bounds the
   * damage — only accounts linked to a funded wallet are ever answered, so an
   * unwanted reply can only land in a thread involving someone who opted in.
   * If it becomes a nuisance, the fix is to pass the parent's participants in
   * here, not to go back to reading one handle.
   */
  const leadHandles = (lead.match(/@(\w+)/g) || []).map((h) => h.slice(1).toLowerCase());
  if (leadHandles.includes(handle)) return true;

  // Mentioned mid-thread, so the handle alone proves nothing. Let the BODY
  // decide: replying to an artwork and tagging us is the natural way to ask
  // for a restyle or a critique, and refusing those was the first version of
  // this check being too blunt. A concrete commission counts as addressed;
  // small talk and a pasted contract address do not.
  const asked = routeMention({ ...m, text: body });
  return asked === 'generate' || asked === 'restyle' || asked === 'critique';
}
