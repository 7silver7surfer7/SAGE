import type { NextApiRequest, NextApiResponse } from 'next';
import { Role } from '@prisma/client';
import { requireRole, isCrossSiteRequest } from '@/utilities/apiAuth';
import { createAgentDrop } from '@/utilities/agentDrop';

/**
 * Turn an agent's drop CARD into real draft rows — the moment the human
 * confirms, and not one moment sooner.
 *
 * WHY THIS IS A SEPARATE ROUND TRIP
 * ---------------------------------
 * prepare_drop could have written these rows itself while composing the card.
 * It deliberately does not. A tool call is the MODEL's decision, and a model
 * iterating on a request ("make it 48 hours instead") would leave a trail of
 * unsigned drafts in the admin approval queue — and, worse, would promote the
 * wallet to ARTIST for a drop nobody ever agreed to. So prepare_drop only
 * pins the art (which must happen server-side while the generator's temporary
 * URL is alive) and describes the sale; the first write of any kind happens
 * here, behind a click.
 *
 * WHAT IS AND IS NOT TRUSTED
 * --------------------------
 * The body arrives from a card the model composed, so every field is re-derived
 * or re-clamped here — this is the authority, not the card:
 *   - artistAddress comes from the SESSION, never the body. It owns the drop,
 *     scopes the self-serve deploy actions in drops.page.ts, and takes the
 *     artist share of every sale.
 *   - the media URIs must be ones WE pinned. Otherwise this endpoint would
 *     mint an on-chain tokenURI pointing anywhere the caller likes.
 *   - numbers are clamped in createAgentDrop, which is the single place those
 *     bounds live.
 * Nothing here touches the chain or publishes anything: the rows land
 * unapproved, and only deployDrop (signed by the artist) makes them real.
 */

/**
 * The gateway pinArt writes to. Anything else is rejected — a tokenURI is
 * permanent and on-chain, so "some https URL the client sent" is not good
 * enough. Kept in sync with pinImageAndMetadata's own gateway resolution.
 */
const PIN_GATEWAY = process.env.FILEBASE_GATEWAY || 'https://ipfs.filebase.io/ipfs';

function isPinnedUri(uri: unknown): uri is string {
  return typeof uri === 'string' && uri.startsWith(`${PIN_GATEWAY}/`);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (isCrossSiteRequest(req, res)) return;
  const requester = await requireRole(req, res, [Role.USER, Role.ARTIST, Role.ADMIN]);
  if (!requester) return;

  const body = req.body || {};
  if (!isPinnedUri(body.imageUri) || !isPinnedUri(body.tokenUri)) {
    return res.status(400).json({ error: 'the artwork was not pinned by SAGE' });
  }

  try {
    const draft = await createAgentDrop({
      format: body.format === 'auction' ? 'auction' : 'open-edition',
      artistAddress: requester.walletAddress,
      name: String(body.name || ''),
      description: String(body.description || '').slice(0, 600),
      imageUri: body.imageUri,
      tokenUri: body.tokenUri,
      durationHours: Number(body.durationHours) || 24,
      price: Number(body.price) || 0,
      currency: 'ETH',
      maxPerUser: Number(body.maxPerUser) || 0,
      royaltyPercent: Number(body.royaltyPercent) || 10,
      symbol: String(body.symbol || ''),
    });
    return res.status(200).json(draft);
  } catch (e: any) {
    console.error('agent-drop :: could not create the draft', e);
    return res.status(400).json({ error: e?.message || 'the drop could not be created' });
  }
}
