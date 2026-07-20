import { baseApi } from './baseReducer';

export interface DexCreator {
  address: string;
  username: string | null;
  verified: boolean;
}

export interface DexRow {
  tokenAddress: string;
  name: string;
  symbol: string;
  imageUrl: string | null;
  creator: DexCreator;
  /** launch time — drives the AGE column */
  createdAt: string;
  graduated: boolean;
  /** ETH per 1M tokens (existing app convention) */
  priceEth: number;
  /** USD per SINGLE token */
  priceUsd: number;
  /** priceEth/1e6 * 1e9 supply * ethUsd */
  mcapUsd: number;
  /** curve: realEthReserves*2*ethUsd; graduated: pair WETH reserve*2*ethUsd; 0 if unreadable */
  liquidityUsd: number;
  /** percent vs window-open price, null if no trades in window */
  change5m: number | null;
  change1h: number | null;
  change24h: number | null;
  txns24h: { buys: number; sells: number };
  volume24hUsd: number;
  /** server score: volume24hUsd + 5*txn count + recency boost (launched <24h: *1.5) */
  trending: number;
  /** 24 price points (priceEth), oldest->newest, gaps forward-filled, [] if no trades */
  spark: number[];
}

export interface DexScreenerResponse {
  ethUsd: number;
  updatedAt: string;
  rows: DexRow[];
}

const dexApi = baseApi.injectEndpoints({
  overrideExisting: true,
  endpoints: (builder) => ({
    getDexScreener: builder.query<DexScreenerResponse, void>({
      query: () => ({ url: 'dex?action=Screener' }),
    }),
  }),
});

export const { useGetDexScreenerQuery } = dexApi;
