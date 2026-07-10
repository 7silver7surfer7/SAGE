import { User } from '@prisma/client';
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { toast } from 'react-toastify';
import type { Lottery as LotteryContract } from '@/types/contracts';
import { getLotteryContract } from '@/utilities/contracts';

export interface LotteryParticipant {
  walletAddress: string;
  numTicketsPoints: number;
  numTicketsCoins: number;
}

export interface LotteryStats {
  lotteryId: number;
  dropId: number;
  closeTime: number;
  status: number;
  ticketCostPoints: string;
  ticketCostCoins: string;
  numTicketsPoints: number;
  numTicketsCoins: number;
  participants: LotteryParticipant[];
  prizesDrawn?: number;
  prizesClaimed?: number;
}

export const dashboardApi = createApi({
  reducerPath: 'dashboardApi',
  baseQuery: fetchBaseQuery({ baseUrl: '/' }),
  // refetch queries every 5 minutes
  refetchOnMountOrArgChange: 300,
  endpoints: (builder) => ({
    getAllUsersAndEarnedPoints: builder.query<User[], void>({
      query: () => '/api/user?action=GetAllUsersAndEarnedPoints',
    }),
    getLotteriesStats: builder.query<LotteryStats[], void>({
      queryFn: async () => {
        try {
          console.time('getLotteryStats()');
          let prizesResponse = fetch('/api/prizes?action=GetPrizesStats');
          let allStats: LotteryStats[] = [];
          const lotteryContract = await getLotteryContract();
          const lotteryCount = await lotteryContract.getLotteryCount();
          for (let i = 1; i <= Number(lotteryCount); i++) {
            let lottoStats = await getLotteryByIndex(lotteryContract, i);
            allStats.push(lottoStats);
          }
          allStats.sort((a, b) => {
            return a.lotteryId > b.lotteryId ? -1 : 1;
          });
          let prizesPerLotto: any = await (await prizesResponse).json();
          allStats.forEach((lotto) => {
            for (var prizeLotteryId in prizesPerLotto) {
              if (lotto.lotteryId == Number(prizeLotteryId)) {
                lotto.prizesDrawn = prizesPerLotto[prizeLotteryId].numPrizesDrawn;
                lotto.prizesClaimed = prizesPerLotto[prizeLotteryId].numPrizesClaimed;
              }
            }
          });
          return { data: allStats };
        } catch (e) {
          console.log(e);
          return { data: [] };
        } finally {
          console.timeEnd('getLotteryStats()');
        }
      },
    }),
  }),
});

async function getLotteryByIndex(
  lotteryContract: LotteryContract,
  index: number
): Promise<LotteryStats> {
  const lotteryId = await lotteryContract.lotteries(index);
  return getLotteryStats(lotteryContract, lotteryId.toNumber());
}

// TODO fix stats as pricing tiers were changed on the contract
async function getLotteryStats(
  lotteryContract: LotteryContract,
  lotteryId: number
): Promise<LotteryStats> {
  const ticketCostPoints = 0,
    ticketCostCoins = 0,
    status = 0;
  const closeTime = new Date().getTime();
  // const { closeTime, status, ticketCostPoints, ticketCostCoins } = await lotteryContract.getLotteryInfo(lotteryId);
  let lottoStats: LotteryStats = {
    lotteryId: Number(lotteryId),
    dropId: 0,
    closeTime: closeTime,
    status,
    ticketCostCoins: ticketCostCoins.toString(),
    ticketCostPoints: ticketCostPoints.toString(),
    numTicketsCoins: 0,
    numTicketsPoints: 0,
    participants: [],
  };
  const tktAddresses: string[] = []; //await lotteryContract.getLotteryTickets(lotteryId);
  const tktAddrUnique = tktAddresses.filter((v, i, a) => a.indexOf(v) === i);
  for (const tktAddr of tktAddrUnique) {
    const partInfo = await lotteryContract.participants(lotteryId, tktAddr);
    //lottoStats.numTicketsCoins += partInfo.ticketsFromCoins;
    //lottoStats.numTicketsPoints += partInfo.ticketsFromPoints;
    //lottoStats.participants.push({
    //walletAddress: tktAddr,
    //numTicketsCoins: partInfo.ticketsFromCoins,
    //numTicketsPoints: partInfo.ticketsFromPoints,
    //});
    lottoStats.participants.sort((a, b) => {
      return a.walletAddress > b.walletAddress ? -1 : 1;
    });
  }
  return lottoStats;
}

export const {
  useGetAllUsersAndEarnedPointsQuery,
  useGetLotteriesStatsQuery,
} = dashboardApi;
