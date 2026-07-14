import { useRouter } from 'next/router';
import { useGetBidHistoryQuery } from '@/store/auctionsReducer';
import { PfpImage } from '@/components/Media/BaseMedia';
import shortenAddress from '@/utilities/shortenAddress';
import { transformTitle } from '@/utilities/strings';

interface Props {
  auctionId: number;
  isActive: boolean;
}

// styles/components/_games-modal.scss
export default function BidHistoryTable({ auctionId, isActive }: Props) {
  const router = useRouter();
  const { data: bids } = useGetBidHistoryQuery(auctionId);

  if (!isActive) return null;

  if (!bids?.length) {
    return (
      <div className='games-modal__bid-history-table' data-active={isActive}>
        <p className='games-modal__bid-history-empty'>No bids yet — be the first.</p>
      </div>
    );
  }

  return (
    <div className='games-modal__bid-history-table' data-active={isActive}>
      <div className='games-modal__bid-history-data'>
        {bids.map((bid, i) => {
          const dateTime = new Date(bid.blockTimestamp * 1000).toLocaleString();
          const name = bid.bidderUsername
            ? transformTitle(bid.bidderUsername)
            : shortenAddress(bid.bidderAddress);
          return (
            <button
              key={`${bid.bidderAddress}-${bid.blockTimestamp}`}
              className='games-modal__bid-history-row'
              data-leading={i === 0}
              onClick={(e) => {
                e.stopPropagation();
                // wallet-keyed — resolves for every bidder even without a
                // marketplace username (the /creators/[username] route can't)
                router.push(`/social/${bid.bidderAddress}`);
              }}
            >
              <span className='games-modal__bid-history-avatar'>
                <PfpImage src={bid.bidderProfilePicture} />
              </span>
              <span className='games-modal__bid-history-bidder'>{name}</span>
              <span className='games-modal__bid-history-time'>{dateTime}</span>
              <span className='games-modal__bid-history-amount'>
                {bid.amount} {bid.currency}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
