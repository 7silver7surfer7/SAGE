import { getCsrfToken, useSession } from 'next-auth/react';
import { SiweMessage } from 'siwe';
import { useSignInMutation } from '@/store/usersReducer';
import { useEffect, useRef, useState } from 'react';
import { useAccount, useNetwork, useSignMessage, useSwitchNetwork } from 'wagmi';
import { parameters } from '@/constants/config';

//This hook is dependent on a certain mounted component, and prompts a
//secure authentication to Sage using Sign In With Ethereum 4361

/**
 * @param autoPrompt when true, SIWE fires automatically as soon as the wallet
 * is connected and the session is unauthenticated — regardless of any modal.
 * Mount ONE instance with autoPrompt=true at the app shell (Layout) so
 * connecting a wallet (via RainbowKit or anywhere) leads straight into the
 * sign-in signature with no second click. Other mounts pass false and just
 * use handleSignInClick for a manual button.
 */
export default function useSignIn(autoPrompt: boolean) {
  const { chain: activeChain } = useNetwork();
  const { address, isConnected } = useAccount();
  const { signMessageAsync, isLoading: isSigningMessage } = useSignMessage();
  const { switchNetworkAsync } = useSwitchNetwork();
  const [signIn] = useSignInMutation();
  const { status: sessionStatus } = useSession();
  const [error, setError] = useState<string | null>(null);
  // one-shot guard so the auto-prompt fires once per open+connect, not in a loop
  const hasPromptedRef = useRef(false);

  async function handleSignInClick() {
    try {
      setError(null);
      if (!address) return;
      // Sign-in OWNS the network switch: signing while the wallet sat on
      // another chain (Ledger defaults to Ethereum mainnet) minted a session
      // whose every subsequent action failed until the user noticed the
      // separate wrong-network toast — the "flaky sign-in" of 2026-07-12.
      // Switch first (one extra wallet prompt, and wagmi adds the chain if
      // the wallet lacks it); if the wallet can't or the user declines, say
      // exactly what to do instead of proceeding into a broken state.
      const chainId = Number(parameters.CHAIN_ID);
      if (activeChain && activeChain.id !== chainId) {
        try {
          await switchNetworkAsync?.(chainId);
        } catch {
          setError(
            `Switch your wallet to ${parameters.NETWORK_NAME} (chain ${chainId}) and try again.`
          );
          return;
        }
      }
      const issuedAt = new Date().toISOString();
      const nonce = await getCsrfToken();
      const message = new SiweMessage({
        domain: window.location.host,
        address: address,
        statement: 'I accept the SAGE Terms of Service and Privacy Policy.',
        uri: window.location.origin,
        version: '1',
        chainId,
        nonce,
        issuedAt,
      });
      const signature = await signMessageAsync({
        message: message.prepareMessage(),
      });

      await signIn({ message, signature });
    } catch (error) {
      console.error(error);
      setError('Sign-in was cancelled or failed. Please try again.');
    }
  }

  // reset the one-shot guard when auto-prompt turns off or the wallet drops
  useEffect(() => {
    if (!autoPrompt || !isConnected) hasPromptedRef.current = false;
  }, [autoPrompt, isConnected]);

  // Auto-prompt SIWE once the wallet is connected and the session has resolved
  // to unauthenticated. sessionStatus and isSigningMessage MUST be
  // dependencies: if the session is still 'loading' at connect time and
  // they're omitted, the effect never re-runs when it resolves, so the prompt
  // silently never fires.
  useEffect(() => {
    const shouldPromptSignIn: boolean =
      !isSigningMessage && autoPrompt && isConnected && sessionStatus === 'unauthenticated';
    if (shouldPromptSignIn && !hasPromptedRef.current) {
      hasPromptedRef.current = true;
      handleSignInClick();
    }
  }, [autoPrompt, isConnected, sessionStatus, isSigningMessage]);

  return { isSigningMessage, handleSignInClick, error };
}
