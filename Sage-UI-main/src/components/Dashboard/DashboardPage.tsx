import 'react-tabs/style/react-tabs.css';

import PublicDashboard from '@/components/Dashboard/PublicDashboard';
import { Tab, Tabs, TabList, TabPanel } from 'react-tabs';
import { GamesStatsPanel } from './GamesStatsPanel';
import { UsersPanel } from './UsersPanel';
import { NewDropsPanel } from './NewDropsPanel';
import { AllowlistsPanel } from './AllowlistsPanel';
import { ConfigPanel } from './ConfigPanel';
import PresetDropsPanel from './PresetDropsPanel';
import CreateDropPanel from './CreateDropPanel';
import { Role } from '@prisma/client';
import { useGetUserQuery } from '@/store/usersReducer';
import LoaderDots from '@/components/LoaderDots';
import useSAGEAccount from '@/hooks/useSAGEAccount';

export function DashBoardPage() {
  const isAdmin = (user: any) => {
    return user && Role.ADMIN == user.role;
  };
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

  const { data: user, isFetching: isFetchingUser } = useGetUserQuery(undefined, { skip: !userData });
  // if (isFetchingUser) {
  //   return <LoaderDots />;
  // }
  return (
    <div className='dashboard-page'>
      {!isSignedIn && !isWalletConnecting && <PublicDashboard></PublicDashboard>}
      {isAdmin(user) && (
        <Tabs as='div' className='dashboard-page__tabs'>
          <TabList>
            <Tab className='dashboard-page__tab' selectedClassName='dashboard-page__tab--selected'>
              Create Drop
            </Tab>
            <Tab className='dashboard-page__tab' selectedClassName='dashboard-page__tab--selected'>
              New Drops
            </Tab>
            <Tab className='dashboard-page__tab' selectedClassName='dashboard-page__tab--selected'>
              Allowlists
            </Tab>
            {process.env.NEXT_PUBLIC_APP_MODE !== 'production' && (
              <Tab
                className='dashboard-page__tab'
                selectedClassName='dashboard-page__tab--selected'
              >
                Preset Drops
              </Tab>
            )}
            <Tab className='dashboard-page__tab' selectedClassName='dashboard-page__tab--selected'>
              Games Stats
            </Tab>
            <Tab className='dashboard-page__tab' selectedClassName='dashboard-page__tab--selected'>
              Users
            </Tab>
            <Tab className='dashboard-page__tab' selectedClassName='dashboard-page__tab--selected'>
              Config
            </Tab>
            <Tab className='dashboard-page__tab' selectedClassName='dashboard-page__tab--selected'>
              Roles
            </Tab>
          </TabList>
          <TabPanel className='dashboard-panel'>
            <CreateDropPanel />
          </TabPanel>
          <TabPanel className='dashboard-panel'>
            <NewDropsPanel />
          </TabPanel>
          <TabPanel className='dashboard-panel'>
            <AllowlistsPanel />
          </TabPanel>
          {process.env.NEXT_PUBLIC_APP_MODE !== 'production' && (
            <TabPanel className='dashboard-panel'>
              <PresetDropsPanel />
            </TabPanel>
          )}
          <TabPanel className='dashboard-panel'>
            <GamesStatsPanel />
          </TabPanel>
          <TabPanel className='dashboard-panel'>
            <UsersPanel />
          </TabPanel>
          <TabPanel className='dashboard-panel'>
            <ConfigPanel />
          </TabPanel>
          <TabPanel className='dashboard-panel'>
            <PublicDashboard />
          </TabPanel>
        </Tabs>
      )}
    </div>
  );
}
