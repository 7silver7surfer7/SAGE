/**
 * The agent's view of the real drop catalogue.
 *
 * The page fetches drops server-side with the same getDropsPageData() the
 * /drops listing uses, so the agent and the site can never disagree about
 * what exists. This module flattens a Drop row — which may carry any mix of
 * auctions, open editions, lotteries and collection mints — into the handful
 * of fields a drop card renders.
 *
 * Everything is defensive: a drop can legitimately have no game attached yet,
 * a null price, or an artist with no username, and the agent must degrade to
 * "—" rather than render "undefined" or crash mid-answer.
 */

/** The serialisable shape handed to the client and held by the engine. */
export interface AgentDrop {
  id: number;
  slug: string;
  title: string;
  artist: string;
  status: string;
  price: string;
  editions: string;
  minted: string;
  image: string | null;
}

const DASH = '—';

/** Loose row type — getStaticProps has already JSON-serialised this. */
type AnyDrop = any;

function artistOf(d: AnyDrop): string {
  return (
    d?.artistDisplayName ||
    d?.NftContract?.Artist?.username ||
    (d?.artistAddress ? `${d.artistAddress.slice(0, 6)}…${d.artistAddress.slice(-4)}` : DASH)
  );
}

/**
 * A drop's headline numbers come from whichever game is attached. Open
 * editions carry a real per-mint price and a cached mint count; auctions carry
 * a reserve; lotteries and collections carry neither in a directly comparable
 * form, so they report what they can.
 */
function gameFacts(d: AnyDrop): { status: string; price: string; editions: string; minted: string } {
  const oe = d?.OpenEditions?.[0];
  const auction = d?.Auctions?.[0];
  const lottery = d?.Lotteries?.[0];
  const collection = d?.CollectionMints?.[0];
  const currency = d?.currency === 'ETH' ? 'ETH' : 'SAGE';

  if (oe) {
    const closed = oe.endTime && new Date(oe.endTime).getTime() < Date.now();
    return {
      status: closed ? 'CLOSED · OPEN EDITION' : 'LIVE · OPEN EDITION',
      price: oe.costTokens > 0 ? `${oe.costTokens} ${currency}` : 'FREE',
      editions: oe.maxSupply ? String(oe.maxSupply) : 'OPEN',
      minted: oe.mintCount != null ? String(oe.mintCount) : DASH,
    };
  }
  if (auction) {
    return {
      status: auction.settled ? 'SETTLED · AUCTION' : 'LIVE · AUCTION',
      price: auction.minimumPrice ? `${auction.minimumPrice} ${currency} RESERVE` : DASH,
      editions: '1 OF 1',
      minted: auction.settled ? '1' : '0',
    };
  }
  if (collection) {
    return {
      status: 'COLLECTION',
      price: collection.costTokens > 0 ? `${collection.costTokens} ${currency}` : 'FREE',
      editions: collection.maxSupply ? String(collection.maxSupply) : DASH,
      minted: collection.mintCount != null ? String(collection.mintCount) : DASH,
    };
  }
  if (lottery) {
    return { status: 'DRAWING', price: DASH, editions: DASH, minted: DASH };
  }
  return { status: 'ANNOUNCED', price: DASH, editions: DASH, minted: DASH };
}

export function toAgentDrops(drops: AnyDrop[]): AgentDrop[] {
  if (!Array.isArray(drops)) return [];
  return drops.map((d) => ({
    id: d.id,
    // the agent matches user text against this, so keep it simple and lowercase
    slug: String(d.name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, ''),
    title: d.name || 'Untitled drop',
    artist: artistOf(d),
    image: d.bannerImageS3Path || null,
    ...gameFacts(d),
  }));
}

/** Find the drop a user's message is most likely referring to. */
export function matchDrop(drops: AgentDrop[], text: string): AgentDrop | null {
  const q = text.toLowerCase();
  return (
    drops.find((d) => d.slug && q.includes(d.slug)) ||
    drops.find((d) => d.title && q.includes(d.title.toLowerCase())) ||
    null
  );
}
