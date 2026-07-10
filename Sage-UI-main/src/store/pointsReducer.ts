import { getRewardsContract } from '@/utilities/contracts';
import { EarnedPoints } from '@prisma/client';
import type { GetEarnedPointsResponse } from '@/api/points.page';
import { baseApi } from './baseReducer';

var escrowPoints: number = 0;

export const pointsApi = baseApi.injectEndpoints({
  overrideExisting: true,
  endpoints: (builder) => ({
    getEarnedPoints: builder.query<GetEarnedPointsResponse, void>({
      query: () => `points`,
    }),
    getPointsBalance: builder.query<string, void>({
      queryFn: async (_arg, { dispatch }, _extraOptions, fetchWithBQ) => {
        const { data } = await fetchWithBQ(`points`);
        const pointsEarned = BigInt((data as any).totalPointsEarned);
        const userAddress = (data as EarnedPoints).address;
        const pointsUsed = await getTotalPointsUsed(userAddress);
        let pointsBalance = pointsEarned - pointsUsed;
        // as the balance is fresh from contract and database, release any escrow on hold
        dispatch(pointsApi.endpoints.releaseEscrowPoints.initiate());
        console.log(`getPointsBalance() :: ${pointsEarned} - ${pointsUsed} = ${pointsBalance}`);
        return { data: Number(pointsBalance).toFixed(0) };
      },
      providesTags: ['UserPoints'],
    }),
    getPointsBalanceByUser: builder.query<string, string>({
      queryFn: async (walletAddress, {}, _extraOptions, fetchWithBQ) => {
        const { data } = await fetchWithBQ(`points?address=${walletAddress}`);
        const pointsEarned = BigInt((data as any).totalPointsEarned);
        const userAddress = (data as EarnedPoints).address;
        const pointsUsed = await getTotalPointsUsed(userAddress);
        let pointsBalance = pointsEarned - pointsUsed;
        console.log(
          `getPointsBalanceByUser(${walletAddress}) :: ${pointsEarned} - ${pointsUsed} = ${pointsBalance}`
        );
        return { data: Number(pointsBalance).toFixed(0) };
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

const getTotalPointsUsed = async (walletAddress: string): Promise<bigint> => {
  try {
    const contract = await getRewardsContract();
    const result = await contract.totalPointsUsed(walletAddress);
    console.log(`RewardsContract.totalPointsUsed(${walletAddress}) :: ${result}`);
    return result.toBigInt();
  } catch (e) {
    console.error(e);
    return BigInt(0);
  }
};

export const {
  useGetEarnedPointsQuery,
  useGetEscrowPointsQuery,
  useGetPointsBalanceQuery,
  useGetPointsBalanceByUserQuery,
  useReleaseEscrowPointsMutation,
  useWithholdEscrowPointsMutation,
} = pointsApi;
