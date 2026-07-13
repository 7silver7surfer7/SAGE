import useModal from '@/hooks/useModal';
import Modal, { Props as ModalProps } from '@/components/Modals';
import { useSession } from 'next-auth/react';
import useSAGEAccount from '@/hooks/useSAGEAccount';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import Wallet from './Wallet';

export default function Connect() {
  const {
    isOpen: isAccountModalOpen,
    closeModal: closeAccountModal,
    openModal: openAccountModal,
  } = useModal();

  const { status: sessionStatus } = useSession();
  const { isWalletConnected } = useSAGEAccount();
  const { openConnectModal } = useConnectModal();
  let buttonText: string = 'connect';
  let buttonClass: string = 'connect';

  const needsSignIn = isWalletConnected && sessionStatus === 'unauthenticated';
  if (isWalletConnected && sessionStatus === 'authenticated') {
    return null;
  }
  if (needsSignIn) {
    buttonText = 'sign in';
  }

  // Two-step: RainbowKit's polished modal owns wallet CONNECTION (responsive,
  // works at every width); the legacy Wallet modal owns the post-connect SIWE
  // sign-in prompt + profile view. openConnectModal is undefined during SSR /
  // when already connected — fall back to the legacy modal then.
  function handleClick() {
    if (!isWalletConnected && openConnectModal) {
      openConnectModal();
      return;
    }
    openAccountModal();
  }

  return (
    <button className={buttonClass} onClick={handleClick}>
      {buttonText}

      <Modal closeModal={closeAccountModal} isOpen={isAccountModalOpen}>
        <Wallet isOpen={isAccountModalOpen} closeModal={closeAccountModal} />
      </Modal>
    </button>
  );
}
