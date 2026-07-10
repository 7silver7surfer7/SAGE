import { useClaimLotteryPrizeMutation } from '@/store/prizesReducer';
import { Signer } from 'ethers';
import { useClaimAuctionMutation } from '@/store/auctionsReducer';
import { useGetUserQuery } from '@/store/usersReducer';
import { useSigner } from 'wagmi';
import { GamePrize } from '@/prisma/types';
import { toast } from 'react-toastify';
import CheckSVG from '@/public/icons/check.svg';
import LoaderSpinner from '@/components/LoaderSpinner';

interface Props {
  gamePrize: GamePrize;
}

export default function ClaimPrizeButton({ gamePrize }: Props) {
  if (!gamePrize) return null;
  const { lotteryId, lotteryProof, ticketNumber, uri, nftId, auctionId } = gamePrize;
  const [claimLotteryPrize, { isLoading: isClaimingLotteryPrize }] = useClaimLotteryPrizeMutation();
  const [claimAuctionPrize, { isLoading: isClaimingAuction }] = useClaimAuctionMutation();
  const { data: userData } = useGetUserQuery();
  const { data: signer } = useSigner();
  async function handleInteractButtonClick() {
    if (!signer) {
      toast.info('Please sign in with a wallet.', { toastId: 'claimLotteryPrize' });
      return;
    }
    if (lotteryId) {
      try {
        claimLotteryPrize({
          lotteryId: lotteryId,
          proof: lotteryProof as string,
          walletAddress: userData?.walletAddress as string,
          uri,
          ticketNumber,
          signer: signer as Signer,
          nftId: nftId,
        });
      } catch (e) {
        console.error(e);
      }
    } else if (auctionId) {
      claimAuctionPrize({ id: auctionId, signer: signer as Signer });
    }
  }

  return (
    <>
      <button
        disabled={!!gamePrize.claimedAt || isClaimingAuction || isClaimingLotteryPrize}
        onClick={handleInteractButtonClick}
        className='notifications-panel__interact-button'
      >
        {isClaimingAuction || isClaimingLotteryPrize ? (
          <LoaderSpinner />
        ) : gamePrize.claimedAt ? (
          'claimed'
        ) : (
          'claim'
        )}
      </button>
      <CheckSVG
        data-claimed={!!gamePrize.claimedAt}
        className='notifications-panel__td--interact-check-svg'
      />
    </>
  );
}
