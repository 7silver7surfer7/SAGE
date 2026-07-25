import { useNetwork, useSwitchNetwork } from 'wagmi';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import { expectedChainForPath } from '@/components/Agent/trade';
import useModal from './useModal';

export default function useWatchNetwork() {
  const [isLoading, setIsLoading] = useState(false);
  const { chain: activeChain } = useNetwork();
  // Per-route, because /agent trades mainnet from every build. Reading the
  // build's chain here nagged the user back to testnet right after the agent
  // had correctly switched them to mainnet to sign an order.
  const { pathname } = useRouter();
  const expected = expectedChainForPath(pathname);
  const designatedChain = expected.name;
  const {
    isOpen: isNetworkModalOpen,
    openModal: openNetworkModal,
    closeModal: closeNetworkModal,
  } = useModal();

  const { chains, error, pendingChainId, switchNetwork } = useSwitchNetwork();

  function switchToCorrectNetwork() {
    setIsLoading(true);
    switchNetwork(expected.id);
  }

  function handleIncorrectNetwork() {
    if (!activeChain) return;
    if (activeChain.id !== expected.id) {
      // Since the mainnet launch a wallet can easily sit on the TESTNET
      // entry (46630) which is also named "Robinhood" — so name the chain id
      // and make the click trigger the switch/add prompt directly instead of
      // routing through the modal (kept as fallback for wallets that don't
      // support programmatic switching).
      toast.warn(
        `Wrong network: click here to switch to ${designatedChain} (chain ${expected.id})`,
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
        render: `Switched to ${designatedChain}`,
      });
      closeNetworkModal();
    }
  }

  //handle user on incorrect network
  useEffect(() => {
    handleIncorrectNetwork();
  }, [activeChain?.id, expected.id]);

  return { isNetworkModalOpen, closeNetworkModal, switchToCorrectNetwork, isLoading };
}
