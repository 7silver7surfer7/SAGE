import useModal from '@/hooks/useModal';
import Modal, { Props as ModalProps } from '@/components/Modals';
import { useSession } from 'next-auth/react';
import useSAGEAccount from '@/hooks/useSAGEAccount';
import Wallet from './Wallet';

export default function Connect() {
  const {
    isOpen: isAccountModalOpen,
    closeModal: closeAccountModal,
    openModal: openAccountModal,
  } = useModal();

  const { status: sessionStatus } = useSession();
  const { isWalletConnected } = useSAGEAccount();
  let buttonText: string = 'connect';
  let buttonClass: string = 'connect';

  if (isWalletConnected) {
    if (sessionStatus === 'authenticated') {
      return null;
    }

    if (sessionStatus === 'unauthenticated') {
      buttonText = 'sign in';
    }
  }

  return (
    <button className={buttonClass} onClick={openAccountModal}>
      {buttonText}

      <Modal closeModal={closeAccountModal} isOpen={isAccountModalOpen}>
        <Wallet isOpen={isAccountModalOpen} closeModal={closeAccountModal} />
      </Modal>
    </button>
  );
}
