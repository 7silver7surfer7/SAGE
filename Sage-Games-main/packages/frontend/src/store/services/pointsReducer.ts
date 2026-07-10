import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { getRewardsContract } from '@/utilities/contracts';
import { EarnedPoints } from '@prisma/client';

var escrowPoints: number = 0;

export const pointsApi = createApi({
  reducerPath: 'pointsApi',
  baseQuery: fetchBaseQuery({ baseUrl: '/api' }),
  tagTypes: ['UserPoints', 'EscrowPoints'],
  endpoints: (builder) => ({
    getEarnedPoints: builder.query<EarnedPoints, string>({
      query: (walletAddress) => `points?walletAddress=${walletAddress}`,
    }),
    getPointsBalance: builder.query<number, void>({
      queryFn: async (_arg, { dispatch }, _extraOptions, fetchWithBQ) => {
        const { data } = await fetchWithBQ(`points`);
        const pointsEarned = BigInt((data as any).totalPointsEarned);
        const pointsUsed = await getTotalPointsUsed((data as any).walletAddress);
        let pointsBalance = pointsEarned - pointsUsed;
        // as the balance is fresh from contract and database, release any escrow on hold
        dispatch(pointsApi.endpoints.releaseEscrowPoints.initiate());
        return { data: Number(pointsBalance) };
      },
      providesTags: ['UserPoints'],
    }),
    withholdEscrowPoints: builder.mutation<null, number>({
      queryFn: async (numPoints: number) => {
        escrowPoints = numPoints;
        return { data: null };
      },
      invalidatesTags: ['EscrowPoints'],
    }),
    releaseEscrowPoints: builder.mutation<null, void>({
      queryFn: async () => {
        escrowPoints = 0;
        return { data: null };
      },
      invalidatesTags: ['EscrowPoints'],
    }),
    getEscrowPoints: builder.query<number, void>({
      queryFn: async () => {
        return { data: escrowPoints };
      },
      providesTags: ['EscrowPoints'],
    }),
  }),
});

const getTotalPointsUsed = async (walletAddress: string) => {
  try {
    const contract = await getRewardsContract();
    return (await contract.totalPointsUsed(walletAddress)).toBigInt();
  } catch (e) {
    console.error(e);
  }
  return BigInt(0);
};

export const {
  useGetEarnedPointsQuery,
  useGetEscrowPointsQuery,
  useGetPointsBalanceQuery,
  useReleaseEscrowPointsMutation,
  useWithholdEscrowPointsMutation,
} = pointsApi;
