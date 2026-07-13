import type { Router } from 'next/router';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import Nav from '@/components/Layout/Nav';
import Footer from '@/components/Layout/Footer';
import useWatchNetwork from '@/hooks/useWatchNetwork';
import WrongNetworkModal from '@/components/Modals/WrongNetworkModal';
import React, { useEffect } from 'react';
import MobileMenu from '@/components/Mobile/MobileMenu';
import MenuToggle from '@/components/Mobile/MenuToggle';
import useModal from '@/hooks/useModal';
import { useDisconnect } from 'wagmi';
import { useSignOutMutation } from '@/store/usersReducer';
import SageIconSVG from '@/public/branding/sage-icon.svg';
import useSAGEAccount from '@/hooks/useSAGEAccount';
import useSageRoutes from '@/hooks/useSageRoutes';
import useSignIn from '@/hooks/useSignIn';
import Motto from './Motto';

type Props = {
  children: JSX.Element[] | JSX.Element;
  router: Router;
};

export default function Layout({ children, router }: Props) {
  const { isSignedIn, isWalletConnected, walletAddress, sessionData, userData } = useSAGEAccount();
  const { pushToHome, isCreatorsPage, isSingleDropsPage } = useSageRoutes();
  const {
    isNetworkModalOpen,
    closeNetworkModal,
    switchToCorrectNetwork,
    isLoading: isChangingNetwork,
  } = useWatchNetwork();
  const [signOut] = useSignOutMutation();
  const { disconnect } = useDisconnect();
  // App-shell auto sign-in: the instant a wallet connects (via RainbowKit or
  // anywhere) and the session is unauthenticated, prompt the SIWE signature —
  // so connect → pick wallet → sign is ONE flow, not "connect, then click
  // connect again to sign" (the two-click bug).
  useSignIn(true);
  useEffect(() => {
    if (isSignedIn && isWalletConnected && sessionData?.address != walletAddress) {
      signOut();
      disconnect();
      pushToHome();
    }
  }, [isSignedIn, sessionData, walletAddress, isWalletConnected]);
  const {
    closeModal: closeMobileMenu,
    isOpen: isMobileMenuOpen,
    toggleModal: toggleMobileMenu,
  } = useModal(true);

  return (
    <React.Fragment>
      <MobileMenu
        isOpen={isMobileMenuOpen}
        toggleMenu={toggleMobileMenu}
        closeModal={closeMobileMenu}
      ></MobileMenu>
      <WrongNetworkModal
        isOpen={isNetworkModalOpen}
        closeModal={closeNetworkModal}
        switchToCorrectNetwork={switchToCorrectNetwork}
        isLoading={isChangingNetwork}
      />
      <ToastContainer
        position='bottom-center'
        autoClose={2000}
        icon={SageIconSVG}
        hideProgressBar={false}
        newestOnTop={false}
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
        data-cy='toast-container'
      />
      <div key={router.route} className='layout'>
        <Nav />
        <MenuToggle
          isDynamicColors={true}
          isOpen={isMobileMenuOpen}
          toggleMobileMenu={toggleMobileMenu}
        />
        {children}

        <Footer></Footer>
      </div>

      {!isCreatorsPage && !isSingleDropsPage && <Motto />}
    </React.Fragment>
  );
}
