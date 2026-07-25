import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/prisma/client';
import {
  gateMention,
  claimMention,
  recordOutcome,
  routeMention,
  type IncomingMention,
} from '@/utilities/xMentions';
import { xCreds, isLive, selfId, fetchMentions, postReply, uploadMedia } from '@/utilities/xClient';
import { generateImage } from '@/utilities/krea';
import { imagePriceFor, creditsForImage, DEFAULT_IMAGE_MODEL_ID } from '@/constants/modelPricing';
import { debitCredits } from '@/utilities/credits';
import { pinImageAndMetadata } from '@/utilities/pinArt';
import { PUBLIC_SITE_URL } from '@/constants/config';

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
      };

      // Claim first: two overlapping cycles must not both serve this.
      if (!(await claimMention(m))) continue;

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

      try {
        if (intent === 'generate') {
          // Cheapest tier for public traffic: a mention is not the place to
          // spend 30 credits of someone's balance without them choosing it.
          const model = imagePriceFor('krea-2-turbo');
          const job = await generateImage({
            prompt: raw.text.replace(/@\w+/g, '').trim().slice(0, 500),
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
          const claimUrl = pinned
            ? `${PUBLIC_SITE_URL}agent?claim=${m.tweetId}`
            : `${PUBLIC_SITE_URL}agent`;

          const posted = await postReply(
            creds,
            m.tweetId,
            replyText(
              m.authorHandle,
              pinned ? 'Made for you. Mint it here —' : 'Made for you.',
              pinned ? ` ${claimUrl}` : ''
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
        } else {
          // Critique is not built yet — record the demand rather than
          // pretending. This is what tells us whether to build it.
          await recordOutcome(m.tweetId, 'failed', {
            walletAddress: gate.walletAddress,
            intent,
          });
          counts.failed++;
        }
      } catch (e: any) {
        console.error('mention failed', m.tweetId, e?.message);
        await recordOutcome(m.tweetId, 'failed', { walletAddress: gate.walletAddress, intent });
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
