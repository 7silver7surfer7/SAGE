import React, { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import LoaderDots from '@/components/LoaderDots';
import useTabs from '@/hooks/useTabs';
import ProfilePanel from '@/components/Pages/Profile/ProfilePanel';
import CollectionPanel from '@/components/Pages/Profile/CollectionPanel';
import NotificationsPanel from '@/components/Pages/Profile/NotificationsPanel';
import Balances from '@/components/Pages/Profile/Balances';
import CreationsPanel from '@/components/Pages/Profile/CreationsPanel';
import SageFullLogoSVG from '@/public/branding/sage-full-logo.svg';
import { useGetUserQuery, useSignOutMutation } from '@/store/usersReducer';
import { useRouter } from 'next/router';
import { useDisconnect } from 'wagmi';
import { PfpImage } from '@/components/Media/BaseMedia';
import useUserNotifications from '@/hooks/useUserNotifications';
import { Tab, TabList, TabPanel, Tabs } from 'react-tabs';
import ProfileDisplay from '@/components/ProfileDisplay';
import useSageRoutes from '@/hooks/useSageRoutes';
import Logotype from '@/components/Logotype';

type Headers =
  | 'IN AND OUTGOING BIDS'
  | 'YOUR SALES'
  | 'CLAIM YOUR WINS'
  | 'YOUR REFUNDS FROM DRAWINGS'
  | 'ALL YOUR ACTIVITIES ON SAGE'
  | 'YOUR SALES'
  | 'YOUR OFFERS'
  | 'EDIT YOUR PROFILE'
  | 'UPLOAD AN ARTWORK'
  | 'COLLECTION';

function parseQuery(queryString) {
  var query = {};
  var pairs = (queryString[0] === '?' ? queryString.substr(1) : queryString).split('&');
  for (var i = 0; i < pairs.length; i++) {
    var pair = pairs[i].split('=');
    query[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1] || '');
  }
  return query;
}

function profile() {
  const router = useRouter();
  const { pushToHome } = useSageRoutes();
  const { data: sessionData } = useSession();
  const { data: userData, isFetching: isFetchingUser } = useGetUserQuery(undefined, {
    skip: !sessionData,
  });
  const [signOut] = useSignOutMutation();
  const { selectedTabIndex, setSelectedTabIndex } = useTabs();
  const { selectedTabIndex: subtabIndex, setSelectedTabIndex: setSubtabIndex } = useTabs();
  const { disconnect } = useDisconnect();
  const { asPath } = useRouter();
  const { notificationCount, hasNotifications } = useUserNotifications();
  const [header, setHeader] = useState<Headers>('EDIT YOUR PROFILE');
  useEffect(() => {
    if (selectedTabIndex == 0) setHeader('EDIT YOUR PROFILE');
    if (selectedTabIndex == 1) {
      setHeader('COLLECTION');
    }
    if (selectedTabIndex == 2) {
      // if (subtabIndex == 0) {
      //   setHeader('YOUR OFFERS');
      // }
      // if (subtabIndex == 1) {
      //   setHeader('YOUR SALES');
      // }
      if (subtabIndex == 2) {
        setHeader('CLAIM YOUR WINS');
      }

      if (subtabIndex == 3) {
        setHeader('YOUR REFUNDS FROM DRAWINGS');
      }

      // if (subtabIndex == 4) {
      //   setHeader('ALL YOUR ACTIVITIES ON SAGE');
      // }
    }
    if (selectedTabIndex == 3) {
      setHeader('UPLOAD AN ARTWORK');
    }
  }, [selectedTabIndex, subtabIndex]);

  async function handleSignOut() {
    signOut();
    disconnect();
    pushToHome();
  }

  if (!userData && isFetchingUser) {
    return <LoaderDots />;
  }

  const isArtist: boolean = userData?.role === 'ARTIST';

  return (
    <Tabs
      className='profile-page'
      selectedIndex={selectedTabIndex}
      onSelect={(index) => {
        setSelectedTabIndex(index);
      }}
    >
      <section className='profile-page__upper'>
        <Logotype></Logotype>
        {/* <div className='profile-page__logotype-container'>
          <SageFullLogoSVG
            onClick={() => router.push('/')}
            className='profile-page__sage-logo-svg'
          />
        </div> */}
        <Balances />
      </section>
      <h1 className='profile-page__header'>{header}</h1>
      <section className='profile-page__main'>
        <div className='profile-page__left'>
          <ProfileDisplay></ProfileDisplay>
          <TabList className='profile-page__tabs'>
            <Tab
              as={'button'}
              className='profile-page__tabs-tab'
              selectedClassName='profile-page__tabs-tab--selected'
            >
              profile
            </Tab>
            <Tab
              as={'button'}
              className='profile-page__tabs-tab'
              selectedClassName='profile-page__tabs-tab--selected'
              onClick={() => {
                setSubtabIndex(0);
              }}
            >
              collection
            </Tab>

            <Tab
              as={'button'}
              className='profile-page__tabs-tab'
              selectedClassName='profile-page__tabs-tab--selected'
              onClick={() => {
                setSubtabIndex(2);
              }}
            >
              notifications
              {hasNotifications && (
                <span className='profile-page__tabs-tab-notifications-counter'>
                  {notificationCount}
                </span>
              )}
            </Tab>

            {isArtist && (
              <Tab
                as={'button'}
                disabled={!isArtist}
                className='profile-page__tabs-tab'
                selectedClassName='profile-page__tabs-tab--selected'
              >
                MINT
              </Tab>
            )}
            <button onClick={handleSignOut} className=' profile-page__log-out-btn'>
              log out
            </button>
          </TabList>
        </div>
        <div className='profile-page__right'>
          <TabPanel
            selectedClassName='profile-page__tabs-panel--selected'
            as='div'
            className='profile-page__tabs-panel'
          >
            <ProfilePanel isArtist={isArtist} />
          </TabPanel>
          <TabPanel
            as='div'
            selectedClassName='profile-page__tabs-panel--selected'
            className='profile-page__tabs-panel'
          >
            <CollectionPanel
              collectionTabIndex={subtabIndex}
              setCollectionTabIndex={setSubtabIndex}
            />
          </TabPanel>
          <TabPanel
            as='div'
            selectedClassName='profile-page__tabs-panel--selected'
            className='profile-page__tabs-panel'
          >
            <NotificationsPanel subtabIndex={subtabIndex} setSubtabIndex={setSubtabIndex} />
          </TabPanel>
          {isArtist && (
            <TabPanel
              as='div'
              selectedClassName='profile-page__tabs-panel--selected'
              className='profile-page__tabs-panel'
            >
              <CreationsPanel user={userData} />
            </TabPanel>
          )}
        </div>
      </section>
    </Tabs>
  );
}

export default profile;
