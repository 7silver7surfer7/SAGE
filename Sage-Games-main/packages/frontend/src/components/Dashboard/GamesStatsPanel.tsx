import { gql, useQuery } from '@apollo/client';
import Loader from 'react-loader-spinner';

const LOTTERIES_QUERY = gql`
  query GetLotteries {
    lotteries(first: 5) {
      id
      status
      tickets {
        id
      }
      claimedPrizes {
        id
      }
    }
    tickets(first: 5) {
      id
      lottery {
        id
      }
      ticketNumber
      address
    }
  }
`;

export function GamesStatsPanel() {
  const { loading, error, data } = useQuery(LOTTERIES_QUERY);
  if (loading) {
    return (
      <div style={{ margin: '25px' }}>
        <br />
        <Loader type='ThreeDots' color='white' height={10} width={50} timeout={0} />
      </div>
    );
  }
  if (error) return <p>Error :(</p>;
  return data.lotteries.map(({ id, status, tickets, claimedPrizes }) => (
    <div key={id}>
      <p>
        lottery {parseInt(id)}: {status} tickets: {tickets.length} claimed prizes: {claimedPrizes.length}
      </p>
    </div>
  ));
}
