import 'react-tabs/style/react-tabs.css';
import { Tab, Tabs, TabList, TabPanel } from 'react-tabs';
import { GamesStatsPanel } from './GamesStatsPanel';
import { UsersPanel } from './UsersPanel';
import { NewDropsPanel } from './NewDropsPanel';

export function DashBoardPage() {
  return (
    <div className='dashboard-page'>
      <Tabs>
        <TabList>
          <Tab>New Drops</Tab>
          <Tab>Games</Tab>
          <Tab>Users</Tab>
        </TabList>
        <TabPanel className='dashboard-panel'>
          <NewDropsPanel />
        </TabPanel>
        <TabPanel className='dashboard-panel'>
          <GamesStatsPanel />
        </TabPanel>
        <TabPanel className='dashboard-panel'>
          <UsersPanel />
        </TabPanel>
      </Tabs>
    </div>
  );
}
