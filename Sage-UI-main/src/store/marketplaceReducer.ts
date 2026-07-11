import { baseApi } from './baseReducer';

// Mirrors the server-normalized shapes in utilities/blockscout.ts. Kept as
// plain client types so the server util (which uses Buffer/fetch) isn't pulled
// into the browser bundle.
export interface NftCollection {
  address: string;
  name: string | null;
  symbol: string | null;
  type: string;
  totalSupply: string | null;
  holdersCount: string | null;
  iconUrl: string | null;
  reputation?: string | null;
  previewImage?: string | null; // folded in by the enriched list (no per-card fetch)
}

export interface NftItem {
  contractAddress: string;
  tokenId: string;
  name: string | null;
  imageUrl: string | null;
  animationUrl: string | null;
  mediaType: string | null;
  owner: string | null;
  collectionName: string | null;
  /** set when this NFT has an active sell listing (Phase 2). null = not listed. */
  listing?: { priceEth: string } | null;
}

export interface NftTrait {
  traitType: string;
  value: string;
}

export interface NftItemDetail extends NftItem {
  description: string | null;
  externalUrl: string | null;
  tokenStandard: string;
  traits: NftTrait[];
}

export interface NftActivity {
  type: string;
  method: string | null;
  from: string | null;
  to: string | null;
  tokenId: string | null;
  timestamp: string | null;
  txHash: string;
}

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

const marketplaceApi = baseApi.injectEndpoints({
  overrideExisting: true,
  endpoints: (builder) => ({
    getMarketplaceCollections: builder.query<Page<NftCollection>, string | undefined>({
      query: (cursor) =>
        `marketplace?action=ListCollections${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    }),
    // collections + preview image + spam verdict in ONE request (vs list + a
    // preview fetch per card) — the fast path the marketplace home uses
    getMarketplaceCollectionsEnriched: builder.query<Page<NftCollection>, string | undefined>({
      query: (cursor) =>
        `marketplace?action=ListCollectionsEnriched${
          cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
        }`,
    }),
    getMarketplaceCollection: builder.query<NftCollection, string>({
      query: (address) => `marketplace?action=GetCollection&address=${address}`,
    }),
    getCollectionPreview: builder.query<{ imageUrl: string | null; isSpam: boolean }, string>({
      query: (address) => `marketplace?action=GetCollectionPreview&address=${address}`,
    }),
    getMarketplaceCollectionItems: builder.query<
      Page<NftItem>,
      { address: string; cursor?: string }
    >({
      query: ({ address, cursor }) =>
        `marketplace?action=ListItems&address=${address}${
          cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
        }`,
    }),
    getWalletNfts: builder.query<Page<NftItem>, { address: string; cursor?: string }>({
      query: ({ address, cursor }) =>
        `marketplace?action=ListWalletNfts&address=${address}${
          cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
        }`,
    }),
    getMarketplaceItem: builder.query<NftItemDetail, { address: string; tokenId: string }>({
      query: ({ address, tokenId }) =>
        `marketplace?action=GetItem&address=${address}&tokenId=${tokenId}`,
    }),
    getItemActivity: builder.query<Page<NftActivity>, { address: string; tokenId: string; cursor?: string }>({
      query: ({ address, tokenId, cursor }) =>
        `marketplace?action=ListItemActivity&address=${address}&tokenId=${tokenId}${
          cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
        }`,
    }),
    getCollectionActivity: builder.query<Page<NftActivity>, { address: string; cursor?: string }>({
      query: ({ address, cursor }) =>
        `marketplace?action=ListCollectionActivity&address=${address}${
          cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
        }`,
    }),
  }),
});

export const {
  useGetMarketplaceCollectionsQuery,
  useGetMarketplaceCollectionsEnrichedQuery,
  useGetMarketplaceCollectionQuery,
  useGetCollectionPreviewQuery,
  useGetMarketplaceCollectionItemsQuery,
  useGetWalletNftsQuery,
  useGetMarketplaceItemQuery,
  useGetItemActivityQuery,
  useGetCollectionActivityQuery,
} = marketplaceApi;
