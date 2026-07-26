import { useGetClaimedAuctionNftsQuery } from '@/store/auctionsReducer';
import { useGetClaimedPrizesQuery } from '@/store/prizesReducer';
import { CollectedListingNft, GamePrize } from '@/prisma/types';
import LoaderDots from '@/components/LoaderDots';
import { BaseMedia } from '@/components/Media/BaseMedia';
import { useSession } from 'next-auth/react';
import { useGetListingNftsByOwnerQuery } from '@/store/nftsReducer';
import { Tabs, Tab, TabList, TabPanel } from 'react-tabs';
import { useRouter } from 'next/router';
import useSAGEAccount from '@/hooks/useSAGEAccount';
import Gallery from './Gallery';
import SocialCollectiblesPanel from './SocialCollectiblesPanel';
import EditionPanel from '@/components/Social/EditionPanel';

interface Props {
  collectionTabIndex: number;
  setCollectionTabIndex: React.Dispatch<React.SetStateAction<number>>;
}

export default function CollectionPanel({ collectionTabIndex, setCollectionTabIndex }: Props) {
  const router = useRouter();
  const { data: sessionData } = useSession();
  const { walletAddress } = useSAGEAccount();
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
                    {/* whole tile navigates to the piece's full view (was an
                        in-place image zoom, which the /nft page supersedes) */}
                    <div
                      key={nft.nftId}
                      className='collection-panel__tile'
                      style={{ cursor: 'pointer' }}
                      onClick={() => router.push(`/nft/${nft.nftId}`)}
                    >
                      <div className='collection-panel__img-container'>
                        <BaseMedia src={nft.s3PathOptimized}></BaseMedia>
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
      <SocialCollectiblesPanel />
      {/*
        Editions this wallet MINTED ITSELF — a 1/1 from the AI chat, a social
        launch, any standalone edition.

        The grid above is built from auction wins, lottery prizes and
        marketplace listings: Nft rows tied to a drop and an NftContract. A
        standalone edition has neither, because prepare_mint deploys its own
        contract outside the drop pipeline — which is what makes it a single
        signature. So self-minted work could never appear there and showed up
        nowhere a creator would look for it.

        EditionPanel already does all of this (live mint counts, halt/unhalt,
        hide) and was only ever rendered on the launcher page. It renders
        nothing when there are no editions, so an empty collection is
        unchanged. showLaunchCta is omitted deliberately: launching belongs on
        the launcher, not as promotion inside someone's own collection.
      */}
      {walletAddress && <EditionPanel address={walletAddress} isSelf />}
    </div>
  );
}
