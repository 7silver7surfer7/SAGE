import prisma from '@/prisma/client';
import { getDropsPageData } from '@/prisma/functions';

/**
 * Art criticism — resolving a subject, and the rules the writing obeys.
 *
 * TWO PROPERTIES THIS FILE EXISTS TO HOLD
 *
 * 1. The MODEL NEVER SUPPLIES A URL. It names a subject in words; code decides
 *    what bytes get fetched, from where. That is the whole SSRF story, and it
 *    is why `resolveSubject` returns an opaque id rather than accepting one.
 *
 * 2. Criticism is INTERPRETATION, which the agent's system prompt otherwise
 *    forbids ("never state what a tool did not return"). The amendment is
 *    narrow on purpose: a reading of a picture may be asserted as a reading;
 *    a FACT about a work — who made it, when, what it sold for, what it is
 *    worth — still may not. Provenance and valuation are exactly what a
 *    confident critic hallucinates, and on SAGE inventory a valuation is a
 *    price opinion from the party selling the asset.
 */

/** Words that must never carry a match on their own. */
const STOPWORDS = new Set([
  'the', 'this', 'that', 'and', 'for', 'with', 'from', 'about', 'your', 'you',
  'what', 'think', 'drop', 'piece', 'work', 'art', 'artwork', 'nft', 'sage',
  'critique', 'review', 'please', 'give', 'tell', 'one',
]);

export interface CritiqueSubject {
  /** opaque, server-minted — never a URL from the model */
  ref: string;
  kind: 'drop';
  title: string;
  artist: string;
  /** the ARTWORK image, not the marketing banner */
  imageUrl: string;
  /** tool-returned facts the critique may state flatly */
  facts: Record<string, string>;
}

/**
 * Find a SAGE drop by free text.
 *
 * Drops only, deliberately. A bare named work ("critique Water Lilies") has no
 * image to look at and no tool grounding, so it is the branch where a critic
 * invents provenance — and it offers nothing this one does not.
 */
export async function resolveSubject(query: string): Promise<CritiqueSubject | null> {
  const q = String(query || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .trim();
  if (!q) return null;

  const drops = await getDropsPageData(prisma);
  if (!drops?.length) return null;

  const scored = drops
    .map((d: any) => {
      const name = String(d.name || '').toLowerCase();
      const artist = String(d.artistDisplayName || d.NftContract?.Artist?.username || '').toLowerCase();
      let score = 0;
      if (name && q.includes(name)) score = 1;
      else if (name && name.includes(q)) score = 0.9;
      else {
        // Stopwords score nothing. "the monet drop" was matching "The Routine"
        // on the word "the" — a confident critique of the wrong artwork, which
        // is worse than asking which one they meant.
        const words = q
          .split(/\s+/)
          .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
        const hits = words.filter((w) => name.includes(w) || artist.includes(w)).length;
        if (hits) score = 0.4 + 0.15 * hits;
      }
      return { d, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score < 0.4) return null;
  const d: any = best.d;

  // The joined NFT's artwork, NOT bannerImageS3Path. The banner is marketing
  // furniture; critiquing it would be critiquing the wrong object entirely.
  const nft = d.Nfts?.[0] || d.NftContract?.Nfts?.[0] || null;
  const imageUrl = nft?.s3PathOptimized || nft?.s3Path || d.bannerImageS3Path || '';
  if (!imageUrl) return null;

  const oe = d.OpenEditions?.[0];
  const facts: Record<string, string> = {};
  if (d.name) facts.title = String(d.name);
  const artist = d.artistDisplayName || d.NftContract?.Artist?.username || 'SAGE';
  facts.artist = String(artist);
  if (oe?.maxSupply) facts.edition = `${oe.mintCount ?? 0} of ${oe.maxSupply} minted`;
  if (oe?.costTokens) facts.price = `${oe.costTokens} ${d.currency === 'ETH' ? 'ETH' : 'SAGE'}`;
  if (nft?.description) facts.artistStatement = String(nft.description).slice(0, 400);

  return {
    ref: `drop:${d.id}`,
    kind: 'drop',
    title: String(d.name || 'Untitled'),
    artist: String(artist),
    imageUrl,
    facts,
  };
}

/** Fetch a subject's image bytes. Only ever called with a ref WE minted. */
export async function subjectImage(
  subject: CritiqueSubject
): Promise<{ bytes: Buffer; mime: string } | null> {
  try {
    const r = await fetch(subject.imageUrl);
    if (!r.ok) return null;
    const mime = r.headers.get('content-type') || 'image/jpeg';
    // Claude accepts JPEG/PNG/GIF/WebP only; SAGE also stores AVIF and TIFF.
    if (!/^image\/(jpeg|jpg|png|gif|webp)$/i.test(mime)) return null;
    const bytes = Buffer.from(await r.arrayBuffer());
    // 5 MB keeps us well inside the 10 MB base64 ceiling after encoding.
    if (!bytes.length || bytes.length > 5 * 1024 * 1024) return null;
    return { bytes, mime };
  } catch {
    return null;
  }
}

/**
 * The rules, appended as a SECOND system block so the cached prefix stays
 * byte-identical. Present only on turns that actually carry a critique.
 */
export const CRITIQUE_RULES = `You are writing art criticism. This is the ONE context where interpretation is permitted — elsewhere you may state only what a tool returned.

FOUR MOVEMENTS, in order, unlabelled — write them as prose, not as headings:
1. ANALYSIS — what is materially present. Composition, palette, facture, scale, what the eye reaches first. Observational and falsifiable. No meaning yet.
2. INTERPRETATION — what the work is doing. Subject, reference, the tradition it sits in. Marked as a reading throughout ("it reads as", "the picture seems to").
3. EVALUATION — judged against the work's OWN apparent ambition, and name that standard aloud so a reader can disagree with the criterion rather than only the verdict.
4. JUDGEMENT — one committed sentence. No hedge, no "ultimately", no both-sides. This is the part worth reading.

WHAT YOU MAY AND MAY NOT ASSERT:
- May assert flatly: what is visibly present in the image.
- May assert as YOUR OWN reading: interpretation, tradition, evaluation, judgement.
- Must come from a tool: every platform fact — title, artist, edition size, price. The tool result carries these; use those values and no others.
- Must NEVER appear: provenance, dates, sale history, valuation, or market language for any work; identification of any person depicted; any claim about whether an image is AI-generated; verbatim text from published criticism.

Do not rate the work on a scale and do not recommend buying or holding it. SAGE lists this work, so a price opinion here is the seller talking.

VOICE: the curator's register — precise, unhurried, austere. No emoji, no exclamation marks. Around 150 words unless asked for more.`;
