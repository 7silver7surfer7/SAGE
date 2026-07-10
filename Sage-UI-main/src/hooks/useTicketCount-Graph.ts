import { gql, useQuery } from '@apollo/client';
import { Lottery } from '@prisma/client';
import { useState } from 'react';

interface TicketCountMap {
  [gameId: number]: number;
}

export const useTicketCount = (drawings: Lottery[], walletAddress: string) => {
  const [ticketCountMap, setTicketCountMap] = useState<TicketCountMap>({});

  const QUERY = gql`
    query TicketsQuery($walletAddress: String!, $lotteryIds: [String!]!) {
      tickets(where: { address: $walletAddress, lottery_in: $lotteryIds }) {
        id
        lottery {
          id
        }
        address
      }
    }
  `;
  var hexIds: string[] = [];
  for (var d of drawings) {
    hexIds.push('0x' + d.id.toString(16));
    ticketCountMap[d.id] = 0;
  }
  const { data, startPolling, error } = useQuery(QUERY, {
    variables: { walletAddress, lotteryIds: hexIds },
    skip: !walletAddress || hexIds.length == 0,
  });
  if (error) {
    console.log(error);
  }
  if (data) {
    for (var t of data.tickets) {
      for (var d of drawings) {
        if (parseInt(t.lottery.id) == d.id) {
          ticketCountMap[d.id]++;
        }
      }
    }
  }
  startPolling(2000);
  return ticketCountMap;
};
