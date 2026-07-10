import { computeAuctionStatus } from '@/utilities/status';
import Countdown from '@/components/Countdown';

type Props = Parameters<typeof computeAuctionStatus>[0];

// styles/components/_status.scss
export default function Status({ endTime, startTime, settled }: Props) {
  const gameStatus = computeAuctionStatus({ endTime, startTime, settled });
  return (
    <div className='status'>
      <div className='status__is-live'>
        <div className='status__dot' data-status={gameStatus} />
        <div className='status__text'>{gameStatus}</div>
        {gameStatus === 'Live' && (
          <Countdown className='status__countdown' endTime={endTime}></Countdown>
        )}
        {gameStatus === 'Upcoming' && (
          <Countdown className='status__countdown' endTime={startTime}></Countdown>
        )}
      </div>
    </div>
  );
}
