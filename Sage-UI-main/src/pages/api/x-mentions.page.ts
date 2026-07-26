import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/prisma/client';
import {
  gateMention,
  claimMention,
  recordOutcome,
  routeMention,
  isAddressed,
  selfSpokeInThread,
  type IncomingMention,
} from '@/utilities/xMentions';
import { xCreds, isLive, selfId, fetchMentions, postReply, uploadMedia, fetchTweetPhotos } from '@/utilities/xClient';
import { generateImage } from '@/utilities/krea';
import { imagePriceFor, creditsForImage, DEFAULT_IMAGE_MODEL_ID } from '@/constants/modelPricing';
import { debitCredits } from '@/utilities/credits';
import { pinImageAndMetadata } from '@/utilities/pinArt';
import { chatReply, critiqueReply, restylePrompt } from '@/utilities/mentionBrain';
import { resolveSubject, subjectImage } from '@/utilities/critique';
import { getDropsPageData } from '@/prisma/functions';
import { getSagePriceUsd } from '@/utilities/sagePrice';
import { PUBLIC_SITE_URL, parameters, TRADE_CHAIN_ID } from '@/constants/config';

/**
 * One poll cycle of @SAGEARTXYZ mentions.
 *
 * Poked by a scheduler. Public and unauthenticated by the same reasoning as
 * the other cron endpoints here — a bare curl from CI carries no DB creds —
 * and safe to be so because every step is idempotent: XMention.tweetId is the
 * primary key, so a mention claimed once is never served twice, and an extra
 * poke costs one cheap read.
 *
 * THE COST RULE: nothing paid happens before the gate passes. Reading mentions
 * costs $0.001 each; the gate is pure database. An unlinked or uncredited
 * author is recorded and IGNORED IN SILENCE — no model call, no render, no
 * reply. Silence also cannot be reported as spam, and X blocks unsummoned
 * replies at the API anyway, so a reply telling strangers to link an account
 * was never available even if we wanted it.
 */

/** Bounded per cycle so one poke cannot become an unbounded spend. */
const MAX_PER_CYCLE = 10;

async function cursor(key: string): Promise<string | undefined> {
  const row = await prisma.xBotState.findUnique({ where: { key } });
  return row?.value || undefined;
}

async function setCursor(key: string, value: string): Promise<void> {
  await prisma.xBotState.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

/**
 * Turn a mention into a render prompt.
 *
 * A tweet is an INSTRUCTION ("make me a monet"), not a visual description, and
 * Krea reads it literally — the first live reply returned a photograph of a
 * framed canvas sitting on a white surface, complete with margins, because
 * that is what "a monet" denotes when nothing else is said.
 *
 * The scaffold is deterministic rather than model-written. Tweet text is
 * attacker-controlled and this string reaches an image generator, so a fixed
 * frame around it is one less place for injected instructions to steer
 * anything. It also costs nothing.
 */
function artPrompt(tweetText: string): string {
  const subject = tweetText
    .replace(/@\w+/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    // strip the request framing so the subject is what remains
    .replace(/\b(make|create|generate|draw|paint|render|mint|imagine|me|a|an|please|can you|could you)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);

  const described = subject || 'an abstract painterly composition';
  return (
    `${described}. ` +
    'A finished painting rendered FULL BLEED — the artwork fills the entire frame edge to edge. ' +
    'No picture frame, no canvas edge, no border, no matting, no wall, no easel, no desk. ' +
    'Not a photograph of a painting: the painting itself, cropped to the frame.'
  );
}

/**
 * The only facts a chat reply may state, gathered by CODE.
 *
 * Passed in as text rather than reached through tools: a tweet cannot steer a
 * query it never gets to make, and this keeps the conversational path free of
 * anything that touches money.
 */
/** Whether this instance's database describes the chain the agent trades on. */
function dbIsMainnetData(): boolean {
  return Number(parameters.CHAIN_ID) === TRADE_CHAIN_ID;
}

async function liveContext(): Promise<string> {
  const parts: string[] = ['SAGE is an AI-native NFT platform on Robinhood Chain (mainnet).'];

  // Name drops ONLY when this instance's database is the mainnet one. A
  // localhost or staging build holds TESTNET drops, and the bot publicly
  // claimed it could speak to "The Routine" and "rMonet 2" with authority —
  // works that do not exist on the chain it trades on. Naming a drop nobody
  // can buy is worse than naming none: it sends people looking for something
  // that was never there.
  if (dbIsMainnetData()) {
    try {
      const drops = await getDropsPageData(prisma);
      if (drops?.length) {
        parts.push(
          'Current drops: ' +
            drops.slice(0, 8).map((d: any) => String(d.name)).filter(Boolean).join(', ') +
            '.'
        );
      }
    } catch {
      /* context is best-effort; a missing figure means the reply says so */
    }
  } else {
    parts.push(
      'You do NOT have the live drop list. Never name a specific drop, and never claim authority over one. Point people to sageart.xyz to see what is live.'
    );
  }
  try {
    const usd = await getSagePriceUsd();
    if (usd > 0) parts.push(`SAGE token price: $${usd.toPrecision(3)}.`);
  } catch {
    /* as above */
  }
  parts.push(
    'The bot can generate art from a mention and critique SAGE drops. Buying, selling and minting are signed by the user on sageart.xyz — never from a tweet.'
  );
  return parts.join(' ');
}

/**
 * Pull an image posted on X so it can be looked at.
 *
 * Pinned to X's own media host. The URL comes from the API rather than from
 * tweet text, but restricting the host anyway means a future change that lets
 * a URL in from somewhere else cannot turn this into a general fetcher.
 */
async function xPhotoBytes(url: string): Promise<{ base64: string; mime: string } | null> {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !/^(pbs|pbs-video)\.twimg\.com$/.test(u.hostname)) return null;
    const r = await fetch(url);
    if (!r.ok) return null;
    const mime = r.headers.get('content-type') || 'image/jpeg';
    if (!/^image\/(jpeg|jpg|png|gif|webp)$/i.test(mime)) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > 5 * 1024 * 1024) return null;
    return { base64: buf.toString('base64'), mime };
  } catch {
    return null;
  }
}

/** Compose the reply. Deterministic shell; the model only fills the middle. */
function replyText(handle: string, body: string, suffix: string): string {
  const at = handle ? `@${handle} ` : '';
  const room = 275 - at.length - suffix.length;
  const trimmed = body.length > room ? `${body.slice(0, Math.max(0, room - 1))}…` : body;
  return `${at}${trimmed}${suffix}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const creds = xCreds();
  if (!creds) {
    return res.status(503).json({ error: 'X credentials are not configured on this deployment' });
  }

  const counts = {
    seen: 0,
    ignored_unlinked: 0,
    ignored_no_credits: 0,
    ignored_capped: 0,
    ignored_not_addressed: 0,
    answered: 0,
    failed: 0,
    live: isLive(),
  };

  try {
    const me = await selfId(creds);
    if (!me.id) return res.status(502).json({ error: 'could not resolve the bot account' });

    const key = `mentions:${me.id}`;
    const since = await cursor(key);
    const mentions = await fetchMentions(creds, me.id, since, MAX_PER_CYCLE);
    counts.seen = mentions.length;

    // Newest id becomes the cursor even for mentions we ignore — otherwise a
    // wall of unlinked mentions is re-read, and re-paid for, every cycle.
    let newest = since || '';
    for (const m of mentions) if (m.id > newest) newest = m.id;

    for (const raw of mentions) {
      const m: IncomingMention = {
        tweetId: raw.id,
        authorXUserId: raw.authorId,
        authorHandle: raw.authorHandle,
        text: raw.text,
        mediaUrls: raw.photos,
        inReplyToUserId: raw.inReplyToUserId,
        selfUserId: me.id,
        selfHandle: me.username,
        conversationId: raw.conversationId,
      };

      // Claim first: two overlapping cycles must not both serve this.
      if (!(await claimMention(m))) continue;

      // Once we have answered in a thread, X prepends our handle to every
      // later reply in it and hides that from the reader — so the person
      // replying to somebody else looks, to us, exactly like someone calling
      // us. Knowing we already spoke here is what tells those apart.
      m.selfSpokeInThread = await selfSpokeInThread(raw.conversationId);

      // Being in the thread is not being spoken to. X hides the handles it
      // prepends to a reply, so a message aimed at someone else still lands
      // here — answering those is how a bot becomes the thing that interrupts.
      if (!isAddressed(m)) {
        await recordOutcome(m.tweetId, 'ignored_not_addressed');
        counts.ignored_not_addressed++;
        continue;
      }

      const gate = await gateMention(m);
      if (!gate.allow) {
        await recordOutcome(m.tweetId, gate.outcome, { walletAddress: gate.walletAddress });
        if (gate.outcome === 'ignored_unlinked') counts.ignored_unlinked++;
        else if (gate.outcome === 'ignored_no_credits') counts.ignored_no_credits++;
        else counts.ignored_capped++;
        continue;
      }

      const intent = routeMention(m);
      if (!intent) {
        await recordOutcome(m.tweetId, 'ignored_unlinked', { walletAddress: gate.walletAddress });
        continue;
      }

      let spent = 0;
      try {
        if (intent === 'generate') {
          // Cheapest tier for public traffic: a mention is not the place to
          // spend 30 credits of someone's balance without them choosing it.
          const model = imagePriceFor('krea-2-turbo');
          const job = await generateImage({
            prompt: artPrompt(raw.text),
            // 4:5 fills a phone screen; 1:1 leaves bands top and bottom, and
            // most of this audience reads X on mobile.
            aspectRatio: '4:5',
            model: model.id,
            timeoutMs: 60_000,
          });
          if (job.status !== 'completed' || !job.urls.length) {
            throw new Error(job.error || `generation ${job.status}`);
          }

          const cost = creditsForImage(model.id);
          await debitCredits(gate.walletAddress!, cost);

          // Pin NOW, not at claim time. Krea's URLs expire, so a claim link
          // pointing at one would rot before it was clicked — and the whole
          // value of the link is that it still works tomorrow.
          const title = (raw.text.replace(/@\w+/g, '').trim().slice(0, 40) || 'Untitled');
          let pinned: { tokenUri: string; imageUri: string } | null = null;
          try {
            pinned = await pinImageAndMetadata(job.urls[0], title, `Made for @${m.authorHandle} on X.`);
          } catch (e) {
            console.error('pin failed', e);
          }

          // Persist the artifact NOW, before anything that can fail. The reply
          // is the riskiest step (X permissions, rate limits, network) and a
          // 403 there previously discarded a rendered, pinned, already-paid-for
          // artwork — the user was charged and left with nothing.
          spent = cost;

          let mediaIds: string[] = [];
          try {
            const img = await fetch(job.urls[0]);
            const buf = Buffer.from(await img.arrayBuffer());
            mediaIds = [await uploadMedia(creds, buf, img.headers.get('content-type') || 'image/png')];
          } catch (e) {
            console.error('x media attach failed', e);
          }

          // The claim is keyed by TWEET ID and authorised against the X account
          // that sent it — see /api/x-claim. A link alone is not a capability:
          // the reply is public, so anyone can read it.
          //
          // Only offered when this instance IS the public one. A local run
          // writes the claim to a local database while the link points at the
          // deployed site, so the tweet would carry a mint link that 404s —
          // the art lands and the claim dies. Better to post the picture alone
          // than to publish a promise the reader cannot redeem.
          const isPublicInstance = String(parameters.APP_URL || '').startsWith('https://');
          const claimUrl =
            pinned && isPublicInstance ? `${PUBLIC_SITE_URL}agent?claim=${m.tweetId}` : '';

          const posted = await postReply(
            creds,
            m.tweetId,
            replyText(
              m.authorHandle,
              claimUrl ? 'Made for you. Mint it here —' : 'Made for you.',
              claimUrl ? ` ${claimUrl}` : ''
            ),
            mediaIds
          );
          await recordOutcome(m.tweetId, 'answered', {
            walletAddress: gate.walletAddress,
            intent,
            creditsSpent: cost,
            replyTweetId: posted.id,
          });
          if (pinned) {
            await prisma.xMention.update({
              where: { tweetId: m.tweetId },
              data: { imageUri: pinned.imageUri, tokenUri: pinned.tokenUri, prompt: title },
            });
          }
          counts.answered++;
        } else if (intent === 'restyle') {
          // Find the picture: attached here, or in the post being replied to.
          let photo = raw.photos[0] || null;
          if (!photo && raw.referencedTweetId) {
            photo = (await fetchTweetPhotos(creds, raw.referencedTweetId).catch(() => []))[0] || null;
          }
          const src = photo ? await xPhotoBytes(photo) : null;
          if (!src) {
            const { text, credits } = await chatReply(raw.text, await liveContext());
            await debitCredits(gate.walletAddress!, credits);
            spent = credits;
            const posted = await postReply(creds, m.tweetId, replyText(m.authorHandle, text, ''));
            await recordOutcome(m.tweetId, 'answered', {
              walletAddress: gate.walletAddress, intent: 'chat',
              creditsSpent: credits, replyTweetId: posted.id,
            });
            counts.answered++;
            continue;
          }

          // Vision writes the prompt: Krea takes text, not pictures, so the
          // image has to be READ before it can be re-rendered. Describing it
          // first is also what keeps the output anchored to the source.
          const { prompt, credits: readCost } = await restylePrompt(
            src.base64, src.mime, raw.text.replace(/@\w+/g, ' ').trim()
          );
          const model = imagePriceFor('krea-2-turbo');
          const job = await generateImage({
            prompt,
            aspectRatio: '4:5',
            model: model.id,
            timeoutMs: 60_000,
          });
          if (job.status !== 'completed' || !job.urls.length) {
            throw new Error(job.error || `generation ${job.status}`);
          }

          const cost = readCost + creditsForImage(model.id);
          await debitCredits(gate.walletAddress!, cost);

          const title = 'Restyled';
          let pinned: { tokenUri: string; imageUri: string } | null = null;
          try {
            pinned = await pinImageAndMetadata(job.urls[0], title, `Restyled for @${m.authorHandle} on X.`);
          } catch (e) {
            console.error('pin failed', e);
          }
          if (pinned) {
            await prisma.xMention.update({
              where: { tweetId: m.tweetId },
              data: { imageUri: pinned.imageUri, tokenUri: pinned.tokenUri, prompt },
            });
          }
          spent = cost;

          let mediaIds: string[] = [];
          try {
            const img = await fetch(job.urls[0]);
            const buf = Buffer.from(await img.arrayBuffer());
            mediaIds = [await uploadMedia(creds, buf, img.headers.get('content-type') || 'image/png')];
          } catch (e) {
            console.error('x media attach failed', e);
          }

          const isPublic = String(parameters.APP_URL || '').startsWith('https://');
          const claim = pinned && isPublic ? ` ${PUBLIC_SITE_URL}agent?claim=${m.tweetId}` : '';
          const posted = await postReply(
            creds,
            m.tweetId,
            replyText(m.authorHandle, claim ? 'Reworked. Mint it here —' : 'Reworked.', claim),
            mediaIds
          );
          await recordOutcome(m.tweetId, 'answered', {
            walletAddress: gate.walletAddress, intent,
            creditsSpent: cost, replyTweetId: posted.id,
          });
          counts.answered++;
        } else if (intent === 'critique') {
          // The artwork is usually in the post being REPLIED TO, not attached
          // to the mention — "critique this" points at something upthread.
          // Only fetched for mentions already cleared by the gate.
          let photo = raw.photos[0] || null;
          if (!photo && raw.referencedTweetId) {
            photo = (await fetchTweetPhotos(creds, raw.referencedTweetId).catch(() => []))[0] || null;
          }
          const onX = photo ? await xPhotoBytes(photo) : null;

          if (onX) {
            // An image from X carries no platform facts — so the critique
            // states none. It reads the picture and nothing else.
            const { text, credits } = await critiqueReply(
              'this work', 'an artist not listed on SAGE', 'none — state no facts about this work',
              onX.base64, onX.mime
            );
            await debitCredits(gate.walletAddress!, credits);
            spent = credits;
            const posted = await postReply(creds, m.tweetId, replyText(m.authorHandle, text, ''));
            await recordOutcome(m.tweetId, 'answered', {
              walletAddress: gate.walletAddress, intent,
              creditsSpent: credits, replyTweetId: posted.id,
            });
            counts.answered++;
            continue;
          }

          // Same rule as the context: a SAGE drop is only critiquable from a
          // mainnet database. Critiquing a testnet drop publicly presents a
          // work nobody can see or buy as part of the catalogue.
          const subject = dbIsMainnetData() ? await resolveSubject(raw.text) : null;
          const img = subject ? await subjectImage(subject) : null;
          if (!subject || !img) {
            // Nothing to look at. Answer as conversation rather than
            // critiquing a title — a critique without the work is invention.
            const { text, credits } = await chatReply(raw.text, await liveContext());
            await debitCredits(gate.walletAddress!, credits);
            spent = credits;
            const posted = await postReply(creds, m.tweetId, replyText(m.authorHandle, text, ''));
            await recordOutcome(m.tweetId, 'answered', {
              walletAddress: gate.walletAddress, intent: 'chat',
              creditsSpent: credits, replyTweetId: posted.id,
            });
            counts.answered++;
          } else {
            const facts = Object.entries(subject.facts)
              .map(([k, v]) => `${k}: ${v}`)
              .join('; ');
            const { text, credits } = await critiqueReply(
              subject.title, subject.artist, facts,
              img.bytes.toString('base64'), img.mime
            );
            await debitCredits(gate.walletAddress!, credits);
            spent = credits;
            const posted = await postReply(creds, m.tweetId, replyText(m.authorHandle, text, ''));
            await recordOutcome(m.tweetId, 'answered', {
              walletAddress: gate.walletAddress, intent,
              creditsSpent: credits, replyTweetId: posted.id,
            });
            counts.answered++;
          }
        } else {
          // chat — a question, a remark, or feedback. Tool-free by design.
          const { text, credits } = await chatReply(raw.text, await liveContext());
          await debitCredits(gate.walletAddress!, credits);
          spent = credits;
          const posted = await postReply(creds, m.tweetId, replyText(m.authorHandle, text, ''));
          await recordOutcome(m.tweetId, 'answered', {
            walletAddress: gate.walletAddress, intent,
            creditsSpent: credits, replyTweetId: posted.id,
          });
          counts.answered++;
        }
      } catch (e: any) {
        console.error('mention failed', m.tweetId, e?.message);
        // Record what was actually charged. The artwork is already stored, so
        // the next cycle can retry the reply rather than re-rendering it.
        await recordOutcome(m.tweetId, 'failed', {
          walletAddress: gate.walletAddress,
          intent,
          creditsSpent: spent,
        });
        counts.failed++;
      }
    }

    if (newest && newest !== since) await setCursor(key, newest);
    return res.status(200).json({ ...counts, account: me.username, cursor: newest || null });
  } catch (e: any) {
    console.error('x mention cycle failed', e?.message);
    return res.status(502).json({ error: e?.message || 'mention cycle failed', ...counts });
  }
}
