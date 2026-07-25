import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/prisma/client';
import { getRequester, isCrossSiteRequest } from '@/utilities/apiAuth';
import { getDropsPageData } from '@/prisma/functions';
import { getSagePriceUsd } from '@/utilities/sagePrice';
import { parameters } from '@/constants/config';

/**
 * SAGE Agent — server-side model call.
 *
 * SECURITY POSTURE (read before adding a tool)
 * --------------------------------------------
 * 1. The API key lives here and only here. It is never returned, never logged,
 *    and there is no NEXT_PUBLIC_ variant.
 * 2. Every tool in this file is READ-ONLY. The agent can look up drops, token
 *    figures and a public address's balances — nothing more.
 * 3. Money actions do NOT execute. `prepare_buy` returns an INTENT which the
 *    client renders as a pending transaction card; the user's own wallet signs
 *    it. This server holds no key to anyone's funds, so a prompt injection can
 *    at worst propose a trade the user then declines. Keep it that way: if a
 *    future tool needs to move value, it must return an intent, not a receipt.
 * 4. Auth + rate limit are cost controls, not just access controls — an open
 *    route here is a metered bill someone else can run up.
 */

const API = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Model allowlist. The client sends a model id and we must never pass it
 * through unchecked — an arbitrary string lets a caller select the most
 * expensive model available, or a nonexistent one that just burns retries.
 */
const MODELS: Record<string, { api: string; maxTokens: number }> = {
  'claude-opus-5': { api: 'claude-opus-4-5', maxTokens: 1200 },
  'claude-sonnet-5': { api: 'claude-sonnet-4-5', maxTokens: 1200 },
  'claude-fable-5': { api: 'claude-sonnet-4-5', maxTokens: 1200 },
  'claude-haiku-4-5': { api: 'claude-haiku-4-5', maxTokens: 1000 },
};
const DEFAULT_MODEL = 'claude-sonnet-5';

/** Hard ceilings — a runaway tool loop is the expensive failure mode. */
const MAX_TOOL_ROUNDS = 5;
const MAX_HISTORY = 12;
const MAX_INPUT_CHARS = 4000;

const SYSTEM = `You are SAGE AGENT, the AI curator of SAGE — an AI-native NFT platform on Robinhood Chain.

VOICE: an art-world curator who also reads chain data. Precise, unhurried, a little austere. No emoji, no hype, no exclamation marks. Short paragraphs, two to four sentences.

FACTUAL LIMITS — obey strictly:
- Your tools are the ONLY source of truth. Never name a drop, artist, price, edition count or date that a tool did not return.
- If asked what is coming next, say nothing has been announced. Never imply a roadmap, allowlist or future drop.
- Never present a guess as platform news.

TOOLS: use them whenever a drop, token figure or balance is involved. Each renders a visual card in the interface, so do NOT repeat every number in prose — add the context or judgement the card cannot.

TRANSACTIONS: you cannot execute anything. prepare_buy builds an UNSIGNED order that the user signs in their own wallet; the agent never holds custody. Say plainly what a purchase will cost, surface the order, and let them sign. Never claim a purchase is complete.

NEWCOMERS: explain wallets, minting, gas and Pixels plainly, without condescension.`;

// ── rate limit ──────────────────────────────────────────────────────────────
// Per-wallet, in-process. Cloud Run may run several instances, so this is a
// brake on a single runaway client rather than a global quota — the real spend
// ceiling is the credit meter in the client plus the account's own API limit.
const hits = new Map<string, number[]>();
function rateLimited(key: string, max: number, windowMs = 60_000) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) return true;
  arr.push(now);
  hits.set(key, arr);
  return false;
}

// ── tools ───────────────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'list_drops',
    description:
      'List every SAGE drop currently visible on the platform, with status, price and edition counts. Use this for "what has SAGE dropped", "what is live", or any question about the catalogue.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_token_stats',
    description: 'Current SAGE token figures — price in USD and the chain it trades on.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_balances',
    description:
      "Read a public address's SAGE balance. Only call this when the user has connected a wallet and asks about their holdings.",
    input_schema: {
      type: 'object',
      properties: { address: { type: 'string', description: '0x… wallet address' } },
      required: ['address'],
    },
  },
  {
    name: 'prepare_buy',
    description:
      'Build an UNSIGNED order to buy SAGE with ETH. This does NOT execute — it returns an order for the user to sign in their own wallet. Requires a connected wallet.',
    input_schema: {
      type: 'object',
      properties: {
        eth_amount: { type: 'number', description: 'ETH to spend, e.g. 0.01' },
      },
      required: ['eth_amount'],
    },
  },
];

type Card = Record<string, any>;

async function runTool(
  name: string,
  input: any,
  ctx: { address: string | null; cards: Card[]; steps: string[] }
): Promise<string> {
  if (name === 'list_drops') {
    ctx.steps.push('READING DROP INDEX');
    const drops = await getDropsPageData(prisma);
    const rows = drops.map((d: any) => {
      const oe = d.OpenEditions?.[0];
      const auction = d.Auctions?.[0];
      const currency = d.currency === 'ETH' ? 'ETH' : 'SAGE';
      return {
        title: d.name,
        artist: d.artistDisplayName || d.NftContract?.Artist?.username || 'SAGE',
        status: oe ? 'OPEN EDITION' : auction ? 'AUCTION' : 'DROP',
        price: oe ? `${oe.costTokens} ${currency}` : auction?.minimumPrice ?? null,
        editions: oe?.maxSupply ?? null,
        minted: oe?.mintCount ?? null,
        image: d.bannerImageS3Path || null,
      };
    });
    rows.forEach((r) =>
      ctx.cards.push({
        kind: 'drop',
        status: r.status,
        chain: 'ROBINHOOD CHAIN',
        title: r.title,
        byline: 'by ' + r.artist,
        price: r.price ?? '—',
        editions: r.editions != null ? String(r.editions) : 'OPEN',
        minted: r.minted != null ? String(r.minted) : '—',
        imgUrl: r.image,
        imgHint: 'Drop artwork',
      })
    );
    return JSON.stringify({ drops: rows, count: rows.length });
  }

  if (name === 'get_token_stats') {
    ctx.steps.push('QUERYING TOKEN ORACLE');
    let usd = 0;
    try {
      usd = await getSagePriceUsd();
    } catch {
      /* price feed is best-effort; the model is told when it is unavailable */
    }
    const rows = [
      { k: 'SAGE', v: usd > 0 ? '$' + usd.toPrecision(3) : 'unavailable' },
      { k: 'CHAIN', v: 'ROBINHOOD' },
      { k: 'CHAIN ID', v: String(parameters.CHAIN_ID) },
    ];
    ctx.cards.push({ kind: 'stats', status: 'SAGE TOKEN', byline: 'LIVE', rows });
    return JSON.stringify({ sage_usd: usd || null, chain_id: parameters.CHAIN_ID });
  }

  if (name === 'get_balances') {
    // The address is taken from the SESSION, never from the model's argument —
    // otherwise a prompt injection could read an arbitrary third party's
    // holdings through our server.
    if (!ctx.address) {
      ctx.cards.push({
        kind: 'wallet',
        status: 'WALLET REQUIRED',
        title: 'Connect to read your holdings.',
        body: 'The agent never holds custody. Connecting only grants read access until you sign.',
        needsConnect: true,
        rows: [],
      });
      return 'ERROR: no wallet connected. Tell the user to connect using the card shown.';
    }
    ctx.steps.push('READING WALLET · ' + ctx.address.slice(0, 6) + '…' + ctx.address.slice(-4));
    const { ethers } = await import('ethers');
    const provider = new ethers.providers.StaticJsonRpcProvider(parameters.RPC_URL);
    const token = new ethers.Contract(
      parameters.ASHTOKEN_ADDRESS,
      ['function balanceOf(address) view returns (uint256)'],
      provider
    );
    const raw = await token.balanceOf(ctx.address);
    const sage = Number(ethers.utils.formatEther(raw));
    ctx.cards.push({
      kind: 'wallet',
      status: 'CONNECTED · ' + ctx.address.slice(0, 6) + '…' + ctx.address.slice(-4),
      title: 'Holdings',
      body: 'Read-only snapshot at current block.',
      rows: [{ k: 'SAGE', v: sage.toLocaleString('en-US') }],
    });
    return JSON.stringify({ address: ctx.address, sage });
  }

  if (name === 'prepare_buy') {
    // Returns an INTENT. Nothing is signed here and this server holds no key
    // to the user's funds — the client renders a pending card and the user's
    // own wallet executes it.
    const eth = Number(input?.eth_amount);
    if (!Number.isFinite(eth) || eth <= 0) return 'ERROR: eth_amount must be a positive number.';
    if (!ctx.address) {
      ctx.cards.push({
        kind: 'wallet',
        status: 'WALLET REQUIRED',
        title: 'Connect a wallet to trade.',
        body: 'Orders are signed in your own wallet. The agent never holds custody.',
        needsConnect: true,
        rows: [],
      });
      return 'ERROR: no wallet connected. Tell the user to connect using the card shown.';
    }
    ctx.steps.push('BUILDING ORDER · ' + eth + ' ETH → SAGE');
    ctx.cards.push({
      kind: 'tx',
      status: 'UNSIGNED ORDER',
      byline: 'ROBINHOOD CHAIN · YOU SIGN',
      title: `Buy SAGE with ${eth} ETH`,
      pending: true,
      cta: 'sign & buy',
      // consumed by the client to build the actual transaction
      intent: { action: 'buy_sage', ethAmount: eth },
      rows: [
        { k: 'SPEND', v: `${eth} ETH` },
        { k: 'VENUE', v: 'SAGE' },
        { k: 'CHAIN', v: 'ROBINHOOD' },
      ],
    });
    return JSON.stringify({
      prepared: true,
      eth_amount: eth,
      note: 'Unsigned order surfaced to the user. They must sign it; do not claim it settled.',
    });
  }

  return 'ERROR: unknown tool';
}

// ── handler ─────────────────────────────────────────────────────────────────
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (isCrossSiteRequest(req, res)) return;

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(503).json({ error: 'the agent is not configured on this deployment' });

  // Auth is a COST control here as much as an access control.
  const requester = await getRequester(req);
  if (!requester) return res.status(401).json({ error: 'Please sign in' });
  if (rateLimited(requester.walletAddress, 10)) {
    return res.status(429).json({ error: 'slow down — 10 messages per minute' });
  }

  const body = req.body || {};
  const text = String(body.text || '').slice(0, MAX_INPUT_CHARS);
  if (!text.trim()) return res.status(400).json({ error: 'empty message' });

  const chosen = MODELS[String(body.model)] ? String(body.model) : DEFAULT_MODEL;
  const model = MODELS[chosen];

  // Only the connected address the SESSION proves — never one the client claims.
  const ctx = { address: requester.walletAddress || null, cards: [] as Card[], steps: [] as string[] };

  const history = Array.isArray(body.history)
    ? body.history
        .slice(-MAX_HISTORY)
        .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
        .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, MAX_INPUT_CHARS) }))
    : [];

  const messages: any[] = history.concat([{ role: 'user', content: text }]);

  try {
    let rounds = 0;
    let finalText = '';

    while (rounds < MAX_TOOL_ROUNDS) {
      rounds++;
      const r = await fetch(API, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: model.api,
          max_tokens: model.maxTokens,
          system: SYSTEM,
          tools: TOOLS,
          messages,
        }),
      });

      if (!r.ok) {
        const detail = await r.text();
        // Never echo the upstream body wholesale — it can restate request
        // headers. Log server-side, return a short reason.
        console.error('agent upstream error', r.status, detail.slice(0, 500));
        return res.status(502).json({ error: `model request failed (${r.status})` });
      }

      const data = await r.json();
      const blocks = Array.isArray(data.content) ? data.content : [];
      finalText = blocks
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('\n')
        .trim();

      const toolUses = blocks.filter((b: any) => b.type === 'tool_use');
      if (data.stop_reason !== 'tool_use' || !toolUses.length) break;

      messages.push({ role: 'assistant', content: blocks });
      const results = [];
      for (const t of toolUses) {
        let out: string;
        try {
          out = await runTool(t.name, t.input, ctx);
        } catch (e: any) {
          console.error('agent tool error', t.name, e?.message);
          out = 'ERROR: tool failed';
        }
        results.push({ type: 'tool_result', tool_use_id: t.id, content: out });
      }
      messages.push({ role: 'user', content: results });
    }

    return res.status(200).json({ text: finalText, steps: ctx.steps, cards: ctx.cards });
  } catch (e: any) {
    console.error('agent route error', e?.message);
    return res.status(500).json({ error: 'agent request failed' });
  }
}
