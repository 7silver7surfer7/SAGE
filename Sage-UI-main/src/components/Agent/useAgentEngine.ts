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
import { getSession } from 'next-auth/react';
import useSignIn from '@/hooks/useSignIn';
import { useApproveAndDeployDropMutation } from '@/store/dropsReducer';
import { useCreateDropPostMutation } from '@/store/socialReducer';
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
  // autoPrompt=false: the app shell already owns the automatic prompt. This
  // mount only needs the manual trigger, for the X link's explicit re-ask.
  const { handleSignInClick } = useSignIn(false);
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

  // ── sessions ──────────────────────────────────────────────────────────
  // The rail's thread list shipped as three hardcoded strings. These hold the
  // real ones: the open session, and the wallet's other threads.
  const [sessionId, setSessionId] = useState<string>('');
  const [sessionList, setSessionList] = useState<
    { id: string; title: string; when: string }[]
  >([]);
  const [showArchived, setShowArchived] = useState(false);
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
  const [payWith, setPayWith] = useState('eth');
  const [tierId, setTierId] = useState('curator');

  // Empty, not seeded. The ledger now records real signed transactions, and a
  // fabricated row sitting next to a confirmed on-chain one reads as history.
  const [txs, setTxs] = useState<TxRecord[]>([]);
  const [owned, setOwned] = useState<Holding[]>([]);
  /** Real X link, from the server. Null until loaded. */
  const [xLink, setXLink] = useState<{
    linked: boolean;
    handle: string | null;
    dailyCap: number;
    servedToday: number;
  } | null>(null);

  // No seeded links. These were two invented handles carrying invented wallet
  // authority (0.50 ETH/tweet, 0.35 of 2.00 spent today) — none of it real,
  // none of it enforced. The only link that exists is the OAuth-verified one
  // in `xLink`, and its limits are credits and mentions/day, not ETH.
  const [links, setLinks] = useState<BotLink[]>([]);

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

  /** Refresh the rail's thread list. */
  const loadSessions = useCallback(
    async (archived = showArchived) => {
      if (!wallet.connected) {
        setSessionList([]);
        return;
      }
      try {
        const r = await fetch(`/api/agent-sessions/?archived=${archived ? '1' : '0'}`);
        if (!r.ok) return;
        const d = await r.json();
        setSessionList(Array.isArray(d?.sessions) ? d.sessions : []);
      } catch {
        /* the rail simply stays as it was */
      }
    },
    [wallet.connected, showArchived]
  );

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  /**
   * Persist one message. Creates the session on the FIRST message rather than
   * on page load, so opening the agent and typing nothing leaves no empty
   * thread in the rail.
   */
  const persist = useCallback(
    async (role: 'user' | 'assistant', text: string, payload?: any) => {
      if (!wallet.connected) return;
      try {
        // The REF, not the state. Both messages of a turn are persisted back
        // to back, and setSessionId does not update this closure before the
        // second call runs — so the assistant reply created a SECOND session
        // and the titled one was left holding nothing.
        let id = sessionIdRef.current || sessionId;
        if (!id) {
          const r = await fetch('/api/agent-sessions/', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: role === 'user' ? text : 'New session' }),
          });
          if (!r.ok) return;
          id = (await r.json())?.id || '';
          if (!id) return;
          sessionIdRef.current = id;
          setSessionId(id);
        }
        await fetch('/api/agent-sessions/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id, role, text, payload: payload ?? null }),
        });
        loadSessions();
      } catch {
        /* a failed write must never break the conversation on screen */
      }
    },
    [wallet.connected, sessionId, loadSessions]
  );

  /** Mirrors sessionId so a same-tick second write sees the id just created. */
  const sessionIdRef = useRef('');

  const loadXLink = useCallback(async () => {
    if (!wallet.connected) return setXLink(null);
    try {
      const r = await fetch('/api/x-link/');
      setXLink(r.ok ? await r.json() : null);
    } catch {
      setXLink(null);
    }
  }, [wallet.connected]);
  useEffect(() => {
    loadXLink();
  }, [loadXLink, wallet.address]);

  const scrollRef = useRef<HTMLDivElement>(null);
  // The drop pipeline, unchanged: a create_drop card deploys through the SAME
  // mutation the dashboard and the /social/launch/nft form use, so an
  // agent-assembled drop goes on-chain and goes live by exactly one code path.
  const [approveAndDeployDrop] = useApproveAndDeployDropMutation();
  const [createDropPost] = useCreateDropPostMutation();
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

  /**
   * An artwork the bot made on X, claimed here.
   *
   * The tweet id arrives in the URL, but it authorises nothing — the server
   * checks the signed-in wallet owns the X account that sent the mention. All
   * this does is turn an approved claim into the same pending-mint card the
   * console uses, so it signs through exactly one path.
   */
  const claimFromX = useCallback(async (tweetId: string) => {
    try {
      const r = await fetch(`/api/x-claim/?tweet=${encodeURIComponent(tweetId)}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError((d?.error || 'that claim could not be opened').toUpperCase());
        return;
      }
      if (d.alreadyMinted) {
        setError('THAT ARTWORK IS ALREADY MINTED');
        return;
      }
      const id = nextId();
      setMsgs((prev) =>
        prev.concat([
          {
            id: nextId(),
            who: 'SAGE AGENT',
            isUser: false,
            text: `This is the piece I made for @${d.handle} on X. It is pinned to IPFS already — signing deploys the edition.`,
            steps: ['CLAIMED FROM X'],
            cards: [
              {
                id,
                kind: 'tx',
                status: 'UNSIGNED ORDER',
                byline: 'ROBINHOOD CHAIN · YOU SIGN',
                title: `Mint "${d.prompt || 'Untitled'}" as a 1/1`,
                image: d.imageUri,
                pending: true,
                cta: 'sign & mint',
                rows: [
                  { k: 'FROM', v: `@${d.handle} on X` },
                  { k: 'SUPPLY', v: '1 of 1' },
                  { k: 'STORAGE', v: 'IPFS · PERMANENT' },
                ],
                confirm: () =>
                  confirmIntentRef.current(id, {
                    action: 'mint_edition',
                    tokenUri: d.tokenUri,
                    imageUrl: d.imageUri,
                    name: (d.prompt || 'Untitled').slice(0, 40),
                    symbol: (d.prompt || 'ART').replace(/[^a-zA-Z]/g, '').slice(0, 6).toUpperCase() || 'ART',
                    maxSupply: 1,
                    priceEth: 0,
                    claimTweetId: tweetId,
                  }),
                cancel: () => discardIntentRef.current(id),
              } as any,
            ],
          } as Message,
        ])
      );
      scrollToEnd();
    } catch {
      setError('THAT CLAIM COULD NOT BE OPENED');
    }
  }, [scrollToEnd]);

  // ?twitter=... from the OAuth round trip
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const q = new URLSearchParams(window.location.search);
    const t = q.get('twitter');
    if (!t) return;
    if (t === 'linked') setError('');
    else if (t === 'replaced')
      setError(`X ACCOUNT LINKED · REPLACED @${q.get('previous') || 'PREVIOUS'} ON THIS WALLET`);
    else if (t === 'signin-required')
      setError('SIGN IN WITH YOUR WALLET FIRST — THEN CONNECT X AGAIN');
    else if (t === 'already-linked')
      setError('THAT X ACCOUNT IS ALREADY LINKED TO ANOTHER WALLET');
    else if (t === 'failed')
      setError('X LINK FAILED · ' + (q.get('reason') || 'unknown').toUpperCase().slice(0, 80));
    loadXLink();
    window.history.replaceState({}, '', window.location.pathname);
  }, [loadXLink]);

  // ?claim=<tweetId> in the URL, once the wallet is connected
  useEffect(() => {
    if (!wallet.connected || typeof window === 'undefined') return;
    const t = new URLSearchParams(window.location.search).get('claim');
    if (!t) return;
    claimFromX(t);
    // drop the param so a refresh does not re-offer it
    window.history.replaceState({}, '', window.location.pathname);
  }, [wallet.connected, claimFromX]);

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
        // Images the agent has already made, newest first. History carries only
        // TEXT, so without this the model cannot see that an image exists and
        // regenerates one to mint — a second charge for a picture the user is
        // already looking at.
        const recentImages = msgs
          .flatMap((m) => (m.cards || []).flatMap((c: any) => (c.kind === 'image' ? c.images || [] : [])))
          .filter((u: any): u is string => typeof u === 'string')
          .reverse()
          .slice(0, 6);
        const r = await fetch('/api/agent/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text, model: modelId, imageModel: imageModelId, history, recentImages }),
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
      // Awaited: this call is what CREATES the session, and the assistant
      // write that follows needs its id. Fire-and-forget raced the reply and
      // left the titled session empty while the answer landed in a second one.
      await persist('user', text);

      try {
        const { steps, cards, prose, usage } = await respond(text);
        // Billing is the SERVER's. It has the real token counts from the API
        // response and has already debited the ledger; the previous estimate
        // here (token counts guessed from string lengths) could not agree with
        // what was actually charged. With no usage — the offline responder —
        // nothing was spent, so nothing is shown.
        // Cards are stored WITHOUT their handlers — confirm/cancel are
        // closures over a signer that will not exist on reload, so they are
        // rebound when a thread is reopened.
        persist('assistant', prose, { steps, cards: cards.map(({ confirm, cancel, ...c }: any) => c) });
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
      const settle = (patch: Record<string, any>) => {
        setMsgs((prev) =>
          prev.map((m) => ({
            ...m,
            cards: (m.cards || []).map((c) =>
              c.id === cardId ? ({ ...c, pending: false, ...patch } as Card) : c
            ),
          }))
        );
        // Persist it too. The payload was stored when the turn was created,
        // with pending:true — without this, reopening the session replayed an
        // already-signed mint as an unsigned order and invited a second mint
        // of the same artwork. Best-effort: the on-screen state is already
        // correct, so a failed write must not surface as an error.
        const sid = sessionIdRef.current || sessionId;
        if (sid) {
          fetch('/api/agent-sessions/', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: sid, cardId, cardPatch: { pending: false, ...patch } }),
          }).catch(() => {});
        }
      };
      try {
        // buy_sage is the pre-multi-token intent; treat it as SAGE.
        const isBuy = intent?.action === 'buy_token' || intent?.action === 'buy_sage';
        const isSell = intent?.action === 'sell_token';
        const isMint = intent?.action === 'mint_edition';
        const isDrop = intent?.action === 'create_drop';
        if (!isBuy && !isSell && !isMint && !isDrop) throw new Error('unsupported order');
        setError('');

        if (isDrop) {
          // A drop deploys onto the APP's configured chain (its auction /
          // open-edition singletons live there), not the trading chain — so
          // this deliberately skips ensureTradeChain and lets deployDrop's own
          // assertSignerOnConfiguredChain be the authority. Everything after
          // the draft rows is the shared pipeline: artist contract, royalty,
          // the game, then approvedAt.
          settle({ status: 'CREATING', byline: 'WRITING THE DROP' });
          // The rows are written HERE, on confirmation — the tool call only
          // described the sale and pinned the art. The endpoint re-derives the
          // artist from the session and re-clamps every number, so what the
          // model put in the intent cannot widen what actually gets built.
          const draftRes = await fetch('/api/agent-drop/', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              format: intent.format,
              name: intent.name,
              description: intent.description,
              imageUri: intent.imageUri,
              tokenUri: intent.tokenUri,
              durationHours: intent.durationHours,
              price: intent.price,
              maxPerUser: intent.maxPerUser,
              royaltyPercent: intent.royaltyPercent,
              symbol: intent.symbol,
            }),
          });
          const draft = await draftRes.json().catch(() => ({}));
          const dropId = Number(draft?.dropId);
          if (!draftRes.ok || !dropId) {
            throw new Error(draft?.error || 'the drop could not be created');
          }
          settle({
            status: 'DEPLOYING',
            byline: 'APPROVE EACH WALLET PROMPT',
          });
          const deployed = await approveAndDeployDrop({
            dropId,
            signer: wallet.signer as any,
          }).unwrap();
          if (!deployed) {
            // approveAndDeployDrop resolves false and raises its own detailed
            // toast. The drop row survives, so a retry from the dashboard
            // needs no re-upload — say that rather than implying it is lost.
            settle({
              status: 'NOT LIVE',
              byline: 'DEPLOY FAILED — DRAFT KEPT',
              rows: [
                { k: 'DROP', v: `#${dropId}` },
                { k: 'STATE', v: 'DRAFT — NOTHING MINTED, NOTHING PUBLIC' },
              ],
            });
            setError('DROP NOT DEPLOYED · SEE THE ERROR TOAST');
            return;
          }
          // The drop becomes a feed post, same as the launcher. Cosmetic: it
          // is already live on the home page, so a failure here must not read
          // as a failed deploy.
          let posted = false;
          try {
            await createDropPost({
              dropId,
              kind: intent.format === 'auction' ? 'auction' : 'openEdition',
            }).unwrap();
            posted = true;
          } catch {
            /* live on-chain either way — share it manually */
          }
          const url = typeof window !== 'undefined' ? `${window.location.origin}/drops/${dropId}/` : '';
          settle({
            status: 'LIVE',
            byline: 'SIGNED BY YOU',
            rows: [
              { k: 'DROP', v: `#${dropId}` },
              { k: 'PAGE', v: url || `/drops/${dropId}/` },
              { k: 'HOME PAGE', v: 'LISTED' },
              { k: 'FEED', v: posted ? 'POSTED' : 'POST FAILED — SHARE MANUALLY' },
            ],
          });
          setTxs((prev) =>
            [
              {
                title: `${intent.format === 'auction' ? 'Auction' : 'Open edition'} "${intent.name}"`,
                venue: 'SAGE DROP PIPELINE · ROBINHOOD CHAIN',
                status: 'CONFIRMED',
                hash: '',
                amount: `DROP #${dropId}`,
                via: 'AGENT',
                when: 'JUST NOW',
              },
            ].concat(prev)
          );
          return;
        }

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
          const { TRADE_NFT_LAUNCHER_ADDRESS } = await import('@/constants/config');
          // Explicitly the MAINNET launcher: `parameters` would resolve the
          // testnet one on a localhost build, and the wallet is on mainnet.
          const { edition, txHash } = await createEdition(
            intent.name,
            intent.symbol,
            intent.tokenUri,
            Number(intent.maxSupply) || 1,
            Number(intent.priceEth) || 0,
            signer,
            TRADE_NFT_LAUNCHER_ADDRESS
          );
          // Record it. The launcher deploys the contract, but the site reads
          // editions from the database — without this the NFT exists on chain
          // and appears nowhere. The server re-verifies the tx and its
          // EditionCreated event before writing, so this cannot invent one.
          let listed = false;
          try {
            const rec = await fetch('/api/social/?action=RecordEditionLaunch', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                editionAddress: edition,
                name: intent.name,
                symbol: intent.symbol,
                imageUrl: intent.imageUrl,
                priceEth: Number(intent.priceEth) || 0,
                maxSupply: Number(intent.maxSupply) || 1,
                launchTxHash: txHash,
              }),
            });
            listed = rec.ok;
          } catch {
            /* on-chain is the source of truth; a failed listing is cosmetic */
          }

          if (intent.claimTweetId) {
            // Close the claim so the same artwork cannot be offered twice.
            fetch('/api/x-claim/', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ tweet: intent.claimTweetId, txHash }),
            }).catch(() => {});
          }

          settle({
            status: 'MINTED',
            byline: 'SIGNED BY YOU',
            rows: [
              { k: 'EDITION', v: edition },
              { k: 'TX', v: txHash },
              { k: 'LISTED', v: listed ? 'ON YOUR PROFILE' : 'ON CHAIN ONLY — RETRY FROM PROFILE' },
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
    [wallet.signer, approveAndDeployDrop, createDropPost]
  );

  /** Start a fresh thread. The current one is already saved. */
  const newSession = useCallback(() => {
    setSessionId('');
    setMsgs([]);
    setError('');
    seq.current = 0;
    loadSessions();
  }, [loadSessions]);

  /** Reopen a stored thread. */
  const openSession = useCallback(async (id: string) => {
    try {
      const r = await fetch(`/api/agent-sessions/?id=${encodeURIComponent(id)}`);
      if (!r.ok) {
        setError('THAT SESSION COULD NOT BE OPENED');
        return;
      }
      const d = await r.json();
      sessionIdRef.current = d.id;
      setSessionId(d.id);
      setError('');
      seq.current = 0;
      setMsgs(
        (d.messages || []).map((m: any) => {
          const id2 = ++seq.current;
          const payload = m.payload || {};
          return {
            id: id2,
            who: m.role === 'user' ? 'YOU' : 'SAGE AGENT',
            isUser: m.role === 'user',
            text: m.text,
            steps: payload.steps || [],
            // Rebind the signing gate to the CURRENT signer. A stored pending
            // card whose buttons did nothing would be worse than none.
            cards: (payload.cards || []).map((c: any) => {
              const cid = ++seq.current;
              return c.kind === 'tx' && c.pending
                ? {
                    ...c,
                    id: cid,
                    confirm: () => confirmIntentRef.current(cid, c.intent),
                    cancel: () => discardIntentRef.current(cid),
                  }
                : { ...c, id: cid };
            }),
          };
        })
      );
      scrollToEnd();
    } catch {
      setError('THAT SESSION COULD NOT BE OPENED');
    }
  }, [scrollToEnd]);

  /** Archive (or restore) a thread — it leaves the rail but is not destroyed. */
  const archiveSession = useCallback(
    async (id: string, archived = true) => {
      try {
        await fetch('/api/agent-sessions/', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id, archived }),
        });
        if (id === sessionId) newSession();
        else loadSessions();
      } catch {
        setError('COULD NOT ARCHIVE THAT SESSION');
      }
    },
    [sessionId, newSession, loadSessions]
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

  /**
   * Start the real link. Ownership is proved by the OAuth round trip, not by
   * typing a handle — the previous version appended a row to React state and
   * granted nothing, while the panel claimed the handle could spend from this
   * wallet.
   */
  const connectX = useCallback(async () => {
    if (!wallet.connected) {
      setError('CONNECT A WALLET FIRST — THE X ACCOUNT LINKS TO IT');
      return;
    }
    // The route needs a SIWE SESSION, not merely a connected wallet — two
    // different states that are easy to conflate. The app-shell auto-prompt
    // fires ONCE per connect (its one-shot ref), so a dismissed or expired
    // signature leaves the wallet connected with no session and no way to
    // re-prompt short of reconnecting. Navigating in that state dead-ended on
    // a bare "Not Authenticated" from the API route, with no way back.
    if (!(await getSession())) {
      setError('SIGN IN WITH YOUR WALLET TO LINK — CHECK YOUR WALLET FOR THE SIGNATURE');
      await handleSignInClick();
      if (!(await getSession())) {
        setError('SIGN-IN DECLINED — LINKING X NEEDS A SIGNED SESSION');
        return;
      }
    }
    setError('');
    window.location.href = '/api/twitter/authorize';
  }, [wallet.connected, handleSignInClick]);

  const unlinkX = useCallback(async () => {
    try {
      await fetch('/api/x-link/', { method: 'DELETE' });
      loadXLink();
    } catch {
      setError('COULD NOT UNLINK — TRY AGAIN');
    }
  }, [loadXLink]);


  const creditsPctNum = Math.max(0, Math.min(100, Math.round((credits / 2500) * 100)));

  const suggestions: Suggestion[] = useMemo(
    () => [
      { num: '01', text: 'What has SAGE dropped so far?' },
      { num: '02', text: "I've never used a wallet. Walk me through minting." },
      {
        num: '03',
        // The one card that SPENDS, so the price is on it. The others cost a
        // turn's tokens; this one commissions a render, and a click whose cost
        // you have to find in the header reads as a trick the second time.
        // Tracks the image-model picker rather than hardcoding a number.
        text: `Make me an original artwork · ${creditsForImage(imageModelId)} CR`,
        // The agent writes the actual prompt — its instructions tell it to
        // expand a request into a full visual description rather than echo it,
        // so this asks for a piece and leaves the subject to it.
        send:
          'Make an original artwork — choose the subject yourself, and surprise me. ' +
          'Then ask whether I want it minted.',
      },
      { num: '04', text: 'What is the SAGE token doing today?' },
    ],
    [imageModelId]
  );

  const threads: Thread[] = useMemo(
    () =>
      sessionList.map((t) => ({
        id: t.id,
        title: t.title,
        when: t.when,
        active: t.id === sessionId,
        select: () => openSession(t.id),
        archive: () => archiveSession(t.id, !showArchived),
      })),
    [sessionList, sessionId, openSession, archiveSession, showArchived]
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
    newSession,
    showArchived,
    toggleArchived: () => setShowArchived((v) => !v),
    sessionsEmpty: sessionList.length === 0,
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
    connectX,
    unlinkX,
    xLink,
    linkDraft,
    setLinkDraft,

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
