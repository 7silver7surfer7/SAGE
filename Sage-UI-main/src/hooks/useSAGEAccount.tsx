import { parameters } from '@/constants/config';
import { useGetPointsBalanceQuery } from '@/store/pointsReducer';
import { useGetUserQuery } from '@/store/usersReducer';
import { useSession } from 'next-auth/react';
import { useAccount, useBalance, useConnect, useSigner } from 'wagmi';

function formatBalance(balance: number) {
  if (balance > 1_000_000) {
    const millions = balance / 1_000_000;
    return String(millions.toFixed(0)) + 'M';
  }
  if (balance > 10_000) {
    const thousands = balance / 1000;
    return String(thousands.toFixed(0)) + 'K';
  }

  return balance.toFixed(2);
}

export default function useSAGEAccount() {
  const {
    address: walletAddress,
    isConnected: isWalletConnected,
    isConnecting: isWalletConnecting,
  } = useAccount({});
  const { data: userData } = useGetUserQuery();
  const { connect, connectors } = useConnect();
  const { data: signer } = useSigner();
  const { status: sessionStatus, data: sessionData } = useSession();
  const isSignedIn: boolean = sessionStatus === 'authenticated';
  const { data: pointsBalance } = useGetPointsBalanceQuery(undefined, {
    skip: !isSignedIn,
  });
  const { data: walletBalance } = useBalance({
    token: parameters.ASHTOKEN_ADDRESS,
    addressOrName: walletAddress,
  });
  const ashBalance = Number(walletBalance?.formatted);
  const ashBalanceDisplay = isNaN(ashBalance) ? '' : formatBalance(ashBalance);
  const pointsBalanceDisplay = isNaN(Number(pointsBalance)) ? '' : formatBalance(+pointsBalance);

  return {
    isSignedIn,
    isWalletConnected,
    walletAddress,
    userData,
    isWalletConnecting,
    pointsBalance,
    ashBalance,
    ashBalanceDisplay,
    pointsBalanceDisplay,
    connect,
    connectors,
    sessionData,
    signer,
  };
}
