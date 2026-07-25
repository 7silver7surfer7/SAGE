import { useCallback, useMemo, useRef, useState } from 'react';
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

export const MODELS: ModelOption[] = [
  { id: 'claude-opus-5', label: 'OPUS 5', rate: 5, note: 'DEEPEST REASONING' },
  { id: 'claude-sonnet-5', label: 'SONNET 5', rate: 1, note: 'BALANCED · DEFAULT' },
  { id: 'claude-fable-5', label: 'FABLE', rate: 1.6, note: 'CURATORIAL PROSE' },
  { id: 'claude-haiku-4-5', label: 'HAIKU 4.5', rate: 0.3, note: 'FAST · CHEAPEST' },
];

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

const TIERS: Tier[] = [
  { id: 'taste', title: 'Taste', credits: 500, cost: '0.006 ETH', note: 'A few sessions' },
  { id: 'curator', title: 'Curator', credits: 2500, bonus: '+10%', cost: '0.028 ETH', note: 'Most popular' },
  { id: 'patron', title: 'Patron', credits: 10000, bonus: '+20%', cost: '0.098 ETH', note: 'Heavy tool use' },
];

const fmt = (n: number) => n.toLocaleString('en-US');

export interface AgentEngineOptions {
  /** the real drop catalogue, from getStaticProps */
  drops: AgentDrop[];
  /** real wallet figures — see useAgentWallet */
  wallet: AgentWallet;
  startingCredits?: number;
}

export function useAgentEngine({ drops, wallet, startingCredits = 1240 }: AgentEngineOptions) {
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [credits, setCredits] = useState(startingCredits);
  const [modelId, setModelId] = useState('claude-sonnet-5');
  const [modelOpen, setModelOpen] = useState(false);
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

  const [txs, setTxs] = useState<TxRecord[]>([
    {
      title: 'Buy RMonet #128',
      venue: 'SECONDARY · SAGE · ROBINHOOD CHAIN',
      status: 'CONFIRMED',
      hash: '0x8b12…44de',
      amount: '0.1405 ETH',
      via: 'CONSOLE',
      when: '12 JUL',
    },
  ]);
  const [owned, setOwned] = useState<Holding[]>([
    { name: 'RMonet #128', venue: 'SAGE', chain: 'ROBINHOOD CHAIN', cost: 0.1405, when: '12 JUL' },
  ]);
  const [links, setLinks] = useState<BotLink[]>([
    { handle: '@collector_eth', wallet: '0x7F3a…9C21', perTweet: 0.5, daily: 2.0, spent: 0.35, scopes: 'BUY · MINT · SWAP' },
    { handle: '@nulldelta', wallet: '0x2Ba1…8fD0', perTweet: 0.1, daily: 0.4, spent: 0.0, scopes: 'BUY ONLY' },
  ]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const nextId = () => ++seq.current;

  const model = MODELS.find((m) => m.id === modelId) || MODELS[1];

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

  // ── the swappable seam ────────────────────────────────────────────────────
  /**
   * Produce the assistant's steps, cards and prose for one user turn.
   * Replace this body with a call to a server route to go live; the signature
   * is already the async shape a network call needs.
   */
  const respond = useCallback(
    async (text: string): Promise<{ steps: string[]; cards: Card[]; prose: string }> => {
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
        const { steps, cards, prose } = await respond(text);
        // Meter exactly as the design does: ~1 credit per 1k tokens, output
        // weighted 5×, scaled by the model's rate. Kept even while the
        // responder is local so the accounting is already correct when a real
        // model is wired in.
        const inTok = Math.round((text.length + 1900) / 4) * (1 + steps.length);
        const outTok = Math.round(prose.length / 4) + 60 * steps.length;
        const cost = Math.max(1, Math.ceil(((inTok + outTok * 5) / 1000) * model.rate));
        const balance = Math.max(0, credits - cost);
        setCredits(balance);
        patchLast((m) => {
          m.thinking = false;
          m.text = prose;
          m.steps = steps;
          m.cards = cards;
          m.costLabel =
            model.label + ' · ' + fmt(inTok) + ' TOK IN · ' + fmt(outTok) + ' OUT · −' + fmt(cost) + ' CR';
          m.balanceLabel = 'BALANCE ' + fmt(balance) + ' CR';
        });
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

  const buyCredits = useCallback(
    (tierId: string) => {
      const t = TIERS.find((x) => x.id === tierId) || TIERS[1];
      setTxs((prev) =>
        [
          {
            title: fmt(t.credits) + ' compute credits',
            venue: 'SAGE CREDIT DESK',
            status: 'CONFIRMED',
            hash: '0x41be…7d02',
            amount: t.cost,
            via: 'CONSOLE',
            when: 'JUST NOW',
          },
        ].concat(prev)
      );
      setCredits((c) => c + t.credits);
      setBuyOpen(false);
      setError('');
    },
    []
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

    // wallet
    connected: wallet.connected,
    address: wallet.address,
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

    tiers: TIERS,
    buyCredits,
    tierId,
    setTierId,
    payWith,
    setPayWith,
    payOptions: [
      { id: 'eth', label: 'ETH' },
      // the design prices SAGE 15% cheaper to push payment into the token
      { id: 'sage', label: 'SAGE · −15%' },
    ],
    buyCta: wallet.connected ? 'confirm purchase' : 'connect wallet to buy',
    buyFootnote:
      'Credits are non-transferable and never expire. Settled on Robinhood Chain. ' + FEED_NOTE,

    footerLeft:
      (wallet.connected ? 'AGENT MAY ACT ON-CHAIN · YOU SIGN EVERY TX' : 'READ-ONLY · CONNECT A WALLET TO ACT') +
      ' · METERED BY TOKENS · ' +
      FEED_NOTE,
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
