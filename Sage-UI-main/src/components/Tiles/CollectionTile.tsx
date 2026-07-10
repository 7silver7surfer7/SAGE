import { BaseMedia, PfpImage } from '../Media/BaseMedia';
import { ClaimPrizeRequest, useClaimLotteryPrizeMutation } from '@/store/prizesReducer';
import { GamePrize } from '@/prisma/types';
import { useClaimAuctionMutation } from '@/store/auctionsReducer';
import { useSession } from 'next-auth/react';
import { Signer } from 'ethers';
import { useSigner } from 'wagmi';

interface Props {
  item: GamePrize;
}

export default function CollectionTile({ item }: Props) {
  const { data: sessionData } = useSession();
  const { data: signer } = useSigner();
  const [claimLotteryPrize, { isLoading: isClaimLotteryPrizeLoading }] =
    useClaimLotteryPrizeMutation();
  const [claimAuctionPrize, { isLoading: isClaimAuctionPrizeLoading }] = useClaimAuctionMutation();

  const handleClaimPrizeClick = async (prize: GamePrize) => {
    if (prize.auctionId) {
      await claimAuctionPrize({ id: prize.auctionId, signer: signer as Signer });
    } else {
      await claimLotteryPrize({
        lotteryId: prize.lotteryId,
        nftId: prize.nftId,
        proof: prize.lotteryProof,
        ticketNumber: prize.ticketNumber,
        walletAddress: sessionData?.address,
        signer: signer as Signer,
      } as ClaimPrizeRequest);
    }
  };

  return (
    <div className='collection__tile'>
      <div className='collection__tile-img'>
        <BaseMedia src={item.s3PathOptimized} isZoomable={true} />
      </div>
      <div className='collection__tile-details'>
        <div className='collection__tile-artist'>
          <div className='collection__tile-artist-pfp'>
            <PfpImage src={item.artistProfilePicture} />
          </div>
          <div className='collection__tile-artist-info'>
            <div className='collection__tile-nft-name'>{item.nftName}</div>
            <div className='collection__tile-artist-name'>by {item.artistUsername}</div>
          </div>
        </div>
        {!item.claimedAt && (
          <button
            className='collection__tile-claim-button'
            onClick={() => handleClaimPrizeClick(item)}
            disabled={isClaimAuctionPrizeLoading || isClaimLotteryPrizeLoading}
          >
            Claim NFT
          </button>
        )}
      </div>
    </div>
  );
}
