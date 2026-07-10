import { useGetTicketCountsQuery } from '@/store/lotteriesReducer';
import { Lottery } from '@prisma/client';

export const useTicketCount = (drawings: Lottery[], walletAddress: string) => {
  const lotteryIds: number[] = drawings.map((game) => game.id);
  const { data } = useGetTicketCountsQuery({ lotteryIds, walletAddress });
  return data;
};
