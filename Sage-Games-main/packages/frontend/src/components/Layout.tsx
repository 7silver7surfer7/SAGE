import React from 'react';
import Head from 'next/head';
import type { Router } from 'next/router';
import variants from '@/animations/index';
import { motion } from 'framer-motion';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import Nav from '@/components/Nav';
import Footer from '@/components/Footer';

type Props = {
  children: JSX.Element[] | JSX.Element;
  router: Router;
};

export default function Layout({ children, router }: Props) {
  return (
    <div className='layout'>
      <Head>
        <title>SAGE Marketplace</title>
        <link rel='icon' href='/' />
      </Head>
      <ToastContainer
        position='bottom-center'
        autoClose={5000}
        hideProgressBar={false}
        newestOnTop={false}
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
      />
      <Nav />
      <motion.div
			key={router.route}
			initial='pageInitial'
        animate='pageAnimate'
        exit='pageInitial'
        variants={variants}
        id='main'
      >
        {children}
        <Footer />
      </motion.div>
    </div>
  );
}
