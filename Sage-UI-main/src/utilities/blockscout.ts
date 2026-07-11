/**
 * Server-side client for Robinhood Chain's Blockscout explorer (v2 API).
 *
 * This is the marketplace's NFT index: Blockscout already indexes every
 * ERC-721/1155 on the chain, so we don't run our own indexer. We proxy its
 * API through our own routes (keeps rate-limiting server-side, lets us cache,
 * and normalizes the payload the UI consumes). Defaults to MAINNET, where the
 * real NFTs live; overridable via env for testnet.
 */

const BASE = (
  process.env.BLOCKSCOUT_API_BASE || 'https://robinhoodchain.blockscout.com/api/v2'
).replace(/\/$/, '');

// In-memory cache. Collections/instances change slowly, and Blockscout is slow
// (~3-6s) and flaky, so we cache aggressively and serve STALE-WHILE-REVALIDATE:
// once a value is cached, every later request returns instantly and any needed
// refresh happens in the background. Only the very first cold fetch waits.
const CACHE_TTL_MS = 5 * 60_000; // "fresh" window
const STALE_TTL_MS = 60 * 60_000; // still serve (and bg-refresh) up to this age
const cache = new Map<string, { at: number; data: any }>();
const refreshing = new Set<string>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const REQUEST_TIMEOUT_MS = 7000;

// Fetch fresh from Blockscout (with the retry/backoff/timeout loop) and cache.
async function fetchAndCache(url: string, retries: number): Promise<any> {
  let lastErr: any;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const h = cache.get(url); // a concurrent fetch may have warmed it
    if (h && Date.now() - h.at < CACHE_TTL_MS) return h.data;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' }, signal: ac.signal });
      if (!res.ok) throw new Error(`blockscout ${res.status}`);
      const data = await res.json();
      if (data && typeof data === 'object') {
        cache.set(url, { at: Date.now(), data });
        return data;
      }
      throw new Error('blockscout non-JSON response');
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await sleep(300 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  const stale = cache.get(url);
  if (stale) return stale.data; // serve stale through an outage
  throw new Error(`blockscout ${url} failed: ${lastErr?.message || lastErr}`);
}

async function get(path: string, retries = 5): Promise<any> {
  const url = `${BASE}${path}`;
  const hit = cache.get(url);
  const age = hit ? Date.now() - hit.at : Infinity;
  if (hit && age < CACHE_TTL_MS) return hit.data; // fresh — instant
  if (hit && age < STALE_TTL_MS) {
    // stale but usable: return it NOW, refresh in the background (deduped) so
    // the next visitor gets fresh data without this one ever waiting
    if (!refreshing.has(url)) {
      refreshing.add(url);
      fetchAndCache(url, retries)
        .catch(() => {})
        .finally(() => refreshing.delete(url));
    }
    return hit.data;
  }
  return fetchAndCache(url, retries); // cold: must wait once
}

export interface NftCollection {
  address: string;
  name: string | null;
  symbol: string | null;
  type: string; // ERC-721 | ERC-1155
  totalSupply: string | null;
  holdersCount: string | null;
  iconUrl: string | null;
  reputation: string | null; // Blockscout's own flag: 'ok' | 'neutral' | 'scam' | ...
  previewImage?: string | null; // folded in by listCollectionsEnriched
}

/**
 * Spam detection for open-chain collections, tuned against the real chain
 * data (see the analysis that seeded these thresholds). Robinhood Chain is
 * flooded with airdrop-phishing "collections" that mint junk to tens of
 * thousands of wallets with a claim/phishing URL as the payload.
 *
 * LAYER 1 (this function — cheap, metadata-free, runs during listing):
 *  - reputation flag from Blockscout
 *  - name/symbol patterns: URLs, TLDs, claim/airdrop/gift keywords, alert emojis
 *  - HOLDER SCALE: legit art collections here top out ~6k holders; every
 *    airdrop scam sits far above that. A high holder count is the single
 *    strongest cheap signal (and it's exactly what naive holder-sorting was
 *    surfacing first).
 *  - utility/non-art NFTs (Uniswap LP positions, ENS-like) — real, but not
 *    marketplace art.
 * LAYER 2 (spamFromMetadata, below — needs one instance fetch): catches
 *  clean-named scams whose payload is only in the token metadata's URL.
 */

// Above this holder count a "collection" is an airdrop, not art. Legit
// collections observed here max ~6k; scams start ~12k. 10k leaves headroom.
const AIRDROP_HOLDER_CEILING = 10000;

const SPAM_TEXT_PATTERNS = [
  /https?:\/\//i,
  /\bwww\./i,
  /\.(com|io|xyz|net|org|app|fi|vip|fun|dev|site|top|live|click|link)\b/i,
  /\b(airdrop|claim|reward|voucher|giveaway|gift|free|bonus|winner|visit|redeem|whitelist|presale|official|access|mint\s*now|verify)\b/i,
  /[🚨🎁🎉✅💰🔥🪂👉🎈➡️]/u,
];
// Real but non-art NFTs that shouldn't appear in an art marketplace.
const UTILITY_PATTERNS = [/uniswap/i, /\bv3\b.*position/i, /\bLP\b/, /\.eth\b/i, /domain/i];

export function isLikelySpam(c: NftCollection): boolean {
  const rep = (c.reputation || '').toLowerCase();
  if (rep === 'scam' || rep === 'spam') return true;
  const holders = Number(c.holdersCount);
  if (Number.isFinite(holders) && holders > AIRDROP_HOLDER_CEILING) return true;
  const text = `${c.name || ''} ${c.symbol || ''}`;
  if (SPAM_TEXT_PATTERNS.some((re) => re.test(text))) return true;
  if (UTILITY_PATTERNS.some((re) => re.test(text))) return true;
  return false;
}

/**
 * LAYER 2: verdict from a token's metadata. The decisive tell for airdrop
 * scams with innocuous names ("ZERO", "Gopunks") is a URL in the metadata —
 * external_url / description / trait values point at a claim or phishing site.
 * Legit PFP collections carry no external URL. Returns true if the metadata
 * looks like spam.
 */
export function spamFromMetadata(meta: any): boolean {
  if (!meta) return false;
  const parts = [
    meta.name,
    meta.description,
    meta.external_url,
    ...(Array.isArray(meta.attributes)
      ? meta.attributes.map((a: any) => `${a?.trait_type} ${a?.value}`)
      : []),
  ]
    .filter(Boolean)
    .join(' ');
  return SPAM_TEXT_PATTERNS.some((re) => re.test(parts));
}

export interface NftItem {
  contractAddress: string;
  tokenId: string;
  name: string | null;
  imageUrl: string | null; // still image / thumbnail
  animationUrl: string | null; // video/animated, when present
  mediaType: string | null; // 'image' | 'video' | ...
  owner: string | null;
  collectionName: string | null;
}

export interface NftTrait {
  traitType: string;
  value: string;
}

// Full detail for one token — the item page's data source (OpenSea "asset").
export interface NftItemDetail extends NftItem {
  description: string | null;
  externalUrl: string | null;
  tokenStandard: string; // ERC-721 | ERC-1155
  traits: NftTrait[];
}

// One row of an NFT's on-chain history (the item/collection activity feed).
export interface NftActivity {
  type: string; // 'mint' | 'transfer' | 'sale' | ...
  method: string | null;
  from: string | null;
  to: string | null;
  tokenId: string | null;
  timestamp: string | null;
  txHash: string;
}

// Blockscout paginates with an opaque `next_page_params` object echoed back as
// query params. We pass it through as an encoded token so the client stays
// agnostic to its shape.
function encodeCursor(params: any): string | null {
  return params ? Buffer.from(JSON.stringify(params)).toString('base64url') : null;
}
function decodeCursor(cursor?: string | null): Record<string, string> {
  if (!cursor) return {};
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}
function toQuery(params: Record<string, string>): string {
  const q = new URLSearchParams(params).toString();
  return q ? `&${q}` : '';
}

function mapCollection(t: any): NftCollection {
  return {
    address: t.address_hash || t.address,
    name: t.name ?? null,
    symbol: t.symbol ?? null,
    type: t.type,
    totalSupply: t.total_supply ?? null,
    holdersCount: t.holders_count ?? null,
    iconUrl: t.icon_url ?? null,
    reputation: t.reputation ?? null,
  };
}

function mapInstance(i: any, fallbackName?: string | null): NftItem {
  const meta = i.metadata || {};
  return {
    contractAddress: i.token?.address_hash || i.token?.address || '',
    tokenId: String(i.id ?? ''),
    name: meta.name ?? (i.token?.name ? `${i.token.name} #${i.id}` : `#${i.id}`),
    imageUrl: i.image_url || meta.image || meta.image_url || null,
    animationUrl: i.animation_url || meta.animation_url || null,
    mediaType: i.media_type ?? null,
    owner: i.owner?.hash ?? null,
    collectionName: i.token?.name ?? fallbackName ?? null,
  };
}

/**
 * List NFT collections on the chain (ERC-721 + ERC-1155), paginated. Spam is
 * dropped server-side (see isLikelySpam) and each page is sorted by holder
 * count desc — the more-holders-first, activity-driven ordering. Full-list
 * ordering is finalized client-side across accumulated pages.
 */
export async function listCollections(cursor?: string | null): Promise<{
  items: NftCollection[];
  nextCursor: string | null;
}> {
  const data = await get(`/tokens?type=ERC-721%2CERC-1155${toQuery(decodeCursor(cursor))}`);
  const items = (data.items || [])
    .map(mapCollection)
    .filter((c: NftCollection) => !isLikelySpam(c))
    .sort((a: NftCollection, b: NftCollection) => Number(b.holdersCount) - Number(a.holdersCount));
  return {
    items,
    nextCursor: encodeCursor(data.next_page_params),
  };
}

// Run an async mapper over items with a bounded number of in-flight calls.
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Collections WITH their preview image + Layer-2 spam verdict folded in, in a
 * single response. This replaces the client's old pattern of ListCollections +
 * one preview fetch per card (~46 round-trips to a slow index → ~1). The
 * previews are fetched server-side with bounded concurrency and everything
 * rides the same cache, so after the first warm-up this is effectively instant.
 */
export async function listCollectionsEnriched(cursor?: string | null): Promise<{
  items: NftCollection[];
  nextCursor: string | null;
}> {
  const page = await listCollections(cursor); // Layer-1 filtered + holder-sorted
  const enriched = await mapLimit(page.items, 8, async (c) => {
    const preview = await getCollectionPreview(c.address);
    return { ...c, previewImage: preview.imageUrl, spam: preview.isSpam };
  });
  return {
    items: enriched.filter((c) => !c.spam).map(({ spam, ...c }) => c), // drop Layer-2 spam
    nextCursor: page.nextCursor,
  };
}

/** Metadata for a single collection. */
export async function getCollection(address: string): Promise<NftCollection> {
  return mapCollection(await get(`/tokens/${address}`));
}

/** NFT instances within a collection, paginated. */
export async function listCollectionItems(
  address: string,
  cursor?: string | null
): Promise<{ items: NftItem[]; nextCursor: string | null }> {
  const data = await get(`/tokens/${address}/instances${toQuery(decodeCursor(cursor))}`);
  return {
    items: (data.items || []).map((i: any) => mapInstance(i)),
    nextCursor: encodeCursor(data.next_page_params),
  };
}

/**
 * A representative thumbnail for a collection: the image of its first token
 * instance. Blockscout's token list has no collection icon on this chain
 * (icon_url is always null), so the marketplace grid uses this instead —
 * lazy-loaded per card, OpenSea-style. Cached like every other call.
 */
export async function getCollectionPreview(
  address: string
): Promise<{ imageUrl: string | null; isSpam: boolean }> {
  try {
    const data = await get(`/tokens/${address}/instances`);
    const first = (data.items || [])[0];
    const meta = first?.metadata || {};
    return {
      imageUrl: first?.image_url || meta.image || meta.image_url || null,
      // Layer 2 spam verdict from the sample token's metadata (see
      // spamFromMetadata) — catches clean-named scams the listing filter can't.
      isSpam: spamFromMetadata(meta),
    };
  } catch {
    return { imageUrl: null, isSpam: false };
  }
}

/** Full detail for a single token — the item page. */
export async function getItem(address: string, tokenId: string): Promise<NftItemDetail> {
  const i = await get(`/tokens/${address}/instances/${tokenId}`);
  const meta = i.metadata || {};
  const base = mapInstance(i);
  const rawTraits = Array.isArray(meta.attributes) ? meta.attributes : [];
  const traits: NftTrait[] = rawTraits
    .filter((a: any) => a && (a.trait_type || a.value != null))
    .map((a: any) => ({
      traitType: String(a.trait_type ?? 'Property'),
      value: String(a.value ?? ''),
    }));
  return {
    ...base,
    description: meta.description ?? null,
    externalUrl: meta.external_url ?? i.external_app_url ?? null,
    tokenStandard: i.token?.type || 'ERC-721',
    traits,
  };
}

/** On-chain activity for one token (its transfer/mint/sale history). */
export async function listItemActivity(
  address: string,
  tokenId: string,
  cursor?: string | null
): Promise<{ items: NftActivity[]; nextCursor: string | null }> {
  const data = await get(
    `/tokens/${address}/instances/${tokenId}/transfers${toQuery(decodeCursor(cursor))}`
  );
  return {
    items: (data.items || []).map(mapActivity),
    nextCursor: encodeCursor(data.next_page_params),
  };
}

/** On-chain activity across a whole collection. */
export async function listCollectionActivity(
  address: string,
  cursor?: string | null
): Promise<{ items: NftActivity[]; nextCursor: string | null }> {
  const data = await get(`/tokens/${address}/transfers${toQuery(decodeCursor(cursor))}`);
  return {
    items: (data.items || []).map(mapActivity),
    nextCursor: encodeCursor(data.next_page_params),
  };
}

function mapActivity(t: any): NftActivity {
  const from = t.from?.hash ?? null;
  const zero = '0x0000000000000000000000000000000000000000';
  return {
    type: from === zero ? 'mint' : t.type || 'transfer',
    method: t.method ?? null,
    from,
    to: t.to?.hash ?? null,
    tokenId: t.total?.token_id ?? t.token_id ?? null,
    timestamp: t.timestamp ?? null,
    txHash: t.transaction_hash || t.tx_hash || '',
  };
}

/** NFTs held by a wallet (used for "your NFTs" / the future sell flow). */
export async function listWalletNfts(
  address: string,
  cursor?: string | null
): Promise<{ items: NftItem[]; nextCursor: string | null }> {
  const data = await get(
    `/addresses/${address}/nft?type=ERC-721%2CERC-1155${toQuery(decodeCursor(cursor))}`
  );
  return {
    items: (data.items || []).map((i: any) => mapInstance(i)),
    nextCursor: encodeCursor(data.next_page_params),
  };
}
