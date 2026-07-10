import React from 'react';
import type { AppProps } from 'next/app';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'react-tabs/style/react-tabs.css';
import 'react-datepicker/dist/react-datepicker.css';
import '../styles/styles.scss';

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <React.Fragment>
      <ToastContainer
        autoClose={false}
        closeOnClick={false}
        hideProgressBar={true}
        position={toast.POSITION.BOTTOM_RIGHT}
      />
      <Component {...pageProps} />
    </React.Fragment>
  );
}

export default MyApp;
