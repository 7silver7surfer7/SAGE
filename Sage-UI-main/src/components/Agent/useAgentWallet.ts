import { useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { useBalance } from 'wagmi';
import useSAGEAccount from '@/hooks/useSAGEAccount';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { tradeProvider, BUILTIN_TOKENS } from './trade';

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
  /** ethers signer for executing an order the user has confirmed */
  signer: any;
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
  const { isWalletConnected, walletAddress, ashBalanceDisplay, pointsBalanceDisplay, signer } =
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

  /**
   * SAGE read from the TRADING chain, not from `parameters`.
   *
   * useSAGEAccount resolves the token per build mode, so a staging or
   * localhost build reports the testnet balance — while the agent buys the
   * mainnet token. Left alone, a completed purchase would leave this figure
   * unchanged, which reads as a failed buy. Both must name the same asset.
   */
  const [tradeSage, setTradeSage] = useState<string>('');
  useEffect(() => {
    let live = true;
    if (!walletAddress) {
      setTradeSage('');
      return () => {
        live = false;
      };
    }
    new ethers.Contract(
      BUILTIN_TOKENS.SAGE,
      ['function balanceOf(address) view returns (uint256)'],
      tradeProvider()
    )
      .balanceOf(walletAddress)
      .then((bal: ethers.BigNumber) => {
        if (!live) return;
        setTradeSage(
          Number(ethers.utils.formatEther(bal)).toLocaleString('en-US', {
            maximumFractionDigits: 2,
          })
        );
      })
      .catch(() => live && setTradeSage(''));
    return () => {
      live = false;
    };
  }, [walletAddress]);

  return {
    connected,
    signer,
    address: connected ? short(walletAddress) : EMPTY,
    ethLabel: connected && !isNaN(eth) ? eth.toFixed(4) : EMPTY,
    // prefer the trading-chain figure; fall back to the app's own when the
    // mainnet read has not landed yet or failed
    sageLabel: connected ? tradeSage || ashBalanceDisplay || EMPTY : EMPTY,
    // No USDG position is tracked anywhere in the app yet — show it as absent
    // rather than inventing a figure the design happened to mock.
    usdgLabel: EMPTY,
    pixels: connected && pointsBalanceDisplay ? `${pointsBalanceDisplay} PX` : EMPTY,
    connect: () => openConnectModal?.(),
  };
}
