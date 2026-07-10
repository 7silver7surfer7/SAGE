import LoaderSpinner from '@/components/LoaderSpinner';
import { useGetArtistBalanceQuery, useWithdrawArtistBalanceMutation } from '@/store/artistsReducer';
import { Signer } from 'ethers';
import { useSigner } from 'wagmi';

export default function ArtistBalancePanel({ artistContractAddress }) {
  const { data: signer } = useSigner();
  const { data: balance } = useGetArtistBalanceQuery(artistContractAddress);
  const [withdrawArtistBalance, { isLoading: isWithdrawing }] = useWithdrawArtistBalanceMutation();

  async function handleWithdrawClick() {
    await withdrawArtistBalance({ artistContractAddress, signer: signer as Signer });
  }

  return (
    <div style={{ float: 'right', textAlign: 'center', border: '1px solid #ddd', padding: '15px' }}>
      artist balance: <span style={{ fontWeight: 'bolder' }}>{balance?.artistSplit}</span> SAGE
      <button
        style={{ marginTop: '15px' }}
        onClick={handleWithdrawClick}
        className='games-modal__buy-tickets-button'
        disabled={'0.0' == balance?.artistSplit || isWithdrawing}
      >
        {isWithdrawing ? <LoaderSpinner /> : 'withdraw'}
      </button>
    </div>
  );
}
