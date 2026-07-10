import { useGetPointsBalanceByUserQuery } from '@/store/pointsReducer';
import Modal, { Props as ModalProps } from '@/components/Modals';
import { PfpImage } from '@/components/Media/BaseMedia';
import { User_include_EarnedPoints } from '@/prisma/types';
import {
  usePromoteUserToAdminMutation,
  usePromoteUserToArtistMutation,
} from '@/store/dashboardReducer';
import LoaderSpinner from '../LoaderSpinner';
import { useBalance, useSigner } from 'wagmi';
import { Signer } from 'ethers';
import { parameters } from '@/constants/config';
import CloseSVG from '@/public/interactive/close.svg';
import { toast } from 'react-toastify';

interface UserDetailsModalProps extends ModalProps {
  userData: User_include_EarnedPoints;
}

export function UserDetailsModal({ isOpen, closeModal, userData }: UserDetailsModalProps) {
  const { data: signer } = useSigner();
  const { data: pointsBalance } = useGetPointsBalanceByUserQuery(userData?.walletAddress, {
    skip: !userData,
  });
  const [promoteUserToArtist, { isLoading: isPromotingToArtist }] = usePromoteUserToArtistMutation();
  const [promoteUserToAdmin, { isLoading: isPromotingToAdmin }] = usePromoteUserToAdminMutation();
  const { data: walletBalance } = useBalance({
    token: parameters.ASHTOKEN_ADDRESS,
    addressOrName: userData?.walletAddress,
  });
  const ashBalance = Number(walletBalance?.formatted);
  const ashBalanceDisplay = isNaN(ashBalance) ? '' : ashBalance.toFixed(2);
  const pointsBalanceDisplay = isNaN(Number(pointsBalance)) ? '' : Number(pointsBalance).toFixed(2);

  async function handlePromoteToArtistClick(walletAddress: string) {
    if (!userData?.username) {
      toast.error('User must have a username to be promoted to ARTIST');
      return;
    }
    if (!signer) {
      toast.error('Signer not found! Make sure wallet is connected or refresh your browser.');
      return;
    }
    await promoteUserToArtist({ walletAddress, signer: signer as Signer });
  }

  async function handlePromoteToAdminClick(walletAddress: string) {
    if (confirm(`Confirm promoting ${walletAddress} to ADMIN?`)) {
      if (!signer) {
        toast.error('Signer not found! Make sure wallet is connected or refresh your browser.');
        return;
      }
      await promoteUserToAdmin({ walletAddress, signer: signer as Signer });
    }
  }

  return (
    <Modal title='User Details' isOpen={isOpen} closeModal={closeModal}>
      <div className='dashboard__user-details-modal'>
        <section className='games-modal__header'>
          {/* hidden button so browser won't complain about not having a focusable element inside the modal */}
          <button style={{ background: 'transparent', outline: 'none' }}></button>
          <CloseSVG onClick={closeModal} className='games-modal__close-button' />
        </section>
        <section className='games-modal__body'>
          <div style={{ textAlign: 'center' }}>
            <div>
              <div className='dashboard__user-details-modal__pfp-container'>
                <PfpImage src={userData?.profilePicture} />
              </div>
              <div style={{ fontWeight: 'bolder' }}>{userData?.username}</div>
              <div style={{ marginTop: '20px' }}>{userData?.email}</div>
              <div
                style={{
                  marginTop: '20px',
                  fontStyle: 'italic',
                  maxWidth: '300px',
                  marginLeft: 'auto',
                  marginRight: 'auto',
                }}
              >
                {userData?.bio}
              </div>
              <div style={{ marginTop: '20px' }}>{userData?.walletAddress}</div>
              <div style={{ marginTop: '20px' }}>
                Balance: {ashBalanceDisplay} ASH + {pointsBalanceDisplay} PIXEL
              </div>
              <div style={{ marginTop: '20px' }}>
                Role:{' '}
                {
                  <span
                    style={{
                      color:
                        userData?.role == 'ADMIN'
                          ? '#22b573'
                          : userData?.role == 'ARTIST'
                          ? '#792e9c'
                          : '',
                    }}
                  >
                    {userData?.role}
                  </span>
                }
              </div>
              {userData?.role == 'USER' && (
                <>
                  <button
                    disabled={isPromotingToAdmin || isPromotingToArtist}
                    onClick={() => handlePromoteToArtistClick(userData?.walletAddress!)}
                    className='dashboard__submit-button'
                    style={{ marginTop: '20px', width: '100%'  }}
                  >
                    {isPromotingToAdmin || isPromotingToArtist ? <LoaderSpinner /> : 'Promote to ARTIST'}
                  </button>
                  <button
                    disabled={isPromotingToAdmin || isPromotingToArtist}
                    onClick={() => handlePromoteToAdminClick(userData?.walletAddress!)}
                    className='dashboard__submit-button'
                    style={{ marginTop: '20px', width: '100%' }}
                  >
                    {isPromotingToAdmin || isPromotingToArtist ? <LoaderSpinner /> : 'Promote to ADMIN'}
                  </button>
                </>
              )}
            </div>
          </div>
        </section>
      </div>
    </Modal>
  );
}
