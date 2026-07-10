import { useGetClaimedAuctionNftsQuery } from '@/store/auctionsReducer';
import { useGetClaimedPrizesQuery } from '@/store/prizesReducer';
import { CollectedListingNft, GamePrize } from '@/prisma/types';
import LoaderDots from '@/components/LoaderDots';
import { BaseMedia } from '@/components/Media/BaseMedia';
import { useSession } from 'next-auth/react';
import { useGetListingNftsByOwnerQuery } from '@/store/nftsReducer';
import { Tabs, Tab, TabList, TabPanel } from 'react-tabs';
import Gallery from './Gallery';

interface Props {
  collectionTabIndex: number;
  setCollectionTabIndex: React.Dispatch<React.SetStateAction<number>>;
}

export default function CollectionPanel({ collectionTabIndex, setCollectionTabIndex }: Props) {
  const { data: sessionData } = useSession();
  const { data: claimedPrizes, isFetching: fetchingClaimedPrizes } = useGetClaimedPrizesQuery(
    undefined,
    { skip: !sessionData }
  );
  const { data: claimedAuctionNfts, isFetching: fetchingClaimedAuctionNfts } =
    useGetClaimedAuctionNftsQuery(undefined, { skip: !sessionData });
  const { data: listingNfts, isFetching: fetchingListingNfts } = useGetListingNftsByOwnerQuery(
    undefined,
    { skip: !sessionData }
  );

  if (fetchingClaimedPrizes || fetchingClaimedAuctionNfts || fetchingListingNfts) {
    return <LoaderDots />;
  }

  const myNfts = new Array().concat(claimedAuctionNfts, claimedPrizes, listingNfts);

  return (
    <div className='collection-panel'>
      <Tabs
        selectedIndex={collectionTabIndex}
        onSelect={(index) => {
          setCollectionTabIndex(index);
        }}
        className='collection-panel__tabs'
      >
        <TabList className='collection-panel__tabs-list' as='div'>
          <Tab
            as='div'
            selectedClassName='collection-panel__tabs-tab--selected'
            className='collection-panel__tabs-tab'
          >
            LIST VIEW
          </Tab>
          <Tab
            as='div'
            selectedClassName='collection-panel__tabs-tab--selected'
            className='collection-panel__tabs-tab'
          >
            GALLERY VIEW
          </Tab>
        </TabList>
        <div className='collection-panel__tabs-panels'>
          <TabPanel as='div' className='collection-panel__grid'>
            {!myNfts.length && 'a little bit empty...'}
            {myNfts &&
              myNfts?.map((nft: GamePrize | CollectedListingNft) => {
                if (!nft?.s3PathOptimized) return null;
                return (
                  <>
                    <div key={nft.nftId} className='collection-panel__tile'>
                      <div className='collection-panel__img-container'>
                        <BaseMedia src={nft.s3PathOptimized} isZoomable={true}></BaseMedia>
                      </div>
                      <div className='collection-panel__tile-info'>
                        <p className='collection-panel__tile-nft-name'>{nft.nftName}</p>

                        <p className='collection-panel__tile-artist-name'>
                          by {nft.artistUsername}
                        </p>
                      </div>
                    </div>
                  </>
                );
              })}
          </TabPanel>
          <TabPanel as='div' className='collection-panel__gallery'>
            <Gallery nfts={[...myNfts]}></Gallery>
          </TabPanel>
        </div>
      </Tabs>
    </div>
  );
}
