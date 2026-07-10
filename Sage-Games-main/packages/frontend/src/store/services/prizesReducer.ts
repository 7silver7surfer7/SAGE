import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { Prisma } from '@prisma/client';
import { toast } from 'react-toastify';
import { extractErrorMessage, getLotteryContract } from '../../utilities/contracts';
import { playErrorSound, playPrizeClaimedSound } from '../../utilities/sounds';
import { GamePrize } from '@/prisma/types';

export type PrizeWithNftAndArtist = Prisma.PrizeProofGetPayload<{
  include: {
    Nft: {
      include: {
        Lottery: {
          include: {
            Drop: {
              include: {
                Artist: true;
              };
            };
          };
        };
      };
    };
  };
}>;

export interface ClaimPrizeRequest {
  lotteryId: number;
  nftId: number;
  ticketNumber: number;
  proof: string;
  walletAddress: string;
}

export const prizesApi = createApi({
  reducerPath: 'prizesApi',
  baseQuery: fetchBaseQuery({ baseUrl: '/api' }),
  refetchOnMountOrArgChange: 60,
  tagTypes: ['Prizes'],
  endpoints: (builder) => ({
    isLotteryDrawn: builder.query<boolean, number>({
      query: (lotteryId: number) => `prizes?action=IsLotteryDrawn&lotteryId=${lotteryId}`,
    }),
    getPrizesByUser: builder.query<GamePrize[], string>({
      query: (walletAddress: string) =>
        `prizes?action=GetPrizesByUser&walletAddress=${walletAddress}`,
      providesTags: ['Prizes'],
    }),
    getUnclaimedPrizesByUser: builder.query<GamePrize[], string>({
      query: (walletAddress: string) =>
        `prizes?action=GetUnclaimedPrizesByUser&walletAddress=${walletAddress}`,
      providesTags: ['Prizes'],
    }),
    getPrizesByUserAndLottery: builder.query<
      GamePrize[],
      { walletAddress: string; lotteryId: number }
    >({
      query: ({ walletAddress, lotteryId }) =>
        `prizes?action=GetPrizesByUserAndLottery&lotteryId=${lotteryId}&walletAddress=${walletAddress}`,
      providesTags: ['Prizes'],
    }),
    claimLotteryPrize: builder.mutation<Date, ClaimPrizeRequest>({
      queryFn: async (
        { lotteryId, nftId, ticketNumber, proof, walletAddress },
        {},
        _extraOptions,
        _fetchWithBQ
      ) => {
        try {
          const contract = await getLotteryContract();
          var tx = await contract.claimPrize(
            lotteryId,
            walletAddress,
            nftId,
            ticketNumber,
            toByteArray(proof)
          );
          toast.promise(tx.wait(), {
            pending: 'Request submitted to the blockchain, awaiting confirmation...',
            success: 'Success! NFT claimed and moved to your collection!',
            error: 'Failure! Unable to complete request.',
          });
          await tx.wait();
          var claimedAt = await updateDbPrizeClaimedDate(
            _fetchWithBQ,
            lotteryId,
            walletAddress,
            nftId,
            ticketNumber
          );
        } catch (e) {
          console.log(e);
          const errMsg = extractErrorMessage(e);
          if (errMsg == 'Participant already claimed prize') {
            // database is out-of-sync with contract, update claimedAt field
            var claimedAt = await updateDbPrizeClaimedDate(
              _fetchWithBQ,
              lotteryId,
              walletAddress,
              nftId,
              ticketNumber
            );
          } else {
            toast.error(`Failure! ${errMsg}`);
            playErrorSound();
            return { error: { status: 500, data: null } };
          }
        }
        playPrizeClaimedSound();
        return { data: claimedAt };
      },
      invalidatesTags: ['Prizes'],
    }),
  }),
});

async function updateDbPrizeClaimedDate(
  fetchWithBQ: any,
  lotteryId: number,
  winnerAddress: string,
  nftId: number,
  ticketNumber: number
): Promise<Date> {
  const { data } = await fetchWithBQ({
    url: `prizes?action=UpdatePrizeClaimedDate&lotteryId=${lotteryId}`,
    method: 'POST',
    body: { winnerAddress, nftId, ticketNumber },
  });
  return (data as any).claimedAt as Date;
}

function toByteArray(proof: string) {
  if (proof == null || proof == '') {
    return [];
  }
  return proof.indexOf(',') > 0 ? proof.split(',') : [proof];
}

export const {
  useGetPrizesByUserQuery,
  useGetUnclaimedPrizesByUserQuery,
  useGetPrizesByUserAndLotteryQuery,
  useClaimLotteryPrizeMutation,
  useIsLotteryDrawnQuery,
} = prizesApi;
