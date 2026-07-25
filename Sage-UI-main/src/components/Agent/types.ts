/**
 * SAGE Agent — shared types, ported from the "SAGE Agent.dc.html" design.
 *
 * The design models an assistant turn as: optional tool-call steps, optional
 * prose, then zero or more RESULT CARDS. A card is a discriminated union on
 * `kind` — the design expressed the same thing as sibling `c.isDrop` /
 * `c.isArtist` / … booleans, which is the untyped form of this union.
 */

export type CardKind =
  | 'drop'
  | 'artist'
  | 'stats'
  | 'tx'
  | 'tweet'
  | 'listings'
  | 'credits'
  | 'wallet';

/** Key/value row used by the stats, tx, credits and wallet cards. */
export interface KV {
  k: string;
  v: string;
}

/** A purchasable row in the listings card. */
export interface ListRow {
  /** edition label, e.g. "#128" */
  k: string;
  /** seller · venue · chain */
  sub: string;
  /** price, e.g. "0.14 ETH" */
  v: string;
  buy?: () => void;
}

interface CardBase {
  id: number;
  kind: CardKind;
  /** the accent pill / eyebrow label */
  status?: string;
  /** secondary line beside or under the title */
  byline?: string;
  title?: string;
  body?: string;
}

export interface DropCard extends CardBase {
  kind: 'drop';
  chain?: string;
  price?: string;
  editions?: string;
  minted?: string;
  imgId?: string;
  imgHint?: string;
  /** real artwork when we have it; falls back to imgHint */
  imgUrl?: string | null;
}

export interface ArtistCard extends CardBase {
  kind: 'artist';
  imgId?: string;
  imgHint?: string;
  imgUrl?: string | null;
  rows?: KV[];
}

export interface StatsCard extends CardBase {
  kind: 'stats';
  rows: KV[];
}

export interface TxCard extends CardBase {
  kind: 'tx';
  rows: KV[];
  /** when true the card shows confirm/discard — the human signing gate */
  pending?: boolean;
  cta?: string;
  confirm?: () => void;
  cancel?: () => void;
}

export interface TweetCard extends CardBase {
  kind: 'tweet';
  handle?: string;
  tweetBody?: string;
}

export interface ListingsCard extends CardBase {
  kind: 'listings';
  listRows: ListRow[];
}

export interface CreditsCard extends CardBase {
  kind: 'credits';
  rows: KV[];
}

export interface WalletCard extends CardBase {
  kind: 'wallet';
  rows: KV[];
  /** renders the connect button inside the card */
  needsConnect?: boolean;
}

export type Card =
  | DropCard
  | ArtistCard
  | StatsCard
  | TxCard
  | TweetCard
  | ListingsCard
  | CreditsCard
  | WalletCard;

/** One tool-call line in the "steps" box above an assistant answer. */
export interface Step {
  mark: string;
  label: string;
}

export interface Message {
  id: number;
  who: 'YOU' | 'SAGE AGENT';
  isUser: boolean;
  text: string;
  steps?: string[];
  cards?: Card[];
  thinking?: boolean;
  /** credit cost footer shown under a completed assistant turn */
  costLabel?: string;
  balanceLabel?: string;
}

export interface ModelOption {
  id: string;
  label: string;
  /** credit multiplier per turn */
  rate: number;
  note: string;
}

export interface Thread {
  title: string;
  when: string;
  select: () => void;
}

export interface Suggestion {
  num: string;
  text: string;
}

/** A wallet an X account is authorized to spend from, with its caps. */
export interface BotLink {
  handle: string;
  wallet: string;
  /** per-tweet ceiling in ETH */
  perTweet: number;
  /** rolling daily ceiling in ETH */
  daily: number;
  spent: number;
  scopes: string;
}

export interface TxRecord {
  title: string;
  venue: string;
  status: string;
  hash: string;
  amount: string;
  via: string;
  when: string;
}

export interface Holding {
  name: string;
  venue: string;
  chain: string;
  cost: number;
  when: string;
}

/** Credit bundle offered in the top-up modal. */
export interface Tier {
  id: string;
  title: string;
  credits: number;
  bonus?: string;
  cost: string;
  note?: string;
}
