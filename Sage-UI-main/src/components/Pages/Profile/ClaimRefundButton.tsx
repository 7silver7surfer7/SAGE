import { useSigner } from 'wagmi';
import { toast } from 'react-toastify';
import { Refund } from '@prisma/client';
import { useClaimRefundMutation } from '@/store/lotteriesReducer';
import LoaderSpinner from '@/components/LoaderSpinner';
import CheckSVG from '@/public/icons/check.svg';

interface Props {
  refund: Refund;
}

export default function ClaimRefundButton({ refund }: Props) {
  const [claimRefund, { isLoading: isClaimingRefund }] = useClaimRefundMutation();
  const { data: signer } = useSigner();

  async function handleInteractButtonClick() {
    if (!signer) {
      toast.info('Please sign in with a wallet.');
      return;
    }
    await claimRefund({ refund, signer });
  }

  return (
    <>
      <button
        disabled={!!refund.txHash || isClaimingRefund || !!refund.txHash}
        onClick={handleInteractButtonClick}
        className='notifications-panel__interact-button'
      >
        {isClaimingRefund ? <LoaderSpinner /> : refund.txHash ? 'claimed' : 'claim'}
      </button>
      <CheckSVG
        data-claimed={!!refund.txHash}
        className='notifications-panel__td--interact-check-svg'
      />
    </>
  );
}
