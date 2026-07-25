import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/prisma/client';
import { getRequester, isCrossSiteRequest } from '@/utilities/apiAuth';
import { getDropsPageData } from '@/prisma/functions';
import { getSagePriceUsd, getEthUsd } from '@/utilities/sagePrice';
import { TRADE_CHAIN_NAME, TRADE_CHAIN_ID } from '@/constants/config';
import { resolveBuyVenue, resolveSellVenue, sizeSellForEth } from '@/utilities/socialToken';
import { tradeProvider, TRADE_VENUE, BUILTIN_TOKENS } from '@/components/Agent/trade';
import { ethers } from 'ethers';
import { MODEL_PRICES, DEFAULT_MODEL_ID, priceFor, creditsForUsage } from '@/constants/modelPricing';
import { getCreditBalance, debitCredits } from './credits.page';

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
const MODELS: Record<string, { api: string; maxTokens: number }> = Object.fromEntries(
  MODEL_PRICES.map((m) => [m.id, { api: m.api, maxTokens: m.maxTokens }])
);
const DEFAULT_MODEL = DEFAULT_MODEL_ID;

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
- prepare_buy works for ANY token traded on Robinhood Chain, not only SAGE — pass the symbol the user named. Use list_tokens when they ask what is buyable or name something unfamiliar.
- NEVER convert between dollars and ETH yourself. You do not know the ETH price and any figure you produce will be wrong. If the user names a dollar amount, pass usd_amount and let the server price it; if they name ETH, pass eth_amount. Never state an ETH/USD rate that a tool did not return.
- It returns the quote it priced. Quotes move, so call the figure approximate. If prepare_buy returns an error, relay the reason in plain words and do not offer an order.
- If a token is not listed on SAGE, say so before the user signs. You have no opinion on its merit.
- Do NOT refuse an order because a name looks unfamiliar, and do not pre-emptively list the roster instead of acting. Pass the user's wording straight to prepare_buy / prepare_sell — the server matches it against the listed tokens and picks the nearest, or tells you when it is genuinely ambiguous. Only then ask which one they meant.
- When the tool returns an "interpreted" field, state the interpretation in one short sentence ("Reading that as Pixel Cat") so they can correct you before signing. Do not apologise for it or belabour it.
- You CAN sell too: prepare_sell builds an unsigned sell order. Never tell the user to go to another exchange — selling works here. Selling needs a token approval first, so warn them their wallet may prompt twice.

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
      "Read the connected wallet's ETH and SAGE balances on the trading chain. Call this when the user asks about their holdings, or to check they can afford a purchase before preparing one.",
    input_schema: {
      type: 'object',
      properties: { address: { type: 'string', description: '0x… wallet address' } },
      required: ['address'],
    },
  },
  {
    name: 'list_tokens',
    description:
      'List the tokens that can be bought on Robinhood Chain through SAGE, with their symbols. Use this when the user asks what they can buy, or names a token you have not seen before.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'prepare_buy',
    description:
      'Build an UNSIGNED order to buy a token on Robinhood Chain. This does NOT execute — it returns an order the user signs in their own wallet. Works for SAGE and any other listed token; pass its symbol. Requires a connected wallet. Give EITHER eth_amount OR usd_amount — never convert between them yourself, you do not have the rate.',
    input_schema: {
      type: 'object',
      properties: {
        eth_amount: { type: 'number', description: 'ETH to spend, e.g. 0.01' },
        usd_amount: {
          type: 'number',
          description:
            'US dollars to spend, e.g. 10. Use this whenever the user names a dollar amount — the server converts it at the live ETH/USD rate. Never do this arithmetic yourself.',
        },
        token: {
          type: 'string',
          description:
            'Token symbol (e.g. "SAGE", "rhagent") or its 0x contract address. Defaults to SAGE.',
        },
      },
    },
  },
  {
    name: 'prepare_sell',
    description:
      'Build an UNSIGNED order to SELL a token for ETH on Robinhood Chain. Does NOT execute — the user signs it in their own wallet. Give the token, plus exactly one of usd_amount, eth_amount, token_amount or percent. Never convert between dollars, ETH and token counts yourself.',
    input_schema: {
      type: 'object',
      properties: {
        token: {
          type: 'string',
          description: 'Token symbol (e.g. "SAGE") or its 0x contract address. Defaults to SAGE.',
        },
        usd_amount: { type: 'number', description: 'Dollars of proceeds to raise, e.g. 10' },
        eth_amount: { type: 'number', description: 'ETH of proceeds to raise, e.g. 0.01' },
        token_amount: { type: 'number', description: 'Exact number of whole tokens to sell' },
        percent: { type: 'number', description: 'Percent of the holding to sell, 1-100' },
      },
    },
  },
];

type Card = Record<string, any>;

// ── token resolution ────────────────────────────────────────────────────────

interface TradableToken {
  address: string;
  symbol: string;
  name: string;
  /** launched through SAGE (registry-known) rather than merely quotable */
  verified: boolean;
  /** set when the user's wording did not match exactly and we resolved it */
  matchedFrom?: string;
}

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Levenshtein distance — small inputs (tickers and short names) only. */
function editDistance(a: string, b: string): number {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = row;
  }
  return prev[b.length];
}

/**
 * 0..1 similarity between a user's wording and a token's symbol or name.
 *
 * Three signals, strongest first. Whole-word overlap matters most and edit
 * distance alone misses it: "cash cat" against "Pixel Cat" is 0.43 on raw
 * distance — below any sane threshold — even though both are plainly about a
 * cat. Half-remembered names are the entire reason this function exists, so a
 * shared word of three or more characters counts for more than the letters
 * around it happening to differ.
 */
function similarity(rawA: string, rawB: string): number {
  const a = normalize(rawA);
  const b = normalize(rawB);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const long = a.length >= b.length ? a : b;
  const short = a.length >= b.length ? b : a;
  if (long.includes(short)) return 0.75 + 0.25 * (short.length / long.length);

  // A meaningful word from either side appearing in the other — this catches
  // "cash cat"/"cashcat" -> "Pixel Cat" via the shared "cat".
  let wordScore = 0;
  const words = [...rawA.split(/[^a-zA-Z0-9]+/), ...rawB.split(/[^a-zA-Z0-9]+/)]
    .map(normalize)
    .filter((w) => w.length >= 3);
  for (const w of words) {
    if (a.includes(w) && b.includes(w)) {
      wordScore = Math.max(wordScore, 0.5 + 0.3 * (w.length / long.length));
    }
  }

  return Math.max(wordScore, 1 - editDistance(a, b) / long.length);
}

/**
 * Turn what the model asked for — "SAGE", "$rhagent", a raw 0x address — into
 * a token that can actually be priced on the trading chain.
 *
 * The model's argument is attacker-reachable: a prompt injected into any tool
 * output could ask it to prepare a buy. So resolution runs two independent
 * gates. First the REGISTRY — a symbol only ever becomes an address through
 * SocialTokenLaunch or the builtin map, so an invented ticker cannot resolve
 * to anything. Then the CHAIN — whatever survives has to quote non-zero at a
 * real venue. A raw address outside the registry is still allowed, because the
 * router prices any pair on Robinhood, but it comes back `verified: false` and
 * the order card says UNVERIFIED before the user signs.
 */
async function resolveTradableToken(raw: any): Promise<TradableToken> {
  const q = String(raw ?? 'SAGE').trim().replace(/^\$/, '');
  if (!q) throw new Error('no token specified');

  const builtin = BUILTIN_TOKENS[q.toUpperCase()];
  if (builtin) {
    return { address: builtin, symbol: q.toUpperCase(), name: q.toUpperCase(), verified: true };
  }

  const isAddress = ethers.utils.isAddress(q);
  // Symbols are NOT unique — launching is free and permissionless, so anyone
  // can mint a second token claiming an existing ticker. Take two rows and
  // fail CLOSED on a collision rather than letting findFirst pick arbitrarily:
  // silently resolving a ticker to an impostor is a token-substitution hole
  // that ends with the user signing a buy for the wrong contract.
  const matches = await prisma.socialTokenLaunch.findMany({
    where: isAddress
      ? { tokenAddress: ethers.utils.getAddress(q) }
      : { symbol: { equals: q, mode: 'insensitive' } },
    select: { tokenAddress: true, symbol: true, name: true },
    orderBy: { id: 'asc' },
    take: 2,
  });
  if (matches.length > 1) {
    throw new Error(
      `more than one token is listed as "${q}". Ask the user which one they mean and pass its contract address — do not guess.`
    );
  }
  const launch = matches[0];
  if (launch) {
    return {
      address: launch.tokenAddress,
      symbol: launch.symbol,
      name: launch.name,
      verified: true,
    };
  }

  if (!isAddress) {
    // No exact hit. Find the nearest listed token rather than refusing: people
    // half-remember names ("cash cat" for Pixel Cat), and making them retype it
    // is worse UX for no safety gain — the order card names the token it
    // resolved to and the user still signs it, which is the real gate.
    //
    // Matching stays INSIDE the registry. It never invents an address, and a
    // genuinely ambiguous result asks rather than guesses, so this cannot
    // quietly substitute one token for another.
    const listed = await prisma.socialTokenLaunch.findMany({
      select: { tokenAddress: true, symbol: true, name: true },
      orderBy: { id: 'desc' },
      take: 200,
    });
    const pool = [
      { tokenAddress: BUILTIN_TOKENS.SAGE, symbol: 'SAGE', name: 'SAGE' },
      ...listed,
    ];
    const scored = pool
      .map((t) => ({ t, score: Math.max(similarity(q, t.symbol), similarity(q, t.name)) }))
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    const runnerUp = scored[1];
    // Too weak to be a match, or two candidates are effectively tied — ask.
    if (!best || best.score < 0.45 || (runnerUp && best.score - runnerUp.score < 0.06)) {
      const names = scored
        .slice(0, 6)
        .map((s) => `${s.t.symbol} (${s.t.name})`)
        .join(', ');
      throw new Error(
        `nothing on SAGE clearly matches "${q}". The closest are: ${names}. Ask the user which they mean.`
      );
    }
    return {
      address: best.t.tokenAddress,
      symbol: best.t.symbol,
      name: best.t.name,
      verified: true,
      matchedFrom: q,
    };
  }

  // Unlisted address: read its own metadata so the card names what it is
  // rather than showing the user a bare 0x string to sign against.
  const address = ethers.utils.getAddress(q);
  let symbol = '';
  let name = '';
  try {
    const erc20 = new ethers.Contract(
      address,
      ['function symbol() view returns (string)', 'function name() view returns (string)'],
      tradeProvider()
    );
    [symbol, name] = await Promise.all([erc20.symbol(), erc20.name()]);
  } catch {
    /* non-standard or not a token — the venue check below is the real gate */
  }
  return {
    address,
    symbol: String(symbol).slice(0, 12),
    name: String(name).slice(0, 40),
    verified: false,
  };
}

const fmtTokens = (wei: ethers.BigNumber) =>
  Number(ethers.utils.formatEther(wei)).toLocaleString('en-US', { maximumFractionDigits: 2 });

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
    // The trading chain, not the build's — getSagePriceUsd() already reads
    // mainnet regardless of APP_MODE, so quoting parameters.CHAIN_ID here
    // would label a mainnet price with a testnet chain id.
    // The ETH rate is carried here too: without it the model has no way to
    // answer "what is that in dollars" except by inventing a price.
    let ethUsd = 0;
    try {
      ethUsd = await getEthUsd();
    } catch {
      /* best-effort, same as the SAGE price above */
    }
    const rows = [
      { k: 'SAGE', v: usd > 0 ? '$' + usd.toPrecision(3) : 'unavailable' },
      { k: 'ETH', v: ethUsd > 0 ? '$' + ethUsd.toFixed(2) : 'unavailable' },
      { k: 'CHAIN', v: TRADE_CHAIN_NAME.toUpperCase() },
      { k: 'CHAIN ID', v: String(TRADE_CHAIN_ID) },
    ];
    ctx.cards.push({ kind: 'stats', status: 'SAGE TOKEN', byline: 'LIVE', rows });
    return JSON.stringify({
      sage_usd: usd || null,
      eth_usd: ethUsd || null,
      chain_id: TRADE_CHAIN_ID,
      note: 'Use eth_usd for any dollar/ETH conversion the user asks about. Never estimate it.',
    });
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
    // Read the TRADING chain, not `parameters` — a staging build would
    // otherwise report a testnet balance for the mainnet token the agent
    // actually buys, and quote affordability off the wrong number.
    const provider = tradeProvider();
    const token = new ethers.Contract(
      BUILTIN_TOKENS.SAGE,
      ['function balanceOf(address) view returns (uint256)'],
      provider
    );
    const [raw, nativeRaw] = await Promise.all([
      token.balanceOf(ctx.address),
      provider.getBalance(ctx.address),
    ]);
    const sage = Number(ethers.utils.formatEther(raw));
    const eth = Number(ethers.utils.formatEther(nativeRaw));
    ctx.cards.push({
      kind: 'wallet',
      status: 'CONNECTED · ' + ctx.address.slice(0, 6) + '…' + ctx.address.slice(-4),
      title: 'Holdings',
      body: `Read-only snapshot at current block · ${TRADE_CHAIN_NAME}.`,
      rows: [
        { k: 'ETH', v: eth.toLocaleString('en-US', { maximumFractionDigits: 4 }) },
        { k: 'SAGE', v: sage.toLocaleString('en-US', { maximumFractionDigits: 2 }) },
      ],
    });
    return JSON.stringify({ address: ctx.address, chain: TRADE_CHAIN_NAME, eth, sage });
  }

  if (name === 'prepare_buy') {
    // Returns an INTENT. Nothing is signed here and this server holds no key
    // to the user's funds — the client renders a pending card and the user's
    // own wallet executes it.
    // USD → ETH is converted HERE, never by the model. Asked for "$10 of
    // SAGE", the model has no rate to work from and simply guesses one: it
    // priced ETH at $1,000 against a real $1,861 and built an order for
    // $18.61. A language model doing FX arithmetic on a live order is a
    // money bug, so the rate comes from the same feed the rest of the app
    // prices with, and a missing feed is an error rather than an estimate.
    let eth = Number(input?.eth_amount);
    let usd = Number(input?.usd_amount);
    let ethUsd = 0;

    if (Number.isFinite(usd) && usd > 0) {
      try {
        ethUsd = await getEthUsd();
      } catch {
        return 'ERROR: the ETH/USD rate is unavailable, so a dollar amount cannot be converted. Ask the user to name an amount in ETH instead. Do NOT convert it yourself.';
      }
      if (!(ethUsd > 0)) {
        return 'ERROR: the ETH/USD rate is unavailable. Ask the user for an amount in ETH. Do NOT convert it yourself.';
      }
      // 6dp is well inside wei and keeps the figure legible on the card
      eth = Number((usd / ethUsd).toFixed(6));
      if (!(eth > 0)) return 'ERROR: that dollar amount is too small to buy.';
    } else {
      usd = 0;
    }

    if (!Number.isFinite(eth) || eth <= 0) {
      return 'ERROR: give either eth_amount or usd_amount as a positive number.';
    }
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
    // Resolve the token and PRICE IT before showing an order. Quoting here is
    // what turns the two failure modes that killed the first live buy —
    // wrong chain, and a graduated token whose curve quotes zero — into a
    // sentence the user can read, instead of a revert after they sign.
    let token: TradableToken;
    let venue: Awaited<ReturnType<typeof resolveBuyVenue>>;
    try {
      token = await resolveTradableToken(input?.token);
      venue = await resolveBuyVenue(token.address, eth, tradeProvider(), TRADE_VENUE);
    } catch (e: any) {
      return `ERROR: ${e?.message || 'could not price that token'}. Tell the user plainly; do not offer an order.`;
    }

    const label = token.symbol || token.name || token.address.slice(0, 10);
    const expected = fmtTokens(venue.quoted);

    ctx.steps.push(`BUILDING ORDER · ${eth} ETH → ${label}`);
    ctx.cards.push({
      kind: 'tx',
      status: 'UNSIGNED ORDER',
      byline: `${TRADE_CHAIN_NAME.toUpperCase()} · YOU SIGN`,
      title: `Buy ${label} with ${eth} ETH`,
      pending: true,
      cta: 'sign & buy',
      // consumed by the client to build the actual transaction
      intent: {
        action: 'buy_token',
        token: token.address,
        symbol: label,
        ethAmount: eth,
      },
      rows: [
        { k: 'SPEND', v: usd > 0 ? `${eth} ETH · $${usd.toFixed(2)}` : `${eth} ETH` },
        { k: 'RECEIVE', v: `≈ ${expected} ${label}` },
        ...(ethUsd > 0 ? [{ k: 'ETH RATE', v: `$${ethUsd.toFixed(2)}` }] : []),
        { k: 'VENUE', v: venue.venue === 'pool' ? 'POOL' : 'BONDING CURVE' },
        { k: 'CHAIN', v: TRADE_CHAIN_NAME.toUpperCase() },
        // If we interpreted the wording, say so ON the card — this is the last
        // thing shown before a signature, so the interpretation has to be
        // visible there and not only in the prose above it.
        ...(token.matchedFrom
          ? [{ k: 'MATCHED', v: `"${token.matchedFrom}" → ${token.name}` }]
          : []),
        ...(token.verified ? [] : [{ k: 'WARNING', v: 'UNVERIFIED TOKEN' }]),
      ],
    });
    return JSON.stringify({
      prepared: true,
      eth_amount: eth,
      ...(usd > 0 ? { usd_amount: usd, eth_usd_rate: Number(ethUsd.toFixed(2)) } : {}),
      token: label,
      token_name: token.name,
      token_address: token.address,
      ...(token.matchedFrom
        ? { interpreted: `"${token.matchedFrom}" resolved to ${token.symbol} (${token.name})` }
        : {}),
      expected_out: `${expected} ${label}`,
      venue: venue.venue,
      listed_on_sage: token.verified,
      note:
        'Unsigned order surfaced to the user. They must sign it; do not claim it settled. The quote moves with the market, so describe it as approximate.' +
        (token.verified
          ? ''
          : ' This token is NOT listed on SAGE — say so explicitly before they sign.'),
    });
  }

  if (name === 'prepare_sell') {
    // Same posture as prepare_buy: an INTENT, never an execution. Sizing and
    // pricing happen here so the user sees real proceeds before signing, and
    // so the model never does arithmetic on money.
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

    let token: TradableToken;
    try {
      token = await resolveTradableToken(input?.token);
    } catch (e: any) {
      return `ERROR: ${e?.message || 'unknown token'}.`;
    }
    const label = token.symbol || token.name || token.address.slice(0, 10);

    // What the wallet actually holds bounds everything below.
    const provider = tradeProvider();
    const erc20 = new ethers.Contract(
      token.address,
      ['function balanceOf(address) view returns (uint256)'],
      provider
    );
    let held = 0;
    try {
      held = Number(ethers.utils.formatEther(await erc20.balanceOf(ctx.address)));
    } catch {
      return `ERROR: could not read your ${label} balance.`;
    }
    if (!(held > 0)) {
      return `ERROR: this wallet holds no ${label}, so there is nothing to sell.`;
    }

    // Resolve the requested size into whole tokens.
    let amount = 0;
    let usdTarget = 0;
    let ethUsdUsed = 0;
    try {
      const pct = Number(input?.percent);
      const tokenAmount = Number(input?.token_amount);
      const usd = Number(input?.usd_amount);
      const eth = Number(input?.eth_amount);

      if (Number.isFinite(pct) && pct > 0) {
        amount = held * (Math.min(100, pct) / 100);
      } else if (Number.isFinite(tokenAmount) && tokenAmount > 0) {
        amount = tokenAmount;
      } else if (Number.isFinite(eth) && eth > 0) {
        amount = await sizeSellForEth(token.address, eth, provider, TRADE_VENUE);
      } else if (Number.isFinite(usd) && usd > 0) {
        ethUsdUsed = await getEthUsd();
        if (!(ethUsdUsed > 0)) throw new Error('the ETH/USD rate is unavailable');
        usdTarget = usd;
        amount = await sizeSellForEth(token.address, usd / ethUsdUsed, provider, TRADE_VENUE);
      } else {
        return 'ERROR: say how much to sell — a dollar amount, an ETH amount, a token count, or a percent.';
      }
    } catch (e: any) {
      return `ERROR: ${e?.message || 'could not size that sale'}. Relay this plainly; do not offer an order.`;
    }

    // Never propose selling more than the wallet has.
    const capped = Math.min(amount, held);
    if (!(capped > 0)) return `ERROR: that works out to zero ${label}.`;

    let venue: Awaited<ReturnType<typeof resolveSellVenue>>;
    try {
      venue = await resolveSellVenue(token.address, capped, provider, TRADE_VENUE);
    } catch (e: any) {
      return `ERROR: ${e?.message || 'could not price that sale'}.`;
    }
    const proceedsEth = Number(ethers.utils.formatEther(venue.quoted));
    const proceedsUsd = ethUsdUsed > 0 ? proceedsEth * ethUsdUsed : 0;

    ctx.steps.push(`BUILDING ORDER · ${fmtTokens(ethers.utils.parseEther(capped.toFixed(6)))} ${label} → ETH`);
    ctx.cards.push({
      kind: 'tx',
      status: 'UNSIGNED ORDER',
      byline: `${TRADE_CHAIN_NAME.toUpperCase()} · YOU SIGN`,
      title: `Sell ${capped.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${label}`,
      pending: true,
      cta: 'sign & sell',
      intent: {
        action: 'sell_token',
        token: token.address,
        symbol: label,
        tokenAmount: capped,
      },
      rows: [
        { k: 'SELL', v: `${capped.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${label}` },
        {
          k: 'RECEIVE',
          v: `≈ ${proceedsEth.toFixed(6)} ETH` + (proceedsUsd > 0 ? ` · $${proceedsUsd.toFixed(2)}` : ''),
        },
        { k: 'VENUE', v: venue.venue === 'pool' ? 'POOL' : 'BONDING CURVE' },
        { k: 'CHAIN', v: TRADE_CHAIN_NAME.toUpperCase() },
        ...(token.matchedFrom
          ? [{ k: 'MATCHED', v: `"${token.matchedFrom}" → ${token.name}` }]
          : []),
        ...(capped >= held ? [{ k: 'NOTE', v: 'ENTIRE HOLDING' }] : []),
      ],
    });
    return JSON.stringify({
      prepared: true,
      token: label,
      token_amount: capped,
      held,
      expected_eth: proceedsEth,
      ...(usdTarget > 0 ? { usd_requested: usdTarget, eth_usd_rate: Number(ethUsdUsed.toFixed(2)) } : {}),
      venue: venue.venue,
      note: 'Unsigned SELL order surfaced to the user. Selling needs a token approval first, so their wallet may prompt twice. Do not claim it settled. The quote moves with the market.',
    });
  }

  if (name === 'list_tokens') {
    ctx.steps.push('READING TOKEN REGISTRY');
    const launches = await prisma.socialTokenLaunch.findMany({
      select: { tokenAddress: true, symbol: true, name: true },
      orderBy: { id: 'desc' },
      take: 50,
    });
    return JSON.stringify({
      chain: TRADE_CHAIN_NAME,
      tokens: [{ symbol: 'SAGE', name: 'SAGE', address: BUILTIN_TOKENS.SAGE }].concat(
        launches.map((l) => ({ symbol: l.symbol, name: l.name, address: l.tokenAddress }))
      ),
      note: 'Any of these can be passed to prepare_buy as `token`. Listing is not endorsement.',
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

  // Credits are checked HERE, not in the client. A turn is refused outright
  // when the wallet cannot pay for it — the browser's copy of the balance is
  // a display, and treating it as authority is how someone gets free
  // inference on our API key.
  const payer = requester.walletAddress ? ethers.utils.getAddress(requester.walletAddress) : null;
  if (!payer) return res.status(401).json({ error: 'connect a wallet to use the agent' });
  if ((await getCreditBalance(payer)) < 1) {
    return res.status(402).json({
      error: 'out of compute credits',
      credits: 0,
      needsCredits: true,
    });
  }

  try {
    let rounds = 0;
    let finalText = '';
    let inputTokens = 0;
    let outputTokens = 0;

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
          // Cache the static prefix — the system prompt and every tool
          // definition. It is identical on every request and re-sent on each
          // round of the tool loop, so a five-round turn was paying full input
          // price for it five times. Cached reads bill at a tenth.
          system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
          tools: TOOLS.map((t, i) =>
            i === TOOLS.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : t
          ),
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
      // Every round of the tool loop is billable — charging only the last one
      // would make tool-heavy turns, the expensive ones, effectively free.
      //
      // Cached tokens are reported separately and cost differently: a cache
      // WRITE is 1.25x base input, a READ is 0.1x. Normalising them to
      // base-input equivalents keeps one credit worth $0.002 of real spend and
      // passes the caching saving to the customer rather than pocketing it.
      const u = data?.usage || {};
      inputTokens +=
        Number(u.input_tokens || 0) +
        Math.ceil(Number(u.cache_creation_input_tokens || 0) * 1.25) +
        Math.ceil(Number(u.cache_read_input_tokens || 0) * 0.1);
      outputTokens += Number(u.output_tokens || 0);
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

    // Debit AFTER the work, from real usage. If the balance ran out mid-turn
    // the answer is still delivered — we already paid upstream for it — and
    // the account simply floors at whatever it had; the gate above stops the
    // NEXT turn. Charging for work we then withhold would be worse.
    const cost = creditsForUsage(chosen, inputTokens, outputTokens);
    const remaining = await debitCredits(payer, cost);

    return res.status(200).json({
      text: finalText,
      steps: ctx.steps,
      cards: ctx.cards,
      usage: { inputTokens, outputTokens, cost, credits: remaining, model: priceFor(chosen).label },
    });
  } catch (e: any) {
    console.error('agent route error', e?.message);
    return res.status(500).json({ error: 'agent request failed' });
  }
}
