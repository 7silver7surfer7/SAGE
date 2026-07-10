import { useNetwork, useSwitchNetwork } from 'wagmi';
import { useEffect, useState } from 'react';
import { parameters } from '@/constants/config';
import { toast } from 'react-toastify';
import useModal from './useModal';

const designatedChain = parameters.NETWORK_NAME;

export default function useWatchNetwork() {
  const [isLoading, setIsLoading] = useState(false);
  const { chain: activeChain } = useNetwork();
  const {
    isOpen: isNetworkModalOpen,
    openModal: openNetworkModal,
    closeModal: closeNetworkModal,
  } = useModal();

  const { chains, error, pendingChainId, switchNetwork } = useSwitchNetwork();

  function switchToCorrectNetwork() {
    setIsLoading(true);
    switchNetwork(+parameters.CHAIN_ID);
  }

  function handleIncorrectNetwork() {
    if (!activeChain) return;
    if (activeChain.id !== +parameters.CHAIN_ID) {
      toast.warn(`Please change your network to ${designatedChain} `, {
        toastId: 'networkChange',
        autoClose: false,
        closeOnClick: false,
        closeButton: false,
        onClick: () => {
          openNetworkModal();
        },
      });
    } else {
      toast.update('networkChange', {
        type: 'success',
        autoClose: 3000,
        render: `Switched to ${String(parameters.NETWORK_NAME)}`,
      });
      closeNetworkModal();
    }
  }

  //handle user on incorrect network
  useEffect(() => {
    handleIncorrectNetwork();
  }, [activeChain?.id]);

  return { isNetworkModalOpen, closeNetworkModal, switchToCorrectNetwork, isLoading };
}
