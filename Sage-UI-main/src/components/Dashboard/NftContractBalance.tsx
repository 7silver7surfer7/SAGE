import { useGetArtistBalanceQuery, useWithdrawArtistBalanceMutation } from '@/store/artistsReducer';
import { Role } from '@prisma/client';
import { Signer } from 'ethers';
import { useSigner } from 'wagmi';
import LoaderSpinner from '../LoaderSpinner';

export default function NftContractBalance({ user }) {
  const { data: signer } = useSigner();
  const [withdrawArtistBalance, { isLoading: isWithdrawing }] = useWithdrawArtistBalanceMutation();
  const { data: balance } = useGetArtistBalanceQuery(user.NftContract?.contractAddress, {
    skip: !user.NftContract?.contractAddress,
  });

  const handleWithdrawClick = async () => {
    if (confirm(`Confirm full withdrawal?\n\nArtist: ${balance?.artistSplit} SAGE\nSAGE: ${balance?.sageSplit} SAGE`)) {
      await withdrawArtistBalance({
        artistContractAddress: user.NftContract?.contractAddress,
        signer: signer as Signer,
      });
    }
  };

  if (user.role != Role.ARTIST) {
    return null;
  }
  if (!user.NftContract || !user.NftContract.contractAddress) {
    return null;
  }
  if (!balance || isWithdrawing) {
    return <LoaderSpinner />;
  }
  return (
    <div style={{ justifyContent: 'center', display: 'flex' }}>
      <div style={{ paddingTop: '7px' }}>{balance.balance} SAGE</div>
      <div
        style={{
          border: '1px solid black',
          marginLeft: '10px',
          padding: '3px',
          backgroundColor: 'white',
          borderRadius: '3px',
        }}
      >
        <img
          src='/icons/withdraw.svg'
          width='20'
          onClick={handleWithdrawClick}
          style={{ cursor: 'pointer' }}
        />
      </div>
    </div>
  );
}
