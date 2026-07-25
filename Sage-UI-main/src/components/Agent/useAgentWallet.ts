import { useBalance } from 'wagmi';
import useSAGEAccount from '@/hooks/useSAGEAccount';
import { useConnectModal } from '@rainbow-me/rainbowkit';

/**
 * Real wallet figures for the agent rail and its wallet card.
 *
 * Everything here comes from the app's existing account plumbing rather than a
 * second source of truth: useSAGEAccount already owns the SAGE (ASHTOKEN)
 * balance and the pixels balance, and RainbowKit owns the connect flow. The
 * only thing it does not expose is the NATIVE balance, so that is the one
 * extra useBalance call below.
 *
 * Disconnected wallets render an em dash rather than a zero — "0.0000 ETH" for
 * someone who simply has not connected is a false statement about their
 * holdings, and the design already distinguishes the two states.
 */
const EMPTY = '—';

export interface AgentWallet {
  connected: boolean;
  /** shortened for display, e.g. 0x7F3a…9C21 */
  address: string;
  ethLabel: string;
  sageLabel: string;
  usdgLabel: string;
  pixels: string;
  connect: () => void;
}

function short(addr?: string) {
  if (!addr) return EMPTY;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function useAgentWallet(): AgentWallet {
  const { isWalletConnected, walletAddress, ashBalanceDisplay, pointsBalanceDisplay } =
    useSAGEAccount();
  const { openConnectModal } = useConnectModal();

  // native balance — the one figure useSAGEAccount doesn't carry
  const { data: native } = useBalance({
    addressOrName: walletAddress,
    // wagmi still fires with an undefined address; skip the RPC until we have one
    enabled: !!walletAddress,
  });

  const connected = !!isWalletConnected && !!walletAddress;
  const eth = Number(native?.formatted);

  return {
    connected,
    address: connected ? short(walletAddress) : EMPTY,
    ethLabel: connected && !isNaN(eth) ? eth.toFixed(4) : EMPTY,
    sageLabel: connected && ashBalanceDisplay ? ashBalanceDisplay : EMPTY,
    // No USDG position is tracked anywhere in the app yet — show it as absent
    // rather than inventing a figure the design happened to mock.
    usdgLabel: EMPTY,
    pixels: connected && pointsBalanceDisplay ? `${pointsBalanceDisplay} PX` : EMPTY,
    connect: () => openConnectModal?.(),
  };
}
