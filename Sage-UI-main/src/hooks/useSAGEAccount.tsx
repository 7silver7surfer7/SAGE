import {
  parameters,
  PIXELS_TOKEN_ADDRESS,
  PIXELS_LEGACY_TOKEN_ADDRESS,
  PIXELS_MIGRATION_ENDS_AT,
} from '@/constants/config';
import { LEGACY_PIXEL_RATIO } from '@/constants/pixels';
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
  // The token Pixels actually accrue from. `parameters.ASHTOKEN_ADDRESS` is
  // still the legacy one, so without this read the profile would price a rate
  // off a balance that no longer earns.
  const { data: pixelTokenBalance } = useBalance({
    token: PIXELS_TOKEN_ADDRESS,
    addressOrName: walletAddress,
    enabled: !!walletAddress,
  });
  const { data: legacyPixelBalance } = useBalance({
    token: PIXELS_LEGACY_TOKEN_ADDRESS,
    addressOrName: walletAddress,
    enabled: !!walletAddress,
  });

  const ashBalance = Number(walletBalance?.formatted);
  const ashBalanceDisplay = isNaN(ashBalance) ? '' : formatBalance(ashBalance);

  /**
   * The balance Pixels are computed from, in CURRENT-token units.
   *
   * Mirrors liveSageWhole() in utilities/pixelsLedger.ts exactly: while the
   * migration window is open both tokens count and the BETTER one wins —
   * never the sum, so a wallet holding both cannot show double the rate it
   * will actually be paid. After the window only the current token counts.
   */
  const currentPixelTokens = Number(pixelTokenBalance?.formatted) || 0;
  const legacyPixelTokens = Number(legacyPixelBalance?.formatted) || 0;
  const migrationWindowOpen = new Date() < PIXELS_MIGRATION_ENDS_AT;
  const legacyEquivalent = migrationWindowOpen ? legacyPixelTokens * LEGACY_PIXEL_RATIO : 0;
  const pixelEarningBalance = Math.max(currentPixelTokens, legacyEquivalent);
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
    /** whole tokens the pixel rate is computed from — see pixelEarningBalance */
    pixelEarningBalance,
    currentPixelTokens,
    legacyPixelTokens,
    migrationWindowOpen,
    pointsBalanceDisplay,
    connect,
    connectors,
    sessionData,
    signer,
  };
}
