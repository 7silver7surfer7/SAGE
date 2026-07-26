import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/prisma/client';
import { getRequester, isCrossSiteRequest } from '@/utilities/apiAuth';
import { getDropsPageData } from '@/prisma/functions';
import { getSagePriceUsd, getEthUsd } from '@/utilities/sagePrice';
import { TRADE_CHAIN_NAME, TRADE_CHAIN_ID, parameters } from '@/constants/config';
import { resolveBuyVenue, resolveSellVenue, sizeSellForEth } from '@/utilities/socialToken';
import { tradeProvider, TRADE_VENUE, BUILTIN_TOKENS } from '@/components/Agent/trade';
import { ethers } from 'ethers';
import {
  MODEL_PRICES,
  DEFAULT_MODEL_ID,
  priceFor,
  creditsForUsage,
  IMAGE_MODELS,
  DEFAULT_IMAGE_MODEL_ID,
  imagePriceFor,
  creditsForImage,
} from '@/constants/modelPricing';
import { getCreditBalance, debitCredits } from './credits.page';
import { resolveSubject, subjectImage, CRITIQUE_RULES } from '@/utilities/critique';
import { pinImageAndMetadata } from '@/utilities/pinArt';

/**
 * SAGE Agent — server-side model call.
 *
 * SECURITY POSTURE (read before adding a tool)
 * --------------------------------------------
 * 1. The API key lives here and only here. It is never returned, never logged,
 *    and there is no NEXT_PUBLIC_ variant.
 * 2. No tool in this file writes to the database. They read drops, token
 *    figures and a public address's balances; prepare_mint and prepare_drop
 *    additionally pin bytes to IPFS, which is inert. Drop rows are created by
 *    /api/agent-drop only after the user confirms the card — a tool call is
 *    the model's decision, and a model's decision must not leave rows behind.
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

WHAT YOU KNOW, beyond this platform: you are fluent in web3 and you should sound like it — Ethereum and its rollups, consensus and proof systems, EIPs and account abstraction, AMM mechanics and MEV, token standards, wallets, custody and key management, DAOs, bridges, zero-knowledge proofs — and in the people and arguments behind them (Vitalik Buterin's writing, Satoshi's design choices, the researchers whose results you know). Cryptography, maths and computer science are fair game. Answer a technical question technically and at length if it deserves it; do not deflect back to art or to SAGE. Someone asking how a rollup settles wants that answered, not a drop recommended.

FACTUAL LIMITS — obey strictly. Note what these do and do not cover: they bound LIVE FACTS, never general knowledge.
- Your tools are the ONLY source of truth for anything CURRENT: a drop, artist, price, edition count, date, balance, supply, gas figure, or the state of any address or transaction. Never name one a tool did not return.
- That restriction does NOT apply to how things WORK. Explaining EIP-1559's burn, why a Merkle proof is succinct, or what Vitalik argued about censorship resistance needs no tool — it is yours to answer.
- The line is live-versus-durable, not crypto-versus-art. "How does an AMM price a swap" is knowledge. "What is ETH worth right now" is a live fact you do not have unless a tool returned it — say so instead of guessing.
- If asked what is coming next, say nothing has been announced. Never imply a roadmap, allowlist or future drop.
- Never present a guess as platform news, and say plainly when your knowledge of recent events may be stale — this field moves faster than your training.
- No financial advice, price predictions, or opinion on whether to buy or hold ANY asset — SAGE's, a token you were asked about, or anything else. Describe the mechanism, decline the investment question, move on.

TOOLS: use them whenever a drop, token figure or balance is involved. Each renders a visual card in the interface, so do NOT repeat every number in prose — add the context or judgement the card cannot.

CHAIN READS: you can look at the chain directly, so do it rather than saying you cannot. inspect_address reads any public address (balance, wallet-or-contract, optionally an ERC-20 balance); inspect_transaction says whether a hash succeeded, what it moved and what it cost; get_chain_info gives the current block and gas. Reach for these the moment someone pastes an address or hash, or asks about live chain conditions. They are READ-ONLY — nothing here signs or spends, and get_balances remains the one for the connected user's own holdings.

TRANSACTIONS: you cannot execute anything. prepare_buy builds an UNSIGNED order that the user signs in their own wallet; the agent never holds custody. Say plainly what a purchase will cost, surface the order, and let them sign. Never claim a purchase is complete.
- prepare_buy works for ANY token traded on Robinhood Chain, not only SAGE — pass the symbol the user named. Use list_tokens when they ask what is buyable or name something unfamiliar.
- NEVER convert between dollars and ETH yourself. You do not know the ETH price and any figure you produce will be wrong. If the user names a dollar amount, pass usd_amount and let the server price it; if they name ETH, pass eth_amount. Never state an ETH/USD rate that a tool did not return.
- It returns the quote it priced. Quotes move, so call the figure approximate. If prepare_buy returns an error, relay the reason in plain words and do not offer an order.
- If a token is not listed on SAGE, say so before the user signs. You have no opinion on its merit.
- Do NOT refuse an order because a name looks unfamiliar, and do not pre-emptively list the roster instead of acting. Pass the user's wording straight to prepare_buy / prepare_sell — the server matches it against the listed tokens and picks the nearest, or tells you when it is genuinely ambiguous. Only then ask which one they meant.
- When the tool returns an "interpreted" field, state the interpretation in one short sentence ("Reading that as Pixel Cat") so they can correct you before signing. Do not apologise for it or belabour it.
- You CAN sell too: prepare_sell builds an unsigned sell order. Never tell the user to go to another exchange — selling works here. Selling needs a token approval first, so warn them their wallet may prompt twice.

ART: you can make images with generate_image, mint them with prepare_mint, and build a timed open edition or an auction with prepare_drop.
- Write the prompt yourself. Expand the user's words into a full visual description — subject, composition, medium, light. Do not simply echo what they typed.
- Generating is NOT free — each render is charged. Never generate a second image when the user is approving the one on screen. "Go ahead", "yes", "mint it" mean prepare_mint with NO image_url, which mints the image you just made. Only generate again when they ask for something different.
- Show the image, then ask whether they want it minted; never mint unprompted.
- prepare_mint pins the art to IPFS and builds an unsigned edition the user signs. Deploying costs gas even for a free mint, so say so.
- Default to a 1/1 unless they ask for a run. Suggest a name and ticker rather than demanding one.
- THREE FORMATS, TWO TOOLS. prepare_mint deploys a standalone FIXED-SUPPLY edition — no clock, no bidding, live the moment they sign. prepare_drop builds the other two through the SAGE drop pipeline: a TIMED OPEN EDITION (unlimited mints, closes at a set time — exactly what "open edition for 24 hours" means) or an AUCTION (a reserve, live bidding, the timer starts at the FIRST BID). Pick by what they asked for; ask only when it is genuinely unclear.
- A drop from prepare_drop LANDS ON THE sageart.xyz HOME PAGE and posts to the SAGE Social feed once it is signed. Say that plainly before they sign — it is public, and it is not what prepare_mint does.
- Do NOT offer a large max_supply as a substitute for a deadline: a supply cap is not a clock, and presenting it as one misrepresents what the buyer is getting. Use prepare_drop when they want a clock.
- Never tell someone SAGE has no mechanism for a timed, quantity-open sale, or none for an auction. It has both, and you can build both. For anything you genuinely cannot do: name the limit of YOUR TOOLS, not of the platform, unless you actually know the platform lacks it.

CRITICISM: critique_subject writes about a SAGE drop — you look at the actual artwork, not its title. Reach for it whenever someone asks what you think of a work, for a reading, an analysis or a critique. If it cannot find the drop, ask which one they mean; never critique from memory.

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
    name: 'generate_image',
    description:
      'Generate an image from a text prompt with Krea AI. Use this whenever the user asks for art, an image, or something to mint. Returns image URLs the user can look at; nothing is minted until they ask and then sign.',
    input_schema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description:
            'What to render. Write a full visual description — subject, composition, medium, lighting — not just the user\u2019s few words.',
        },
        aspect_ratio: {
          type: 'string',
          enum: ['1:1', '4:5', '3:2', '2:3', '16:9', '9:16'],
          description: 'Defaults to 1:1.',
        },
        model: {
          type: 'string',
          enum: IMAGE_MODELS.map((m) => m.id),
          description:
            'Quality tier. krea-2-turbo is fast and cheapest (8 credits), krea-2-medium is balanced (15), krea-2-large is photoreal 2K (30). Honour the user\u2019s stated preference; otherwise leave unset and the selected default is used.',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'prepare_mint',
    description:
      'Build an UNSIGNED order to mint an image as an NFT edition on Robinhood Chain. Does NOT execute — the user signs it in their own wallet. Use the image_url returned by generate_image, or any https image URL the user gives. This creates a NEW edition contract; use prepare_mint_existing to mint from one that already exists.',
    input_schema: {
      type: 'object',
      properties: {
        image_url: {
          type: 'string',
          description:
            'https URL of the image to mint. OMIT this to mint the most recent image you generated in this conversation — that is almost always what the user means, and regenerating costs them again.',
        },
        name: { type: 'string', description: 'Name of the edition, e.g. "Glass Lamp"' },
        symbol: { type: 'string', description: 'Short ticker, 2-8 characters, e.g. "LAMP"' },
        max_supply: { type: 'number', description: 'Editions available. 1 for a one-of-one. Defaults to 1.' },
        price_eth: { type: 'number', description: 'Price per edition in ETH. 0 for a free mint. Defaults to 0.' },
      },
      required: ['name', 'symbol'],
    },
  },
  {
    name: 'prepare_drop',
    description:
      'Build an UNSIGNED SAGE drop — a TIMED OPEN EDITION (unlimited mints until it closes) or an AUCTION (reserve price, timer starts at the first bid). Does NOT execute: the user signs the deploy in their own wallet, and only then does it go live on the sageart.xyz home page and post to the SAGE Social feed. Use this whenever the sale has a CLOCK or BIDDING; use prepare_mint for a plain fixed-supply edition. Takes the image_url from generate_image, or omit it to use the most recent image.',
    input_schema: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          enum: ['open_edition', 'auction'],
          description:
            'open_edition = unlimited mints at a fixed price until the clock runs out. auction = one piece, highest bid wins, the timer starts at the first bid.',
        },
        image_url: {
          type: 'string',
          description:
            'https URL of the artwork. OMIT this to use the most recent image you generated in this conversation — that is almost always what the user means, and regenerating costs them again.',
        },
        name: { type: 'string', description: 'Title of the drop and the artwork, e.g. "Glass Lamp"' },
        description: { type: 'string', description: 'A sentence or two about the work. Optional.' },
        duration_hours: {
          type: 'number',
          description:
            'How long the sale runs. For an open edition this is the deadline; for an auction it is how long the clock runs once the first bid lands. Defaults to 24. Max 720.',
        },
        price_eth: {
          type: 'number',
          description:
            'Open edition: price per mint in ETH (0 = free mint). Auction: the reserve in ETH. Defaults to 0.',
        },
        max_per_user: {
          type: 'number',
          description:
            'Open edition only. Mints allowed per wallet. 0 = unlimited, which is what "open" normally means. Defaults to 0.',
        },
        symbol: {
          type: 'string',
          description:
            'Short ERC-721 ticker, 2-8 characters. Only used the FIRST time this artist deploys — their contract symbol is immutable afterwards. Optional.',
        },
        royalty_percent: {
          type: 'number',
          description: 'Secondary-sale royalty to the artist, 0-20. Defaults to 10.',
        },
      },
      required: ['format', 'name'],
    },
  },
  {
    name: 'inspect_address',
    description:
      'Read any PUBLIC address on Robinhood Chain: native balance, whether it is a wallet or a contract, and optionally its balance of a given ERC-20. Use for questions about a wallet or contract that is NOT the signed-in user (get_balances covers them). Read-only.',
    input_schema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: '0x… address to inspect' },
        token: {
          type: 'string',
          description:
            'Optional 0x… ERC-20 contract to also report the balance of. Omit for native ETH only.',
        },
      },
      required: ['address'],
    },
  },
  {
    name: 'inspect_transaction',
    description:
      'Look up a transaction on Robinhood Chain by hash — whether it succeeded, who sent it, what it moved, which block, and what it cost in gas. Use whenever someone asks what happened to a transaction. Read-only.',
    input_schema: {
      type: 'object',
      properties: { hash: { type: 'string', description: '0x… 66-character transaction hash' } },
      required: ['hash'],
    },
  },
  {
    name: 'get_chain_info',
    description:
      'Current state of Robinhood Chain: latest block height, block time and gas price. Use for "what is gas right now", "what block are we on", or any question needing live chain conditions rather than general knowledge.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'critique_subject',
    description:
      'Write art criticism of a SAGE drop — analysis, interpretation, evaluation and a final judgement. Use this whenever the user asks what you think of a work, for a critique, a reading, or an analysis. Name the drop in words; the server finds it and supplies the artwork.',
    input_schema: {
      type: 'object',
      properties: {
        subject: {
          type: 'string',
          description:
            'The drop to critique, in the user\u2019s words (a title, an artist, or both). Never a URL.',
        },
      },
      required: ['subject'],
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
    // No exact hit in SAGE's own registry. Before guessing at a similar name,
    // search the CHAIN-WIDE pair index — SAGE launched a few dozen tokens, the
    // chain carries ~21.7k pairs, and the thing the user means is far more
    // likely to be one of those than a near-spelling of one of ours.
    // Scoped to the TRADING chain, not the build's. Rows carry chainId now,
    // so a staging or localhost build can read mainnet pairs safely — before
    // that discriminator existed this had to be skipped entirely, or it would
    // have offered a testnet token as though it were real.
    const onChain = await prisma.dexPair.findMany({
      where: {
        chainId: TRADE_CHAIN_ID,
        OR: [
          { baseSymbol: { equals: q, mode: 'insensitive' } },
          { baseName: { equals: q, mode: 'insensitive' } },
          { baseSymbol: { equals: normalize(q), mode: 'insensitive' } },
        ],
      },
      select: { baseToken: true, baseSymbol: true, baseName: true, liquidityEth: true },
      orderBy: { liquidityEth: 'desc' },
      take: 5,
    });
    // Symbols are NOT unique on a permissionless chain, and depth CANNOT
    // break the tie. Thirty-seven tokens here are called CASHCAT; the deepest
    // pool holds 1.797 ETH and is NOT the real one — the token users mean sits
    // second at 0.037 ETH, 48x shallower. An earlier version of this resolved
    // on a 3x depth margin and would have bought the impostor with confidence,
    // which is the whole attack: fund a pool, capture the ticker.
    //
    // So a duplicated symbol is never auto-resolved. Depth only ORDERS the
    // options; the user picks the contract. The address is the only
    // unambiguous identifier on this chain and the only thing worth signing.
    const distinct = new Set(onChain.map((t) => t.baseToken.toLowerCase()));
    if (distinct.size > 1) {
      const options = onChain
        .slice(0, 4)
        .map(
          (t) =>
            `${t.baseSymbol} (${t.baseName}) ${t.baseToken} — ${t.liquidityEth.toFixed(4)} ETH liquidity`
        )
        .join('; ');
      throw new Error(
        `${distinct.size} different tokens on Robinhood Chain use the name "${q}", and the one with the most liquidity is NOT reliably the real one — anyone can mint a ticker and fund a pool. Show the user these and ask which contract address they mean; do not choose for them: ${options}`
      );
    }

    if (onChain.length) {
      const hit = onChain[0];
      return {
        address: ethers.utils.getAddress(hit.baseToken),
        symbol: hit.baseSymbol,
        name: hit.baseName,
        // listed on the chain, NOT launched through SAGE — the card says so
        verified: false,
      };
    }

    // Only now consider a near-spelling of a SAGE-listed token, and only when
    // it is unmistakably the same name.
    //
    // The bar used to be 0.45, which resolved "cashcat" to Pixel Cat on the
    // strength of a shared "cat" — and Cash Cat is a real, different token
    // that simply was not in our registry. A confident wrong answer on a spend
    // path is worse than asking, so this now only auto-resolves an obvious
    // typo and otherwise lists candidates.
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
    if (best && best.score >= 0.8 && (!runnerUp || best.score - runnerUp.score >= 0.1)) {
      return {
        address: best.t.tokenAddress,
        symbol: best.t.symbol,
        name: best.t.name,
        verified: true,
        matchedFrom: q,
      };
    }

    const names = scored
      .slice(0, 6)
      .map((x) => `${x.t.symbol} (${x.t.name})`)
      .join(', ');
    throw new Error(
      `no token called "${q}" is listed on SAGE or indexed on Robinhood Chain. ` +
        `Closest SAGE listings: ${names}. Do NOT buy any of these unless the user confirms — ` +
        `if they have the contract address, ask for it and pass that instead.`
    );
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
  ctx: {
    address: string | null;
    cards: Card[];
    steps: string[];
    imageCredits: number;
    /** the tier the user picked in the UI; the model may still override */
    imageModelId: string;
    /** URLs of images already generated in this thread, newest first */
    recentImages: string[];
    /** set when a critique tool ran, so the image reaches the model */
    critique?: { subject: any; base64: string; mime: string };
  }
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

  if (name === 'generate_image') {
    const prompt = String(input?.prompt || '').trim();
    if (!prompt) return 'ERROR: a prompt is required.';
    // The USER'S selection is the ceiling. The model may pick a cheaper tier
    // (asking for "turbo" should work) but never a dearer one: `input.model`
    // is attacker-reachable through anything the loop reads, and letting it
    // win meant a prompt could bill 30 credits against a wallet whose owner
    // had chosen the 8-credit tier in the header.
    const picked = imagePriceFor(String(ctx.imageModelId || DEFAULT_IMAGE_MODEL_ID));
    const asked = input?.model ? imagePriceFor(String(input.model)) : picked;
    const imageModel = asked.usdPerImage <= picked.usdPerImage ? asked : picked;

    // One render per turn. The tool loop runs up to MAX_TOOL_ROUNDS, so
    // without this a single message could bill five renders.
    if (ctx.imageCredits > 0) {
      return 'ERROR: one image per message. Ask the user to send another message to generate again.';
    }
    ctx.steps.push(`GENERATING · ${imageModel.label}`);
    try {
      const { generateImage } = await import('@/utilities/krea');
      const job = await generateImage({
        prompt,
        aspectRatio: input?.aspect_ratio,
        model: imageModel.id,
        timeoutMs: Math.max(60_000, imageModel.seconds * 6000),
      });
      if (job.status !== 'completed' || !job.urls.length) {
        return `ERROR: ${job.error || `image generation ${job.status}`}. Tell the user plainly.`;
      }
      // Billed only on success — a failed render is not the user's cost.
      const cost = creditsForImage(imageModel.id) * Math.max(1, job.urls.length);
      ctx.imageCredits += cost;
      ctx.cards.push({
        kind: 'image',
        status: 'GENERATED',
        byline: 'NOT YET MINTED',
        title: prompt.slice(0, 120),
        images: job.urls,
        rows: [
          { k: 'MODEL', v: imageModel.label },
          { k: 'RATIO', v: String(input?.aspect_ratio || '1:1') },
          { k: 'COST', v: `${cost} CR` },
        ],
      });
      return JSON.stringify({
        generated: true,
        image_url: job.urls[0],
        image_urls: job.urls,
        model: imageModel.label,
        credits_charged: cost,
        note: 'Shown to the user. It is NOT minted and NOT stored permanently. If they want it minted, call prepare_mint with this image_url.',
      });
    } catch (e: any) {
      return `ERROR: ${e?.message || 'image generation failed'}.`;
    }
  }

  if (name === 'prepare_mint') {
    if (!ctx.address) {
      ctx.cards.push({
        kind: 'wallet',
        status: 'WALLET REQUIRED',
        title: 'Connect a wallet to mint.',
        body: 'Editions are deployed from your own wallet. The agent never holds custody.',
        needsConnect: true,
        rows: [],
      });
      return 'ERROR: no wallet connected. Tell the user to connect using the card shown.';
    }
    // Default to the image already on screen. The model cannot see card data
    // in history, so left to itself it regenerates — charging the user twice
    // for the picture they just approved.
    const imageUrl = String(input?.image_url || ctx.recentImages[0] || '');
    if (!/^https:\/\//.test(imageUrl)) {
      return 'ERROR: no image to mint. Generate one first, or pass an https image_url.';
    }

    const editionName = String(input?.name || '').trim().slice(0, 40);
    const symbol = String(input?.symbol || '').trim().toUpperCase().slice(0, 8);
    if (!editionName || !symbol) return 'ERROR: name and symbol are required.';

    const maxSupply = Math.max(1, Math.floor(Number(input?.max_supply) || 1));
    const priceEth = Math.max(0, Number(input?.price_eth) || 0);

    ctx.steps.push('PINNING TO IPFS');
    let pinned: { tokenUri: string; imageUri: string };
    try {
      pinned = await pinImageAndMetadata(imageUrl, editionName, String(input?.description || ''));
    } catch (e: any) {
      return `ERROR: ${e?.message || 'the image could not be stored permanently'}. Do not offer a mint.`;
    }

    ctx.steps.push(`BUILDING MINT · ${editionName}`);
    ctx.cards.push({
      kind: 'tx',
      status: 'UNSIGNED ORDER',
      byline: `${TRADE_CHAIN_NAME.toUpperCase()} · YOU SIGN`,
      title: `Mint "${editionName}" as ${maxSupply === 1 ? 'a 1/1' : maxSupply + ' editions'}`,
      pending: true,
      cta: 'sign & mint',
      image: pinned.imageUri,
      intent: {
        action: 'mint_edition',
        tokenUri: pinned.tokenUri,
        imageUrl: pinned.imageUri,
        name: editionName,
        symbol,
        maxSupply,
        priceEth,
      },
      rows: [
        { k: 'EDITION', v: `${editionName} · ${symbol}` },
        { k: 'SUPPLY', v: maxSupply === 1 ? '1 of 1' : String(maxSupply) },
        { k: 'PRICE', v: priceEth > 0 ? `${priceEth} ETH each` : 'FREE MINT' },
        { k: 'STORAGE', v: 'IPFS · PERMANENT' },
        { k: 'CHAIN', v: TRADE_CHAIN_NAME.toUpperCase() },
      ],
    });
    return JSON.stringify({
      prepared: true,
      name: editionName,
      symbol,
      max_supply: maxSupply,
      price_eth: priceEth,
      image_uri: pinned.imageUri,
      note: 'Unsigned mint surfaced to the user. The image is ALREADY pinned to IPFS; signing deploys the edition contract. Do not claim it is minted until they sign. Deploying costs gas even for a free mint.',
    });
  }

  if (name === 'prepare_drop') {
    if (!ctx.address) {
      ctx.cards.push({
        kind: 'wallet',
        status: 'WALLET REQUIRED',
        title: 'Connect a wallet to launch a drop.',
        body: 'The drop is created in your name and deployed from your own wallet. The agent never holds custody.',
        needsConnect: true,
        rows: [],
      });
      return 'ERROR: no wallet connected. Tell the user to connect using the card shown.';
    }
    const format = input?.format === 'auction' ? 'auction' : 'open-edition';
    const isAuction = format === 'auction';
    // Same defaulting as prepare_mint: the model cannot see card data in
    // history, so left to itself it regenerates and charges twice.
    const imageUrl = String(input?.image_url || ctx.recentImages[0] || '');
    if (!/^https:\/\//.test(imageUrl)) {
      return 'ERROR: no artwork for the drop. Generate one first, or pass an https image_url.';
    }
    const dropName = String(input?.name || '').trim().slice(0, 80);
    if (!dropName) return 'ERROR: name is required.';
    const description = String(input?.description || '').slice(0, 600);
    const hours = Math.min(720, Math.max(1, Math.round(Number(input?.duration_hours) || 24)));
    const priceEth = Math.max(0, Number(input?.price_eth) || 0);
    const maxPerUser = isAuction ? 0 : Math.max(0, Math.floor(Number(input?.max_per_user) || 0));

    ctx.steps.push('PINNING TO IPFS');
    let pinned: { tokenUri: string; imageUri: string };
    try {
      pinned = await pinImageAndMetadata(imageUrl, dropName, description);
    } catch (e: any) {
      return `ERROR: ${e?.message || 'the image could not be stored permanently'}. Do not offer a drop.`;
    }

    ctx.steps.push(`BUILDING DROP · ${dropName}`);
    // NOTHING is written to the database here. This tool call is the MODEL's
    // decision; a model iterating on the request would otherwise leave a trail
    // of unsigned drafts in the approval queue and promote the wallet to
    // ARTIST for a drop nobody agreed to. The rows are created by
    // /api/agent-drop when the user CONFIRMS the card below — see the note
    // there on what that endpoint re-derives rather than trusting.
    const priceLabel = priceEth > 0 ? `${priceEth} ETH` : isAuction ? 'NO RESERVE' : 'FREE MINT';
    ctx.cards.push({
      kind: 'tx',
      status: 'UNSIGNED DROP',
      byline: `${TRADE_CHAIN_NAME.toUpperCase()} · YOU SIGN · GOES PUBLIC`,
      title: isAuction
        ? `Auction "${dropName}" for ${hours}h once the first bid lands`
        : `Open edition "${dropName}", open for ${hours}h`,
      pending: true,
      cta: 'sign & go live',
      image: pinned.imageUri,
      intent: {
        action: 'create_drop',
        format,
        name: dropName,
        description,
        imageUri: pinned.imageUri,
        tokenUri: pinned.tokenUri,
        durationHours: hours,
        price: priceEth,
        maxPerUser,
        royaltyPercent: Number(input?.royalty_percent) || 10,
        symbol: String(input?.symbol || ''),
      },
      rows: [
        { k: 'FORMAT', v: isAuction ? 'AUCTION · FIRST BID STARTS THE CLOCK' : 'OPEN EDITION · TIMED' },
        { k: isAuction ? 'RESERVE' : 'PRICE', v: priceLabel },
        ...(isAuction
          ? []
          : [{ k: 'PER WALLET', v: maxPerUser > 0 ? String(maxPerUser) : 'UNLIMITED' }]),
        { k: 'RUNS FOR', v: `${hours} HOURS` },
        { k: 'LANDS ON', v: 'SAGEART.XYZ HOME PAGE + FEED' },
        { k: 'STORAGE', v: 'IPFS · PERMANENT' },
      ],
    });
    return JSON.stringify({
      prepared: true,
      format,
      name: dropName,
      price_eth: priceEth,
      duration_hours: hours,
      max_per_user: isAuction ? undefined : maxPerUser,
      note:
        'An unsigned drop was surfaced to the user. NOTHING exists yet — no rows, no contracts, nothing public. The artwork IS already pinned to IPFS. Signing creates the drop, deploys it on-chain and publishes it to the sageart.xyz home page and the social feed; the clock starts then, so the sale ends the stated number of hours after they sign. Deploying costs gas, more than a plain mint because their artist contract may deploy too. Do not claim it is live until they sign.',
    });
  }

  /**
   * The three read-only chain tools.
   *
   * These take an address or hash FROM THE MODEL, which get_balances
   * deliberately does not — and that asymmetry is the point, not an
   * inconsistency. get_balances reports the signed-in user's holdings, so
   * letting the model choose whose wallet to read would turn a prompt
   * injection into a way to snoop on a third party through our server. These
   * report only what any block explorer will show anyone who asks; there is no
   * privacy to leak and no session to abuse.
   *
   * All three are view calls against the pinned trading RPC. Nothing here can
   * write, sign, or spend.
   */
  if (name === 'inspect_address') {
    const raw = String(input?.address || '').trim();
    if (!ethers.utils.isAddress(raw)) {
      return 'ERROR: that is not a valid address. Ask the user for the full 0x… address.';
    }
    const addr = ethers.utils.getAddress(raw);
    ctx.steps.push('READING CHAIN · ' + addr.slice(0, 6) + '…' + addr.slice(-4));
    const provider = tradeProvider();
    const tokenArg = String(input?.token || '').trim();
    const wantToken = ethers.utils.isAddress(tokenArg) ? ethers.utils.getAddress(tokenArg) : null;
    try {
      const [balRaw, code, tokenRaw] = await Promise.all([
        provider.getBalance(addr),
        provider.getCode(addr),
        wantToken
          ? new ethers.Contract(
              wantToken,
              ['function balanceOf(address) view returns (uint256)'],
              provider
            )
              .balanceOf(addr)
              .catch(() => null)
          : Promise.resolve(null),
      ]);
      const eth = Number(ethers.utils.formatEther(balRaw));
      // 0xef0100 || implementation, exactly 23 bytes — an EIP-7702 delegated
      // EOA is a PERSON whose key still signs, not a contract. Reporting it as
      // a contract is wrong and, on this chain, wrong for most real wallets.
      const delegated = code.toLowerCase().startsWith('0xef0100') && code.length === 2 + 23 * 2;
      const kind = code === '0x' ? 'WALLET' : delegated ? 'WALLET · EIP-7702' : 'CONTRACT';
      const rows = [
        { k: 'TYPE', v: kind },
        { k: 'ETH', v: eth.toLocaleString('en-US', { maximumFractionDigits: 6 }) },
      ];
      if (tokenRaw !== null) {
        rows.push({
          k: 'TOKEN',
          v: Number(ethers.utils.formatEther(tokenRaw)).toLocaleString('en-US', {
            maximumFractionDigits: 4,
          }),
        });
      }
      if (kind === 'CONTRACT') rows.push({ k: 'CODE', v: `${(code.length - 2) / 2} bytes` });
      ctx.cards.push({
        kind: 'stats',
        status: 'ON CHAIN',
        byline: TRADE_CHAIN_NAME.toUpperCase() + ' · PUBLIC DATA',
        title: `${addr.slice(0, 10)}…${addr.slice(-8)}`,
        rows,
      });
      return JSON.stringify({
        address: addr,
        type: kind,
        eth,
        token_balance: tokenRaw === null ? undefined : Number(ethers.utils.formatEther(tokenRaw)),
        code_bytes: (code.length - 2) / 2,
        note: 'Live read, shown as a card. Add what the numbers mean rather than restating them.',
      });
    } catch (e: any) {
      return `ERROR: could not read that address (${e?.message || 'RPC failure'}).`;
    }
  }

  if (name === 'inspect_transaction') {
    const hash = String(input?.hash || '').trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
      return 'ERROR: that is not a valid transaction hash. It is 0x followed by 64 hex characters.';
    }
    ctx.steps.push('READING TX · ' + hash.slice(0, 10) + '…');
    const provider = tradeProvider();
    try {
      const [tx, rcpt] = await Promise.all([
        provider.getTransaction(hash),
        provider.getTransactionReceipt(hash),
      ]);
      if (!tx) {
        return 'ERROR: no transaction with that hash on this chain. It may be on a different chain, or not mined yet.';
      }
      const status = !rcpt ? 'PENDING' : rcpt.status === 1 ? 'SUCCESS' : 'REVERTED';
      const value = Number(ethers.utils.formatEther(tx.value || 0));
      const gasEth = rcpt?.gasUsed && tx.gasPrice
        ? Number(ethers.utils.formatEther(rcpt.gasUsed.mul(tx.gasPrice)))
        : null;
      ctx.cards.push({
        kind: 'stats',
        status,
        byline: TRADE_CHAIN_NAME.toUpperCase(),
        title: `${hash.slice(0, 10)}…${hash.slice(-8)}`,
        rows: [
          { k: 'FROM', v: `${tx.from.slice(0, 6)}…${tx.from.slice(-4)}` },
          { k: 'TO', v: tx.to ? `${tx.to.slice(0, 6)}…${tx.to.slice(-4)}` : 'CONTRACT CREATION' },
          { k: 'VALUE', v: `${value.toLocaleString('en-US', { maximumFractionDigits: 6 })} ETH` },
          { k: 'BLOCK', v: rcpt?.blockNumber ? rcpt.blockNumber.toLocaleString() : 'not mined' },
          ...(gasEth !== null
            ? [{ k: 'GAS COST', v: `${gasEth.toLocaleString('en-US', { maximumFractionDigits: 8 })} ETH` }]
            : []),
        ],
      });
      return JSON.stringify({
        hash,
        status,
        from: tx.from,
        to: tx.to,
        value_eth: value,
        block: rcpt?.blockNumber ?? null,
        gas_cost_eth: gasEth,
        note:
          status === 'REVERTED'
            ? 'It was mined but FAILED — the gas was still spent. Say so plainly.'
            : 'Live read, shown as a card.',
      });
    } catch (e: any) {
      return `ERROR: could not read that transaction (${e?.message || 'RPC failure'}).`;
    }
  }

  if (name === 'get_chain_info') {
    ctx.steps.push('READING CHAIN STATE');
    const provider = tradeProvider();
    try {
      const [block, gas] = await Promise.all([provider.getBlock('latest'), provider.getGasPrice()]);
      const gwei = Number(ethers.utils.formatUnits(gas, 'gwei'));
      ctx.cards.push({
        kind: 'stats',
        status: 'LIVE',
        byline: `${TRADE_CHAIN_NAME.toUpperCase()} · CHAIN ${TRADE_CHAIN_ID}`,
        title: 'Chain state',
        rows: [
          { k: 'BLOCK', v: block.number.toLocaleString() },
          { k: 'GAS', v: `${gwei.toLocaleString('en-US', { maximumFractionDigits: 4 })} gwei` },
          { k: 'MINED', v: new Date(block.timestamp * 1000).toISOString().replace('T', ' ').slice(0, 19) + 'Z' },
        ],
      });
      return JSON.stringify({
        block: block.number,
        gas_gwei: gwei,
        block_time: new Date(block.timestamp * 1000).toISOString(),
        chain: TRADE_CHAIN_NAME,
        chain_id: TRADE_CHAIN_ID,
      });
    } catch (e: any) {
      return `ERROR: could not read chain state (${e?.message || 'RPC failure'}).`;
    }
  }

  if (name === 'critique_subject') {
    ctx.steps.push('READING THE WORK');
    const subject = await resolveSubject(String(input?.subject || ''));
    if (!subject) {
      return 'ERROR: no SAGE drop matches that. Ask which work they mean, or use list_drops. Do NOT critique from memory — without the image there is nothing to look at.';
    }
    const img = await subjectImage(subject);
    if (!img) {
      return `ERROR: the artwork for "${subject.title}" could not be loaded, so there is nothing to look at. Say so; do not critique it from its title.`;
    }
    // Flagging that this turn carries a critique switches on the extra system
    // block and the image content. See the handler below.
    ctx.critique = {
      subject,
      base64: img.bytes.toString('base64'),
      mime: img.mime,
    };
    ctx.cards.push({
      kind: 'image',
      status: 'UNDER REVIEW',
      byline: `${subject.artist.toUpperCase()} · SAGE DROP`,
      title: subject.title,
      images: [subject.imageUrl],
      rows: Object.entries(subject.facts)
        .filter(([k]) => k !== 'artistStatement')
        .map(([k, v]) => ({ k: k.toUpperCase(), v })),
    });
    return JSON.stringify({
      subject: subject.title,
      artist: subject.artist,
      facts: subject.facts,
      note: 'The artwork is attached to this turn. Write the four movements as prose. Every platform fact you state must come from `facts` above.',
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
  const ctx = {
    address: requester.walletAddress || null,
    cards: [] as Card[],
    steps: [] as string[],
    // images are billed per render, on the same $0.002/credit unit as tokens
    imageCredits: 0,
    imageModelId: IMAGE_MODELS.some((m) => m.id === body.imageModel)
      ? String(body.imageModel)
      : DEFAULT_IMAGE_MODEL_ID,
    // Images already generated in this thread, newest first. prepare_mint
    // defaults to the newest so "go ahead" mints what is on screen instead of
    // paying to render a fresh one.
    recentImages: (Array.isArray(body.recentImages) ? body.recentImages : [])
      .filter((u: any) => typeof u === 'string' && /^https:\/\//.test(u))
      .slice(0, 6),
    // set by critique_subject when a work is loaded for this turn
    critique: undefined as { subject: any; base64: string; mime: string } | undefined,
  };

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
          // The cached prefix stays byte-identical; the thread-specific note
          // is a SECOND block so it cannot break the cache. Without it the
          // model cannot see that an image exists — card data never reaches
          // it, only text — so "make it an NFT" rendered a fresh one and
          // charged for it.
          system: [
            { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
            // Interpretation is forbidden by the cached prefix; this narrow
            // amendment permits it for criticism only, and only on the turn
            // that carries a work to look at.
            ...(ctx.critique ? [{ type: 'text', text: CRITIQUE_RULES }] : []),
            ...(ctx.recentImages.length
              ? [
                  {
                    type: 'text',
                    text:
                      `CONTEXT: you have already generated ${ctx.recentImages.length} image(s) in this conversation. ` +
                      'To mint the most recent one, call prepare_mint WITHOUT image_url. ' +
                      'Do NOT call generate_image again unless the user asks for something different — ' +
                      'rendering costs them credits, and "make it an NFT", "mint it" or "go ahead" mean the image already on screen.',
                  },
                ]
              : []),
          ],
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
        // A critique result carries the artwork itself. Image BEFORE text is
        // what Anthropic's vision guidance recommends, and without this the
        // model would be critiquing a title rather than a picture.
        if (t.name === 'critique_subject' && ctx.critique) {
          results.push({
            type: 'tool_result',
            tool_use_id: t.id,
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: ctx.critique.mime,
                  data: ctx.critique.base64,
                },
              },
              { type: 'text', text: out },
            ],
          });
        } else {
          results.push({ type: 'tool_result', tool_use_id: t.id, content: out });
        }
      }
      messages.push({ role: 'user', content: results });
    }

    // Debit AFTER the work, from real usage. If the balance ran out mid-turn
    // the answer is still delivered — we already paid upstream for it — and
    // the account simply floors at whatever it had; the gate above stops the
    // NEXT turn. Charging for work we then withhold would be worse.
    // One balance covers text and images because both are metered at
    // $0.002/credit — see modelPricing.
    const cost = creditsForUsage(chosen, inputTokens, outputTokens) + ctx.imageCredits;
    const remaining = await debitCredits(payer, cost);

    return res.status(200).json({
      text: finalText,
      steps: ctx.steps,
      cards: ctx.cards,
      usage: {
        inputTokens,
        outputTokens,
        cost,
        imageCredits: ctx.imageCredits,
        credits: remaining,
        model: priceFor(chosen).label,
      },
    });
  } catch (e: any) {
    console.error('agent route error', e?.message);
    return res.status(500).json({ error: 'agent request failed' });
  }
}
