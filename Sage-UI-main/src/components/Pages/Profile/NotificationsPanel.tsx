import ClaimPrizeButton from './ClaimPrizeButton';
import { formatDateYYMMddHHmm, formatTimestampYYMMddHHmm } from '@/utilities/strings';
import { BaseMedia } from '@/components/Media/BaseMedia';
import usePagination from '@/hooks/usePagination';
import useUserNotifications from '@/hooks/useUserNotifications';
import ClaimRefundButton from './ClaimRefundButton';
import { GamePrize } from '@/prisma/types';
import { Refund } from '@prisma/client';
import { Tabs, TabList, TabPanel, Tab } from 'react-tabs';
import ClaimPanel from './ClaimPanel';
import RefundsPanel from './RefundsPanel';

interface Props {
  subtabIndex: number;
  setSubtabIndex: React.Dispatch<React.SetStateAction<number>>;
}

export default function Notifications({ setSubtabIndex, subtabIndex }: Props) {
  const { prizeNfts, refunds, isLoading } = useUserNotifications();
  const items = prizeNfts && refunds ? [...prizeNfts, ...refunds] : [];

  return (
    <>
      <div className='notifications-panel'>
        <Tabs
          selectedIndex={subtabIndex}
          onSelect={(index) => {
            setSubtabIndex(index);
          }}
        >
          <TabList as='div' className='notifications-panel__tab-list'>
            <Tab
              selectedClassName='notifications-panel__tab-item--selected'
              className='notifications-panel__tab-item'
              as='button'
              style={{ display: 'none' }}
            >
              BIDS
            </Tab>
            <Tab
              selectedClassName='notifications-panel__tab-item--selected'
              className='notifications-panel__tab-item'
              as='button'
              style={{ display: 'none' }}
            >
              SALES
            </Tab>

            <Tab
              selectedClassName='notifications-panel__tab-item--selected'
              className='notifications-panel__tab-item'
              as='button'
            >
              claim
            </Tab>

            <Tab
              selectedClassName='notifications-panel__tab-item--selected'
              className='notifications-panel__tab-item'
              as='button'
            >
              REFUNDS
            </Tab>

            <Tab
              selectedClassName='notifications-panel__tab-item--selected'
              className='notifications-panel__tab-item'
              as='button'
              style={{ display: 'none' }}
            >
              ACTIVITY
            </Tab>
          </TabList>
          <div className='notifications-panel__panels'>
            <TabPanel className='notifications-panel__bids-panel' style={{ display: 'none' }}></TabPanel>
            <TabPanel className='notifications-panel__sales-panel' style={{ display: 'none' }}></TabPanel>
            <TabPanel as='table' className='notifications-panel__claim-panel'>
              <ClaimPanel prizeNfts={prizeNfts}></ClaimPanel>
            </TabPanel>
            <TabPanel as='table' className='notifications-panel__refunds-panel'>
              <RefundsPanel refunds={refunds}></RefundsPanel>
            </TabPanel>
            <TabPanel className='notifications-panel__activity-panel' style={{ display: 'none' }}></TabPanel>
          </div>
        </Tabs>
      </div>
    </>
  );
}
