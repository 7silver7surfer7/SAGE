import useModal from '@/hooks/useModal';
import { useSession } from 'next-auth/react';
import Image from 'next/image';
import Loader from 'react-loader-spinner';
import shortenAddress from '@/utilities/shortenAddress';
import { useGetUserQuery } from '@/store/services/user';
import AccountModal from '@/components/Modals/AccountModal';
import { useState } from 'react';

export default function Connect() {
  const {
    isOpen: isAccountModalOpen,
    closeModal: closeAccountModal,
    openModal: openAccountModal,
  } = useModal();
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const { status, data: sessionData } = useSession();
  const { data: userData } = useGetUserQuery();
  const isSignedIn = status === 'authenticated';
  const userName =
    (userData?.username as string) || shortenAddress(userData?.walletAddress as string);
  const pfp = userData?.profilePicture || '/sample/pfp.svg';
  return (
    <>
      {status === 'unauthenticated' && (
        <button
          onClick={openAccountModal}
          className='connect-btn'
          disabled={isLoading || isAccountModalOpen}
        >
          {isLoading ? (
            <Loader type='ThreeDots' color='white' height={10} width={50} timeout={0} />
          ) : (
            <h1>Connect</h1>
          )}
        </button>
      )}
      {status === 'authenticated' && (
        <div className='profile' onClick={openAccountModal}>
          {isSignedIn && (
            <div className='pfp'>
              <Image src={pfp} layout='fill' />
            </div>
          )}
          <div>
            <h1 className='wallet-status'>{isSignedIn ? 'Signed In' : 'Sign In'}</h1>
            {isSignedIn && <h1 className='username'>{userName}</h1>}
          </div>
        </div>
      )}

      <AccountModal
        isOpen={isAccountModalOpen}
        isLoading={isLoading}
        closeModal={closeAccountModal}
        setIsLoading={setIsLoading}
      />
    </>
  );
}
