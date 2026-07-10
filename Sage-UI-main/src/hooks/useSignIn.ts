import { getCsrfToken, useSession } from 'next-auth/react';
import { SiweMessage } from 'siwe';
import { useSignInMutation } from '@/store/usersReducer';
import { useEffect, useRef, useState } from 'react';
import { useAccount, useNetwork, useSignMessage } from 'wagmi';
import { parameters } from '@/constants/config';

//This hook is dependent on a certain mounted component, and prompts a
//secure authentication to Sage using Sign In With Ethereum 4361

export default function useSignIn(isOpen: boolean) {
  const { chain: activeChain } = useNetwork();
  const { address, isConnected } = useAccount();
  const { signMessageAsync, isLoading: isSigningMessage } = useSignMessage();
  const [signIn] = useSignInMutation();
  const { status: sessionStatus } = useSession();
  const [error, setError] = useState<string | null>(null);
  // one-shot guard so the auto-prompt fires once per open+connect, not in a loop
  const hasPromptedRef = useRef(false);

  async function handleSignInClick() {
    try {
      setError(null);
      if (!address) return;
      // fall back to the configured chain so a missing/undefined activeChain
      // (wallet still settling) can't silently abort sign-in
      const chainId = activeChain?.id ?? Number(parameters.CHAIN_ID);
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

  // reset the one-shot guard when the modal closes or the wallet disconnects
  useEffect(() => {
    if (!isOpen || !isConnected) hasPromptedRef.current = false;
  }, [isOpen, isConnected]);

  // Auto-prompt SIWE once the wallet is connected, the modal is open, and the
  // session has resolved to unauthenticated. sessionStatus and isSigningMessage
  // MUST be dependencies: if the session is still 'loading' at connect time and
  // they're omitted, the effect never re-runs when it resolves, so the prompt
  // silently never fires and the modal is stuck on a blank opaque screen.
  useEffect(() => {
    const shouldPromptSignIn: boolean =
      !isSigningMessage && isOpen && isConnected && sessionStatus === 'unauthenticated';
    if (shouldPromptSignIn && !hasPromptedRef.current) {
      hasPromptedRef.current = true;
      handleSignInClick();
    }
  }, [isOpen, isConnected, sessionStatus, isSigningMessage]);

  return { isSigningMessage, handleSignInClick, error };
}
