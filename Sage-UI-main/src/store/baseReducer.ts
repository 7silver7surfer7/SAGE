import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';

export const baseApi = createApi({
  baseQuery: fetchBaseQuery({ baseUrl: '/api' }),
  tagTypes: [
    'AllUsers',
    'ArtistBalance',
    'ArtistNftContract',
    'Auction',
    'AuctionState',
    'Config',
    'DropAllowlist',
    'EscrowPoints',
    'Following',
    'Nfts',
    'OpenEditionMintCount',
    'PendingDrops',
    'PlatformRoyaltyAddress',
    'PrimaryPlatformCut',
    'Prizes',
    'Refunds',
    'TicketCount',
    'User',
    'UserPoints',
    'Wallet',
  ],
  endpoints: () => ({}),
});
