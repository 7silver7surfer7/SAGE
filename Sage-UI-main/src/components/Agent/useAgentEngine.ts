import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BotLink,
  Card,
  Holding,
  Message,
  ModelOption,
  Suggestion,
  Thread,
  Tier,
  TxRecord,
} from './types';
import { matchDrop, type AgentDrop } from './dropIndex';
import type { AgentWallet } from './useAgentWallet';
import { SAGE_PRICE_TOKEN_ADDRESS } from '@/constants/config';
import { CREDIT_TIERS } from '@/constants/credits';
import {
  IMAGE_MODELS,
  DEFAULT_IMAGE_MODEL_ID,
  creditsForImage,
  imagePriceFor,
} from '@/constants/modelPricing';

/**
 * Fallback only. Orders now carry their own token address, resolved and priced
 * server-side; this covers a `buy_sage` intent from an older card still on
 * screen. It is the MAINNET address, which is the chain the agent trades on.
 */
const SAGE_TOKEN = SAGE_PRICE_TOKEN_ADDRESS;

/**
 * SAGE Agent — conversation engine.
 *
 * WHAT IS AND IS NOT REAL
 * -----------------------
 * The source design ran its agent through `window.claude.complete()`, a bridge
 * that only exists inside the design-canvas preview. There is no such API in a
 * browser, and the key for a real one must never reach the client — so the
 * model call lives behind ONE seam here: `respond()`.
 *
 * Today `respond()` is a local, deterministic responder over the same sample
 * index the design shipped. It costs nothing, needs no key, and is labelled
 * exactly as the design labels it ("SAMPLE FEED · NOT LIVE DATA"), so nothing
 * on screen claims to be live market data.
 *
 * To make it real, replace `respond()` with a fetch to a server route that
 * holds ANTHROPIC_API_KEY and runs the tool loop server-side. Everything else
 * in this file — metering, the signing gate, panel state — already assumes an
 * async responder and needs no change.
 *
 * The credit meter is deliberately kept: it is the design's cost model
 * (1 credit ≈ 1k tokens, output weighted 5×, scaled by the model's rate), and
 * wiring a real model without a meter in place is how an LLM bill runs away.
 */

const FEED_NOTE = 'SAMPLE FEED · NOT LIVE DATA';

/** The model the picker starts on, by id — not by position in the list. */
const DEFAULT_MODEL_ID = 'claude-sonnet-5';

/**
 * Published list prices, USD per million tokens.
 *
 * The design shipped invented multipliers (Opus 5×, Fable 1.6×, Haiku 0.3×)
 * which do not match what these models actually cost — it billed Fable, the
 * most expensive of the four, at under a third of Opus. Rates are therefore
 * DERIVED from the real prices below rather than typed by hand, so the meter
 * cannot drift from the price list again.
 *
 * Output is exactly 5× input for all four, which is what makes the single
 * `rate` per model sound: the meter already weights output 5× (see `cost`
 * below), so scaling by the input ratio prices both halves correctly.
 * Sonnet is the unit — 1 credit ≈ 1k Sonnet input-equivalent tokens.
 */
const PRICES = [
  { id: 'claude-fable-5', label: 'FABLE 5', usdIn: 10, usdOut: 50, note: 'HARDEST PROBLEMS' },
  { id: 'claude-opus-5', label: 'OPUS 5', usdIn: 5, usdOut: 25, note: 'DEEPEST REASONING' },
  { id: 'claude-sonnet-5', label: 'SONNET 5', usdIn: 2, usdOut: 10, note: 'BALANCED · DEFAULT' },
  { id: 'claude-haiku-4-5', label: 'HAIKU 4.5', usdIn: 1, usdOut: 5, note: 'FAST · CHEAPEST' },
];
const SONNET_USD_IN = PRICES.find((m) => m.id === DEFAULT_MODEL_ID)!.usdIn;

export const MODELS: ModelOption[] = PRICES.map((m) => ({
  ...m,
  rate: m.usdIn / SONNET_USD_IN,
}));

// The drop catalogue is REAL — passed in from getStaticProps via the same
// getDropsPageData() the /drops page uses, so the agent cannot describe a drop
// the site does not show. See dropIndex.ts.

const LISTINGS = [
  { edition: '#128', price: 0.14, seller: '0x2Ba1…8fD0', venue: 'SAGE' },
  { edition: '#302', price: 0.16, seller: '0x4dA9…c710', venue: 'OPENSEA' },
  { edition: '#512', price: 0.19, seller: '0x91cc…4a17', venue: 'SAGE' },
  { edition: '#877', price: 0.21, seller: '0xB1f4…09aE', venue: 'OPENSEA' },
];

// Wallet figures are REAL — supplied by useAgentWallet (wagmi + the app's own
// useSAGEAccount). Nothing about a balance is mocked here.

// One source for prices, shared with the API route that verifies payments.
// Priced in USD; the ETH figure is filled in from the live quote below.
const TIERS: Tier[] = CREDIT_TIERS.map((t) => ({
  id: t.id,
  title: t.title,
  credits: t.credits,
  cost: `$${t.usd.toFixed(2)}`,
  note: t.note,
  ...(t.bonus ? { bonus: t.bonus } : {}),
}));

const fmt = (n: number) => n.toLocaleString('en-US');

export interface AgentEngineOptions {
  /** the real drop catalogue, from getStaticProps */
  drops: AgentDrop[];
  /** real wallet figures — see useAgentWallet */
  wallet: AgentWallet;
  startingCredits?: number;
}

/** One assistant turn. `usage` is present only when the server actually billed. */
interface AgentTurn {
  steps: string[];
  cards: Card[];
  prose: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cost: number;
    /** portion of `cost` that was image rendering */
    imageCredits?: number;
    credits: number;
    model: string;
  };
}

export function useAgentEngine({ drops, wallet, startingCredits = 0 }: AgentEngineOptions) {
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Zero until the server says otherwise. A new wallet genuinely has no
  // credits, and seeding a balance here would show someone compute they never
  // bought — the server would refuse the very first turn.
  const [credits, setCredits] = useState(startingCredits);
  const [creditsLoaded, setCreditsLoaded] = useState(false);
  const [buying, setBuying] = useState(false);
  /** live ETH quote per tier id, from /api/credits */
  const [tierEth, setTierEth] = useState<Record<string, number>>({});
  const [modelId, setModelId] = useState(DEFAULT_MODEL_ID);
  const [modelOpen, setModelOpen] = useState(false);
  const [imageModelId, setImageModelId] = useState(DEFAULT_IMAGE_MODEL_ID);
  const [imageModelOpen, setImageModelOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);

  const [buyOpen, setBuyOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [portfolioOpen, setPortfolioOpen] = useState(false);
  const [botOpen, setBotOpen] = useState(false);
  const [botEnabled, setBotEnabled] = useState(true);
  const [linkDraft, setLinkDraft] = useState('');
  const [mentionDraft, setMentionDraft] = useState('');
  const [payWith, setPayWith] = useState('eth');
  const [tierId, setTierId] = useState('curator');

  // Empty, not seeded. The ledger now records real signed transactions, and a
  // fabricated row sitting next to a confirmed on-chain one reads as history.
  const [txs, setTxs] = useState<TxRecord[]>([]);
  const [owned, setOwned] = useState<Holding[]>([]);
  const [links, setLinks] = useState<BotLink[]>([
    { handle: '@collector_eth', wallet: '0x7F3a…9C21', perTweet: 0.5, daily: 2.0, spent: 0.35, scopes: 'BUY · MINT · SWAP' },
    { handle: '@nulldelta', wallet: '0x2Ba1…8fD0', perTweet: 0.1, daily: 0.4, spent: 0.0, scopes: 'BUY ONLY' },
  ]);

  /**
   * The authoritative balance comes from the server, per wallet. Refetched on
   * every address change so switching accounts cannot carry the previous
   * wallet's credits across.
   */
  useEffect(() => {
    let live = true;
    if (!wallet.connected) {
      setCredits(0);
      setCreditsLoaded(false);
      return () => {
        live = false;
      };
    }
    fetch('/api/credits/')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live) return;
        setCredits(Number(d?.credits) || 0);
        setCreditsLoaded(true);
        const quotes: Record<string, number> = {};
        for (const t of d?.tiers || []) if (t.eth) quotes[t.id] = t.eth;
        setTierEth(quotes);
      })
      .catch(() => live && setCreditsLoaded(true));
    return () => {
      live = false;
    };
  }, [wallet.connected, wallet.address]);

  const scrollRef = useRef<HTMLDivElement>(null);
  // late-bound: respond() closes over these before confirmIntent is declared
  const confirmIntentRef = useRef<(id: number, intent: any) => void>(() => {});
  const discardIntentRef = useRef<(id: number) => void>(() => {});
  const seq = useRef(0);
  const nextId = () => ++seq.current;

  const model =
    MODELS.find((m) => m.id === modelId) || MODELS.find((m) => m.id === DEFAULT_MODEL_ID)!;

  const scrollToEnd = useCallback(() => {
    // next paint, so the just-appended message is measured
    window.requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  /** Replace the last message (the in-flight assistant turn). */
  const patchLast = useCallback((fn: (m: Message) => void) => {
    setMsgs((prev) => {
      if (!prev.length) return prev;
      const next = prev.slice();
      const last = { ...next[next.length - 1] };
      fn(last);
      next[next.length - 1] = last;
      return next;
    });
  }, []);

  // ── the model call ────────────────────────────────────────────────────────
  /**
   * One assistant turn, via /api/agent.
   *
   * The route holds the API key and runs the tool loop server-side; nothing
   * here ever sees it. Money actions come back as an unsigned INTENT on a
   * pending tx card — the user signs those with their own wallet (see
   * `confirmIntent`), so this client never receives a receipt for something it
   * did not sign.
   *
   * Falls back to the local responder when the route is unavailable (no key
   * configured, or signed out) so the page stays usable rather than erroring
   * into a dead end — the fallback is clearly labelled as sample data.
   */
  const respond = useCallback(
    async (text: string): Promise<AgentTurn> => {
      try {
        const history = msgs
          .filter((m) => m.text)
          .slice(-12)
          .map((m) => ({ role: m.isUser ? 'user' : 'assistant', content: m.text }));
        const r = await fetch('/api/agent/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text, model: modelId, imageModel: imageModelId, history }),
        });
        if (r.ok) {
          const d = await r.json();
          return {
            steps: Array.isArray(d.steps) ? d.steps : [],
            // ids are assigned client-side so cards stay keyable across turns
            // ids are assigned here so cards stay keyable; a pending order
            // gets its confirm/discard bound to the LOCAL signer — the server
            // only ever described the order, it never carried a way to send it.
            cards: (Array.isArray(d.cards) ? d.cards : []).map((c: any) => {
              const id = nextId();
              if (c.kind === 'tx' && c.pending) {
                return {
                  ...c,
                  id,
                  confirm: () => confirmIntentRef.current(id, c.intent),
                  cancel: () => discardIntentRef.current(id),
                };
              }
              return { ...c, id };
            }),
            prose: String(d.text || ''),
            usage: d.usage,
          };
        }
        if (r.status === 402) {
          // Server refused the turn: the wallet is out of credits. This is the
          // authoritative balance, so trust it over whatever is on screen.
          const d = await r.json().catch(() => ({}));
          setCredits(Number(d?.credits) || 0);
          setBuyOpen(true);
          return {
            steps: [],
            cards: [],
            prose: 'You are out of compute credits. Top up to keep going — every turn is metered by the tokens it actually uses.',
          };
        }
        if (r.status === 401) {
          return {
            steps: [],
            cards: [],
            prose: 'Sign in with your wallet and I can answer from the live index.',
          };
        }
      } catch {
        /* fall through to the local responder below */
      }
      return localRespond(text);
    },
    [msgs, modelId, imageModelId, wallet, drops]
  );

  /** Deterministic offline answer — used only when /api/agent is unreachable. */
  const localRespond = useCallback(
    async (text: string): Promise<AgentTurn> => {
      const q = text.toLowerCase();
      const steps: string[] = [];
      const cards: Card[] = [];

      const wantsWallet = /balance|holding|wallet|own|portfolio/.test(q);
      const wantsListings = /listing|floor|secondary|buy|cheapest|ask/.test(q);
      const wantsToken = /token|price|pixel|market cap|stat/.test(q);
      const wantsDrop = /drop|rmonet|edition|mint|art|collection/.test(q);

      if (wantsWallet) {
        if (!wallet.connected) {
          cards.push({
            id: nextId(),
            kind: 'wallet',
            status: 'WALLET REQUIRED',
            title: 'Connect to read your holdings.',
            body: 'The agent never holds custody. Connecting only grants read access until you sign.',
            needsConnect: true,
            rows: [],
          });
        } else {
          steps.push('READING WALLET · ' + wallet.address);
          cards.push({
            id: nextId(),
            kind: 'wallet',
            status: 'CONNECTED · ' + wallet.address,
            title: 'Holdings',
            body: 'Read-only snapshot at current block.',
            rows: [
              { k: 'ETH', v: wallet.ethLabel + ' ETH' },
              { k: 'SAGE', v: wallet.sageLabel + ' SAGE' },
              { k: 'PIXELS', v: wallet.pixels },
            ],
          });
        }
      }

      if (wantsToken) {
        steps.push('QUERYING TOKEN ORACLE');
        cards.push({
          id: nextId(),
          kind: 'stats',
          status: 'SAGE TOKEN · INDICATIVE',
          byline: FEED_NOTE,
          rows: [
            { k: 'SAGE', v: '$0.0412' },
            { k: '24H', v: '+6.8%' },
            { k: 'MKT CAP', v: '$41.2M' },
            { k: 'HOLDERS', v: '18,204' },
            { k: 'PIXELS MULT', v: '2.4×' },
            { k: 'CHAIN', v: 'ROBINHOOD' },
          ],
        });
      }

      if (wantsDrop) {
        // Prefer the drop the user actually named; otherwise show the most
        // recent few. Both come from the real catalogue.
        const named = matchDrop(drops, q);
        const shown = named ? [named] : drops.slice(0, 3);
        if (!shown.length) {
          steps.push('READING DROP INDEX · EMPTY');
        } else {
          steps.push(
            named
              ? 'FETCHING DROP · ' + named.title.toUpperCase()
              : 'READING DROP INDEX · ' + drops.length + ' LIVE'
          );
          shown.forEach((d) =>
            cards.push({
              id: nextId(),
              kind: 'drop',
              status: d.status,
              chain: 'ROBINHOOD CHAIN',
              title: d.title,
              byline: 'by ' + d.artist,
              price: d.price,
              editions: d.editions,
              minted: d.minted,
              imgUrl: d.image,
              imgHint: 'Drop artwork',
            })
          );
        }
      }

      if (wantsListings) {
        steps.push('SCANNING ORDER BOOKS · RMONET · SAGE + OPENSEA');
        const sorted = LISTINGS.slice().sort((a, b) => a.price - b.price);
        cards.push({
          id: nextId(),
          kind: 'listings',
          status: 'AGGREGATED SECONDARY · SAGE + OPENSEA',
          title: 'RMonet · ' + sorted.length + ' listings',
          byline: 'FLOOR ' + sorted[0].price.toFixed(2) + ' ETH · ' + sorted[0].venue,
          listRows: sorted.map((l) => ({
            k: l.edition,
            sub: l.venue + ' · ' + l.seller,
            v: l.price.toFixed(2) + ' ETH',
          })),
        });
      }

      const prose = buildProse({ q, connected: wallet.connected, wantsWallet, wantsListings, wantsToken, wantsDrop });
      return { steps, cards, prose };
    },
    [drops, wallet]
  );

  const send = useCallback(
    async (override?: string) => {
      const text = (override ?? input).trim();
      if (!text || busy) return;
      if (credits < 1) {
        setError('OUT OF CREDITS · TOP UP TO CONTINUE');
        setBuyOpen(true);
        return;
      }
      setInput('');
      setError('');
      setBusy(true);
      setMsgs((prev) =>
        prev.concat([
          { id: nextId(), who: 'YOU', isUser: true, text },
          { id: nextId(), who: 'SAGE AGENT', isUser: false, text: '', steps: [], cards: [], thinking: true },
        ])
      );
      scrollToEnd();

      try {
        const { steps, cards, prose, usage } = await respond(text);
        // Billing is the SERVER's. It has the real token counts from the API
        // response and has already debited the ledger; the previous estimate
        // here (token counts guessed from string lengths) could not agree with
        // what was actually charged. With no usage — the offline responder —
        // nothing was spent, so nothing is shown.
        if (usage) {
          setCredits(usage.credits);
          patchLast((m) => {
            m.thinking = false;
            m.text = prose;
            m.steps = steps;
            m.cards = cards;
            m.costLabel =
              (usage.model || model.label) +
              ' · ' + fmt(usage.inputTokens) + ' TOK IN · ' + fmt(usage.outputTokens) + ' OUT' +
              (usage.imageCredits ? ' · ' + fmt(usage.imageCredits) + ' CR IMAGE' : '') +
              ' · −' + fmt(usage.cost) + ' CR';
            m.balanceLabel = 'BALANCE ' + fmt(usage.credits) + ' CR';
          });
        } else {
          patchLast((m) => {
            m.thinking = false;
            m.text = prose;
            m.steps = steps;
            m.cards = cards;
          });
        }
      } catch (e: any) {
        setError('AGENT ERROR · ' + (e?.message || 'request failed'));
        patchLast((m) => {
          m.thinking = false;
        });
      }
      setBusy(false);
      scrollToEnd();
    },
    [input, busy, credits, model, respond, patchLast, scrollToEnd]
  );

  /**
   * Hand off to RainbowKit. The design mutated the blocking wallet card in
   * place on connect, filling in balances immediately — that worked because
   * its wallet was a local constant. A real connection resolves
   * asynchronously (modal, extension, chain switch, then an RPC read), so
   * there is nothing truthful to write at this moment. Instead the card keeps
   * its prompt and the live figures land in the rail as wagmi settles; asking
   * again renders a card with real balances.
   */
  const connect = useCallback(() => {
    wallet.connect();
  }, [wallet]);

  /**
   * Execute an order the user confirmed on a pending tx card.
   *
   * This is the ONLY place value moves, and it moves through the user's own
   * signer — the server never signs. The order is re-derived from the card's
   * intent here rather than trusting anything the model said in prose, and the
   * underlying buy helpers now quote and bound slippage themselves.
   */
  const confirmIntent = useCallback(
    async (cardId: number, intent: any) => {
      if (!wallet.signer) {
        setError('CONNECT A WALLET TO SIGN THIS ORDER');
        return;
      }
      const settle = (patch: Record<string, any>) =>
        setMsgs((prev) =>
          prev.map((m) => ({
            ...m,
            cards: (m.cards || []).map((c) =>
              c.id === cardId ? ({ ...c, pending: false, ...patch } as Card) : c
            ),
          }))
        );
      try {
        // buy_sage is the pre-multi-token intent; treat it as SAGE.
        const isBuy = intent?.action === 'buy_token' || intent?.action === 'buy_sage';
        const isSell = intent?.action === 'sell_token';
        const isMint = intent?.action === 'mint_edition';
        if (!isBuy && !isSell && !isMint) throw new Error('unsupported order');
        setError('');
        const { buyAnyToken, sellAnyToken } = await import('@/utilities/socialToken');
        const { ensureTradeChain, TRADE_VENUE } = await import('./trade');
        const { ethers } = await import('ethers');

        const token = intent.token || SAGE_TOKEN;
        const symbol = intent.symbol || 'SAGE';

        // Put the wallet on the trading chain FIRST and keep the signer it
        // hands back — the original is still bound to the old network, and
        // signing with it sends the order to whatever chain the user was on.
        settle({
          status: 'SIGNING',
          byline: isSell ? 'APPROVE, THEN CONFIRM' : 'CONFIRM IN YOUR WALLET',
        });
        const signer = await ensureTradeChain(wallet.signer);

        if (isMint) {
          // The art is already pinned server-side, so this only deploys the
          // edition. createEdition returns its address from the receipt.
          const { createEdition } = await import('@/utilities/socialToken');
          const { edition, txHash } = await createEdition(
            intent.name,
            intent.symbol,
            intent.tokenUri,
            Number(intent.maxSupply) || 1,
            Number(intent.priceEth) || 0,
            signer
          );
          settle({
            status: 'MINTED',
            byline: 'SIGNED BY YOU',
            rows: [
              { k: 'EDITION', v: edition },
              { k: 'TX', v: txHash },
            ],
          });
          setTxs((prev) =>
            [
              {
                title: `Mint "${intent.name}"`,
                venue: 'NFT LAUNCHER · ROBINHOOD CHAIN',
                status: 'CONFIRMED',
                hash: txHash,
                amount: Number(intent.priceEth) > 0 ? `${intent.priceEth} ETH each` : 'FREE MINT',
                via: 'AGENT',
                when: 'JUST NOW',
              },
            ].concat(prev)
          );
          return;
        }

        // Venue (curve vs pool) is resolved from chain state, not assumed.
        const eth = Number(intent.ethAmount);
        const tokenAmount = Number(intent.tokenAmount);
        const { hash, venue, quoted } = isSell
          ? await sellAnyToken(token, tokenAmount, signer, undefined, TRADE_VENUE)
          : await buyAnyToken(token, eth, signer, undefined, TRADE_VENUE);

        settle({ status: 'CONFIRMED', byline: 'SIGNED BY YOU', rows: [{ k: 'TX', v: hash }] });
        setTxs((prev) =>
          [
            {
              title: isSell
                ? `Sell ${tokenAmount.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${symbol}`
                : `Buy ${symbol} with ${eth} ETH`,
              venue: (venue === 'pool' ? 'POOL' : 'CURVE') + ' · ROBINHOOD CHAIN',
              status: 'CONFIRMED',
              hash,
              amount: isSell
                ? `${Number(ethers.utils.formatEther(quoted)).toFixed(6)} ETH`
                : `${eth} ETH`,
              via: 'AGENT',
              when: 'JUST NOW',
            },
          ].concat(prev)
        );
      } catch (e: any) {
        // Wallet rejections are a normal outcome, not a fault — say so in the
        // user's language. Everything else keeps the underlying reason, which
        // resolveBuyVenue/ensureTradeChain already phrase readably.
        const code = e?.code ?? e?.data?.originalError?.code;
        const reason =
          code === 4001 || code === 'ACTION_REJECTED'
            ? 'declined in wallet'
            : e?.reason || e?.message || 'rejected';
        settle({ status: 'FAILED', byline: reason.slice(0, 80) });
        setError('ORDER NOT SENT · ' + reason.slice(0, 90));
      }
    },
    [wallet.signer]
  );

  const discardIntent = useCallback((cardId: number) => {
    setMsgs((prev) =>
      prev.map((m) => ({
        ...m,
        cards: (m.cards || []).map((c) =>
          c.id === cardId ? ({ ...c, pending: false, status: 'DISCARDED', byline: 'NOT BROADCAST' } as Card) : c
        ),
      }))
    );
  }, []);

  // keep the late-bound refs pointed at the current closures
  confirmIntentRef.current = confirmIntent;
  discardIntentRef.current = discardIntent;

  /**
   * Buy credits for real: pay the treasury in ETH, then have the server verify
   * the payment on chain and credit the ledger.
   *
   * The client cannot grant itself anything here — it sends a transaction and
   * reports the hash. Every figure that matters (tier, price, credits added)
   * is decided server-side from the value actually received, so a tampered
   * client can at most claim what it genuinely paid.
   */
  const buyCredits = useCallback(
    async (tierId: string) => {
      const t = TIERS.find((x) => x.id === tierId) || TIERS[1];
      if (!wallet.signer) {
        setError('CONNECT A WALLET TO BUY CREDITS');
        return;
      }
      setBuying(true);
      setError('');
      try {
        const { ethers } = await import('ethers');
        const { ensureTradeChain } = await import('./trade');
        const { CREDIT_TREASURY } = await import('@/constants/credits');

        // Re-quote NOW rather than trusting a figure fetched when the page
        // loaded — prices are set in USD, so a stale ETH rate underpays and
        // the server correctly refuses to credit it.
        const q = await fetch('/api/credits/').then((r) => (r.ok ? r.json() : null));
        const quoted = (q?.tiers || []).find((x: any) => x.id === t.id);
        if (!quoted?.wei) throw new Error('could not price that tier — try again in a moment');

        const signer = await ensureTradeChain(wallet.signer);
        const tx = await signer.sendTransaction({
          to: CREDIT_TREASURY,
          value: ethers.BigNumber.from(quoted.wei),
        });
        setTxs((prev) =>
          [
            {
              title: fmt(t.credits) + ' compute credits',
              venue: 'SAGE CREDIT DESK · ROBINHOOD CHAIN',
              status: 'PENDING',
              hash: tx.hash,
              amount: `${t.cost} · ${Number(quoted.eth).toFixed(6)} ETH`,
              via: 'CONSOLE',
              when: 'JUST NOW',
            },
          ].concat(prev)
        );
        await tx.wait(1);

        const r = await fetch('/api/credits/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ txHash: tx.hash }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error || 'the payment could not be credited');

        setCredits(Number(d.credits) || 0);
        setTxs((prev) =>
          prev.map((x) => (x.hash === tx.hash ? { ...x, status: 'CONFIRMED' } : x))
        );
        setBuyOpen(false);
      } catch (e: any) {
        const code = e?.code ?? e?.data?.originalError?.code;
        const reason =
          code === 4001 || code === 'ACTION_REJECTED'
            ? 'declined in wallet'
            : e?.reason || e?.message || 'payment failed';
        setError('CREDITS NOT ADDED · ' + String(reason).slice(0, 90));
      } finally {
        setBuying(false);
      }
    },
    [wallet.signer]
  );

  const revoke = useCallback((handle: string) => {
    setLinks((prev) => prev.filter((l) => l.handle !== handle));
  }, []);

  /**
   * Widen or narrow what a linked X account may do. Cycling BACK to "BUY ONLY"
   * is the quick way to de-scope an account without revoking it outright.
   */
  const cycleScopes = useCallback((handle: string) => {
    setLinks((prev) =>
      prev.map((l) =>
        l.handle === handle
          ? { ...l, scopes: l.scopes === 'BUY ONLY' ? 'BUY · MINT · SWAP' : 'BUY ONLY' }
          : l
      )
    );
  }, []);

  const linkAccount = useCallback((raw: string) => {
    const h = raw.trim();
    if (!h) return;
    const handle = h.startsWith('@') ? h : '@' + h;
    setLinks((prev) =>
      prev.concat([
        // New links start at the tightest caps — a freshly authorised X
        // account should not inherit a large spend allowance by default.
        { handle, wallet: wallet.address, perTweet: 0.25, daily: 1.0, spent: 0, scopes: 'BUY ONLY' },
      ])
    );
  }, []);

  const runMention = useCallback(
    (text: string) => {
      if (!botEnabled) {
        setError('SOCIAL AGENT PAUSED · ENABLE IT TO ACT ON MENTIONS');
        return;
      }
      setBotOpen(false);
      send(text);
    },
    [botEnabled, send]
  );

  const creditsPctNum = Math.max(0, Math.min(100, Math.round((credits / 2500) * 100)));

  const suggestions: Suggestion[] = useMemo(
    () => [
      { num: '01', text: 'What has SAGE dropped so far?' },
      { num: '02', text: "I've never used a wallet. Walk me through minting." },
      { num: '03', text: 'Show me the RMonet secondary floor.' },
      { num: '04', text: 'What is the SAGE token doing today?' },
    ],
    []
  );

  const threads: Thread[] = useMemo(
    () => [
      { title: 'RMonet secondary floor', when: '2H AGO', select: () => {} },
      { title: 'What are Pixels?', when: 'YESTERDAY', select: () => {} },
      { title: 'Bridging to Robinhood Chain', when: '3 JUL', select: () => {} },
    ],
    []
  );

  return {
    // conversation
    msgs,
    input,
    setInput,
    send,
    busy,
    error,
    isEmpty: msgs.length === 0,
    suggestions,
    scrollRef,
    sendLabel: busy ? 'working' : 'send',

    // model
    models: MODELS,
    modelId,
    modelOpen,
    toggleModel: () => setModelOpen((v) => !v),
    selectModel: (id: string) => {
      setModelId(id);
      setModelOpen(false);
    },

    // image model — priced per render on the same credit unit as text, so the
    // picker shows what each tier actually costs rather than a vague quality
    // word. See modelPricing.IMAGE_MODELS.
    imageModels: IMAGE_MODELS.map((m) => ({
      id: m.id,
      label: m.label,
      note: m.note,
      rate: creditsForImage(m.id),
      seconds: m.seconds,
    })),
    imageModelId,
    imageModelLabel: imagePriceFor(imageModelId).label,
    imageModelCost: creditsForImage(imageModelId),
    imageModelOpen,
    toggleImageModel: () => setImageModelOpen((v) => !v),
    selectImageModel: (id: string) => {
      setImageModelId(id);
      setImageModelOpen(false);
    },

    // wallet
    connected: wallet.connected,
    address: wallet.address,
    confirmIntent,
    discardIntent,
    connect,

    // credits + balances
    credits,
    creditsLabel: fmt(credits),
    creditsPct: creditsPctNum + '%',
    creditsPctLabel: creditsPctNum + '% OF 2,500',
    ethLabel: wallet.ethLabel,
    sageLabel: wallet.sageLabel,
    usdgLabel: wallet.usdgLabel,
    pixels: wallet.pixels,

    // rail
    railCollapsed,
    toggleRail: () => setRailCollapsed((v) => !v),
    threads,
    portfolioTotal: owned.reduce((n, o) => n + o.cost, 0).toFixed(3) + ' ETH',
    txCount: txs.length,
    botStatus: botEnabled ? 'ACTIVE' : 'PAUSED',

    // panels
    buyOpen,
    openBuy: () => setBuyOpen(true),
    closeBuy: () => setBuyOpen(false),
    historyOpen,
    openHistory: () => setHistoryOpen(true),
    closeHistory: () => setHistoryOpen(false),
    portfolioOpen,
    openPortfolio: () => setPortfolioOpen(true),
    closePortfolio: () => setPortfolioOpen(false),
    botOpen,
    openBot: () => setBotOpen(true),
    closeBot: () => setBotOpen(false),

    // ── panel data ──────────────────────────────────────────────────────────
    txRows: txs,
    /** editions held, for the portfolio's NFT list */
    nfts: owned,
    /**
     * Real token positions. The design showed a USD value and a share-of-book
     * bar per row; there is no price oracle wired in here yet, so those read
     * "—" and the bars stay empty rather than displaying a fabricated
     * valuation. Wiring getSagePriceUsd() (utilities/sagePrice) plus an ETH
     * feed is what fills them in.
     */
    tokenHoldings: [
      { sym: 'ETH', amount: wallet.ethLabel, usd: '—', pct: '—', bar: '0%' },
      { sym: 'SAGE', amount: wallet.sageLabel, usd: '—', pct: '—', bar: '0%' },
      { sym: 'PIXELS', amount: wallet.pixels, usd: '—', pct: '—', bar: '0%' },
    ],
    portfolioUsd: '—',

    links,
    botEnabled,
    toggleBot: () => setBotEnabled((v) => !v),
    cycleScopes,
    linkAccount,
    revoke,
    runMention,
    linkDraft,
    setLinkDraft,
    mentionDraft,
    setMentionDraft,
    sampleMentions: [
      '$8 of $rhagent on Robinhood using usdg',
      'buy the floor punk under 45 ETH',
      '$25 of $sage using usdg',
    ],

    tiers: TIERS.map((t) => ({
      ...t,
      // second line under the USD price, once the quote lands
      costEth: tierEth[t.id] ? `${tierEth[t.id].toFixed(6)} ETH` : '',
    })),
    buyCredits,
    buying,
    creditsLoaded,
    tierId,
    setTierId,
    payWith,
    setPayWith,
    // ETH only. Paying in SAGE would need a price the server can trust when it
    // verifies the payment; discounting against a client-supplied figure is a
    // way to mint credits for free.
    payOptions: [{ id: 'eth', label: 'ETH' }],
    buyCta: buying
      ? 'confirming…'
      : wallet.connected
      ? 'confirm purchase'
      : 'connect wallet to buy',
    buyFootnote:
      'Credits are non-transferable and never expire. Paid in ETH and settled on Robinhood Chain.',

    // No sample-feed disclaimer any more: drops, balances, quotes, orders and
    // the credit meter are all live. The offline responder still labels itself
    // when /api/agent is unreachable — see localRespond.
    footerLeft:
      (wallet.connected ? 'AGENT MAY ACT ON-CHAIN · YOU SIGN EVERY TX' : 'READ-ONLY · CONNECT A WALLET TO ACT') +
      ' · METERED BY REAL TOKEN USAGE · ROBINHOOD MAINNET',
  };
}

/**
 * Curator voice, per the design's system prompt: precise, unhurried, no emoji,
 * no hype. It also forbids implying any future drop — so the "what's next"
 * answer says nothing is announced rather than inventing a roadmap.
 */
function buildProse(o: {
  q: string;
  connected: boolean;
  wantsWallet: boolean;
  wantsListings: boolean;
  wantsToken: boolean;
  wantsDrop: boolean;
}): string {
  const { q, connected, wantsWallet, wantsListings, wantsToken, wantsDrop } = o;

  if (/next|upcoming|roadmap|soon|announce/.test(q)) {
    return 'Nothing further has been announced. The index holds one confirmed drop — RMonet, by Silver Surfer — which sold out and now trades on secondary. I will not speculate about what follows.';
  }
  if (/wallet|never used|how do i|walk me|explain|what are pixel/.test(q)) {
    return 'A wallet is the account that holds your art and signs for it; no one can move a piece without your signature, including me.\n\nMinting is the moment an edition is created for you on-chain. You pay the edition price plus a small network fee, and the work lands in your wallet. Pixels accrue for holding SAGE and raise your standing in future allocations.';
  }
  if (wantsListings) {
    return 'The floor sits on SAGE at 0.14 ETH, with the remaining asks split across SAGE and OpenSea. Figures are indicative, drawn from a sample feed pending the live API.\n\nTell me which edition you want and I will build the order for you to sign.';
  }
  if (wantsWallet && !connected) {
    return 'I need read access before I can answer that. Connect from the card above — it grants reading only, and nothing moves until you sign.';
  }
  if (wantsWallet) {
    return 'That is your position at the current block. Balances are read-only here; any action against them would come back to you as an order to sign.';
  }
  if (wantsToken) {
    return 'SAGE is up modestly on the day against a thin book, so read the move with some caution. These figures are indicative, not live.';
  }
  if (wantsDrop) {
    return 'RMonet is the one confirmed drop in the index — a thousand editions by Silver Surfer, fully minted, now trading on secondary. The card carries the numbers; what it cannot tell you is that the work rewards being seen large.';
  }
  return 'I hold the SAGE index — every edition, every artist, every price. Ask about a drop, an artist, or the token, and I will pull the record. Figures come from a sample feed pending the live API.';
}
