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
      // Since the mainnet launch a wallet can easily sit on the TESTNET
      // entry (46630) which is also named "Robinhood" — so name the chain id
      // and make the click trigger the switch/add prompt directly instead of
      // routing through the modal (kept as fallback for wallets that don't
      // support programmatic switching).
      toast.warn(
        `Wrong network: click here to switch to ${designatedChain} (chain ${parameters.CHAIN_ID})`,
        {
          toastId: 'networkChange',
          autoClose: false,
          closeOnClick: false,
          closeButton: false,
          onClick: () => {
            if (switchNetwork) {
              switchToCorrectNetwork();
            } else {
              openNetworkModal();
            }
          },
        }
      );
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
