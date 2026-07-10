import BaseModal, { Props as BaseModalProps } from '@/components/Modals/index';
import { parameters } from '@/constants/config';
import { useNetwork } from 'wagmi';

interface Props extends BaseModalProps {
  switchToCorrectNetwork: () => void;
  isLoading: boolean;
}

export default function WrongNetworkModal({
  isOpen,
  closeModal,
  switchToCorrectNetwork,
  isLoading,
}: Props) {
  const { chain: activeChain } = useNetwork();
  return (
    <BaseModal isOpen={isOpen} closeModal={closeModal} title='Wrong Network'>
      <div className='wrong-network-modal'>
        <p className='wrong-network-modal__text'>
          You are on {activeChain?.name} - switch to {parameters.NETWORK_NAME} to use the App{' '}
        </p>
        <button
          disabled={isLoading}
          className='wrong-network-modal__button'
          onClick={switchToCorrectNetwork}
        >
          {isLoading ? 'pending...' : 'switch network'}
        </button>
      </div>
    </BaseModal>
  );
}
