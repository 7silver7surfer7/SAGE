import { GamePrize } from '@/prisma/types';
import { useClaimAuctionNftMutation } from '@/store/services/auctionsReducer';
import { ClaimPrizeRequest, useClaimLotteryPrizeMutation } from '@/store/services/prizesReducer';
import { useSession } from 'next-auth/react';
import Image from 'next/image';

interface Props {
  prize: GamePrize;
}

export default function PrizeCard({ prize }: Props) {
  const [claimLotteryPrize] = useClaimLotteryPrizeMutation();
  const [claimAuctionNft] = useClaimAuctionNftMutation();
  const { data: sessionData } = useSession();

  const handleClaimPrizeClick = async () => {
    if (prize.auctionId) {
      await claimAuctionNft(prize.auctionId);
    } else {
      await claimLotteryPrize({
        lotteryId: prize.lotteryId,
        nftId: prize.nftId,
        ticketNumber: prize.lotteryTicketNumber,
        proof: prize.lotteryProof,
        walletAddress: sessionData?.address,
      } as ClaimPrizeRequest);
    }
  };

  return (
    <>
      <div className='nft-tile'>
        <div className='image'>
          <Image src={prize.s3Path} layout='fill' objectFit='cover' />
        </div>
        <div className='collection__tile-details'>
          <div className='interact' style={{ width: '200px' }}>
            <div className='interact__info' style={{ textAlign: 'left' }}>
              <h1 className='interact__name'>{prize.nftName}</h1>
              <h1 className='interact__subtitle'>{prize.artistUsername}</h1>
            </div>
          </div>
        </div>
        <button
          className='interact__claimbutton'
          onClick={handleClaimPrizeClick}
          style={{ width: '100%' }}
        >
          Claim NFT
        </button>
      </div>
    </>
  );
}
