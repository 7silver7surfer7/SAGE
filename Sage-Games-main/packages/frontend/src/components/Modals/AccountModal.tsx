import {
  useConnect,
  useAccount,
  useSignMessage,
  useNetwork,
  useDisconnect,
  Connector,
} from 'wagmi';
import { SiweMessage } from 'siwe';
import Modal, { Props as ModalProps } from '@/components/Modals';
import type { Dispatch, SetStateAction } from 'react';
import Loader from 'react-loader-spinner';
import shortenAddress from '@/utilities/shortenAddress';
import { getCsrfToken, useSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import { useSignInMutation, useSignOutMutation } from '@/store/services/user';

interface Props extends ModalProps {
  isLoading: boolean;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
}

export default function AccountModal({ isOpen, closeModal, isLoading, setIsLoading }: Props) {
  const { data: accountData } = useAccount();
  const { data: sessionData, status: sessionStatus } = useSession();
  const { connectors, connectAsync, activeConnector } = useConnect();
  const [signIn, { isLoading: isSigningIn }] = useSignInMutation();
  const [signOut] = useSignOutMutation();
  const { signMessageAsync } = useSignMessage();
  const { activeChain } = useNetwork();
  const { disconnect } = useDisconnect();
  const router = useRouter();

  const handleSignInClick = async () => {
    try {
      setIsLoading(true);
      const nonce = await getCsrfToken();
      const message = new SiweMessage({
        domain: window.location.host,
        address: accountData?.address,
        statement: 'Sign in with Ethereum to the app.',
        uri: window.location.origin,
        version: '1',
        chainId: activeChain?.id,
        nonce,
      });
      const signature = await signMessageAsync({
        message: message.prepareMessage(),
      });
      signIn({ message, signature });
      setIsLoading(false);
    } catch (error) {
      console.error(error);
      setIsLoading(false);
    }
  };

  async function handleConnectClick(c: Connector<any, any>) {
    try {
      setIsLoading(true);
      await connectAsync(c);
      setIsLoading(false);
    } catch {
      setIsLoading(false);
    }
  }

  return (
    <Modal title='Account' isOpen={isOpen} closeModal={closeModal}>
      <div className='accountmodal'>
        <div className='connectors'>
          <h1 className='connectors__title'>
            {accountData ? `Connected to ${activeConnector?.name}` : 'Connect Options:'}
          </h1>
          {accountData && (
            <h1 className='connectors__current-address'>
              WalletAddress: {shortenAddress(accountData?.address as string)}
            </h1>
          )}

          {accountData && (
            <h1 className='connectors__current-chain'>Network: {activeChain?.name}</h1>
          )}
          {!accountData &&
            connectors.map((c) => {
              return (
                <button className='connectors__option' key={c.name}>
                  <h1
                    onClick={() => {
                      handleConnectClick(c);
                    }}
                  >
                    {c.name}
                  </h1>
                </button>
              );
            })}
          {accountData && (
            <button
              className='connectors__disconnect'
              onClick={() => {
                disconnect();
              }}
            >
              Disconnect
            </button>
          )}
        </div>
        <div className='session'>
          <h1 className='session__status'>
            {sessionData
              ? `Signed In As: ${shortenAddress(sessionData?.address as string)}`
              : `Sign In With Ethereum`}
          </h1>
          {sessionData ? (
            <button className='accountmodal__sign-out-btn' onClick={() => signOut(null)}>
              Sign Out
            </button>
          ) : (
            <button
              className='accountmodal__sign-in-btn'
              onClick={handleSignInClick}
              disabled={isLoading || !accountData || isSigningIn}
            >
              Sign In
            </button>
          )}
          <button
            className='accountmodal__profile-btn'
            onClick={() => router.push('/profile')}
            disabled={!sessionData}
          >
            Go to Profile
          </button>
        </div>
        {isLoading && (
          <div className='accountmodal__loader-container'>
            <Loader type='ThreeDots' color='white' secondaryColor='yellow' />
          </div>
        )}
      </div>
    </Modal>
  );
}
