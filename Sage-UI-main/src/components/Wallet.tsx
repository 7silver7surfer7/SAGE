import { PfpImage } from './Media/BaseMedia';
import CloseSVG from '@/public/interactive/close.svg';
import SageFullLogo from '@/public/branding/sage-full-logo.svg';
import Modal, { Props as ModalProps } from '@/components/Modals';
import { useDisconnect } from 'wagmi';
import Image from 'next/image';
import PersonalizedMessage from './PersonalizedMessage';
import useSignIn from '@/hooks/useSignIn';
import WalletConnectSVG from '@/public/icons/walletconnect.svg';
import MetamaskSVG from '@/public/icons/metamask.svg';
import useSAGEAccount from '@/hooks/useSAGEAccount';
import useSageRoutes from '@/hooks/useSageRoutes';
import ProfileDisplay from './ProfileDisplay';
import { useSignOutMutation } from '@/store/usersReducer';
import useWindowDimensions from '@/hooks/useWindowSize';

interface Props {
  closeModal?: ModalProps['closeModal'];
  isOpen: ModalProps['isOpen'];
}

/**
 * wagmi's injected connector reports "Unknown Wallet" for extensions that
 * don't flag as MetaMask — identify the common ones from their provider
 * flags so users never see a scary UNKNOWN button (reported by a real user).
 */
function detectInjectedWalletName(): string {
  const eth: any = typeof window !== 'undefined' ? (window as any).ethereum : undefined;
  if (!eth) return 'Browser Wallet';
  const candidates: [string, string][] = [
    ['isRabby', 'Rabby'],
    ['isBraveWallet', 'Brave Wallet'],
    ['isCoinbaseWallet', 'Coinbase Wallet'],
    ['isOkxWallet', 'OKX Wallet'],
    ['isZerion', 'Zerion'],
    ['isTrust', 'Trust Wallet'],
    ['isFrame', 'Frame'],
    ['isPhantom', 'Phantom'],
    ['isMetaMask', 'MetaMask'], // last: many wallets fake this flag
  ];
  for (const [flag, name] of candidates) {
    if (eth[flag]) return name;
  }
  return 'Browser Wallet';
}

export default function Wallet({ closeModal, isOpen }: Props) {
  const {
    isSignedIn,
    isWalletConnected,
    isWalletConnecting,
    userData,
    ashBalanceDisplay,
    pointsBalanceDisplay,
    connect,
    connectors,
  } = useSAGEAccount();
  const { pushToProfile, pushToMintCreation, pushToCollection, pushToHome } = useSageRoutes();
  const showWalletSelection: boolean = Boolean(!isWalletConnected);
  const showSignInPrompt: boolean = Boolean(isWalletConnected && !isSignedIn);
  const showAuthSection: boolean = Boolean(isWalletConnected && isSignedIn);
  const [signOut] = useSignOutMutation();
  // autoPrompt=false: the app-shell instance (Layout) owns auto sign-in; this
  // one only powers the manual "SIGN IN" button so they can't double-fire
  const { isSigningMessage, handleSignInClick, error: signInError } = useSignIn(false);
  const { disconnect } = useDisconnect();
  const { isMobile } = useWindowDimensions();

  async function handleSignOut() {
    signOut();
    disconnect();
    pushToHome();
    closeModal();
  }

  function handleCancelSignIn() {
    disconnect();
    closeModal();
  }

  return (
    <div className='wallet__wrapper'>
      {/* the panel fills the viewport on mobile, hiding the modal backdrop —
          without an explicit close control there's no way to dismiss it */}
      <button
        type='button'
        aria-label='Close'
        className='wallet__close-button'
        onClick={closeModal}
      >
        <CloseSVG className='wallet__close-button-svg' />
      </button>
      <div className='wallet'>
        <div className='wallet__user-section-wrapper'>
          {showWalletSelection && (
            <section className='wallet__wallets '>
              {connectors
                .filter((c) => !(isMobile && c.name === 'WalletConnect'))
                .map((c) => {
                  // mobile browsers have no injected provider, so the MetaMask
                  // connector is never "ready" there — instead of hiding the
                  // button, deep-link this page into the MetaMask app's dapp
                  // browser, where the provider IS injected
                  const useMetaMaskDeepLink = !c.ready && isMobile && c.id === 'injected';
                  if (!c.ready && !useMetaMaskDeepLink) return null;
                  const displayName = useMetaMaskDeepLink
                    ? 'MetaMask'
                    : /unknown/i.test(c.name)
                    ? detectInjectedWalletName()
                    : c.name;
                  function onClick() {
                    if (useMetaMaskDeepLink) {
                      window.location.href = `https://metamask.app.link/dapp/${window.location.host}${window.location.pathname}${window.location.search}`;
                      return;
                    }
                    connect({ connector: c });
                  }
                  // class-safe variant: names can contain spaces ("Brave Wallet")
                  const className = `wallet__wallet-item wallet__${displayName.replace(/[^A-Za-z0-9]/g, '')}`;
                  return (
                    <button
                      className={className}
                      key={c.id}
                      disabled={isWalletConnecting}
                      data-loading={isWalletConnecting && 'true'}
                      onClick={onClick}
                    >
                      {displayName == 'MetaMask' && (
                        <>
                          <MetamaskSVG className='wallet__wallet-icon' />
                        </>
                      )}

                      {displayName == 'WalletConnect' && (
                        <>
                          <WalletConnectSVG className='wallet__wallet-icon' />
                        </>
                      )}
                      <p className='wallet__wallet-item-name'>{displayName}</p>
                    </button>
                  );
                })}
              <p className='wallet__agreement-text'>
                By connecting your wallet, you agree to our Terms of Service and Privacy Policy.
              </p>
            </section>
          )}
          {showSignInPrompt && (
            <section className='wallet__signin'>
              <p className='wallet__signin-message'>
                Sign the message in your wallet to securely sign in to SAGE.
              </p>
              {!isSigningMessage && (
                <button
                  className='wallet__wallet-item wallet__signin-button'
                  onClick={handleSignInClick}
                >
                  <p className='wallet__wallet-item-name'>SIGN IN</p>
                </button>
              )}
              {signInError && <p className='wallet__signin-error'>{signInError}</p>}
              <button className='wallet__signin-cancel' onClick={handleCancelSignIn}>
                CANCEL
              </button>
            </section>
          )}
          {showAuthSection && (
            <>
              {/* <section className='wallet__user-section'>
              <div className='wallet__user-pfp-container' onClick={pushToProfile}>
                <PfpImage
                  className='wallet__user-pfp-src'
                  src={userData?.profilePicture}
                ></PfpImage>
              </div>
              <div className='wallet__user-connection-indicator'></div>
              <div className='wallet__user-metamask-container'>
                <Image
                  layout='fill'
                  className='wallet__user-metamask-src'
                  src={'/icons/metamask.svg'}
                ></Image>
              </div>
            </section>
            <section className='wallet__utils-section'>
              <div className='wallet__utils-info'>
                <h1 className='wallet__token-balance'>
                  ash balance:
                  <span>pixel balance: </span>
                </h1>
                <h1 className='wallet__points-balance'>
                  <span className='wallet__points-value'>{ashBalanceDisplay}</span>
                  <span className='wallet__points-value'>{pointsBalanceDisplay}</span>
                </h1>
              </div>
              {isSignedIn && (
                <button onClick={pushToProfile} className='wallet__interact-button'>
                  PROFILE
                </button>
              )}
            </section> */}
              <div className='wallet__user-section'>
                <button
                  onClick={() => {
                    pushToProfile();
                    closeModal();
                  }}
                  className='wallet__user-section-button'
                >
                  YOUR PROFILE
                </button>
                {/* 
              <button onClick={pushToMintCreation} className='wallet__user-section-button'>
                MINT CREATION
              </button>
              <button onClick={pushToCollection} className='wallet__user-section-button'>
                COLLECTION
              </button>

              <button className='wallet__user-section-button'>NOTIFICATIONS</button> */}

                <button onClick={handleSignOut} className='wallet__user-section-logout-button'>
                  LOG OUT
                </button>
              </div>
            </>
          )}

          {showAuthSection && (
            <div className='wallet__profile-display-container'>
              <ProfileDisplay onNavigate={closeModal}></ProfileDisplay>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
