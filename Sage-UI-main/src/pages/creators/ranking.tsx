import Logotype from '@/components/Logotype';
import { PfpImage } from '@/components/Media/BaseMedia';
import { Tab, Tabs, TabList, TabPanel } from 'react-tabs';
import prisma from '@/prisma/client';
import { getArtistsSalesData } from '@/prisma/functions';
import { ArtistSales } from '@/prisma/types';
import BurgerDotsSVG from '@/public/icons/burger-dots.svg';
import BurgerSVG from '@/public/icons/burger.svg';
import ListItem from '@/components/Pages/Artists/Ranking/ListItem';

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

interface Props {
  salesData: Map<string, ArtistSales>;
}

export default function ranking({ salesData }: Props) {
  const displayData = Array.from(salesData.values()).sort(
    (a, b) => b.amountTotalUSD - a.amountTotalUSD
  );
  return (
    <Tabs  className='ranking-page'>
      <Logotype />
      <div className='ranking-page__header-container'>
        <div className='ranking-page__header-left'>
          <h1 className='ranking-page__header'>
            Top Creators On <pre /> The Blockchain
          </h1>
          <span className='ranking-page__subheader'>Based On Global Sales Data</span>
        </div>
        <div className='ranking-page__tabs'>
          <TabList className='ranking-page__tablist'>
            <Tab className='ranking-page__tab'>
              <BurgerDotsSVG />
              <span>Artist View</span>
            </Tab>
            <Tab className='ranking-page__tab'>
              <BurgerSVG />
              <span>List View</span>
            </Tab>
          </TabList>
        </div>
      </div>
      <section className='ranking-page__main-section'>
        <TabPanel className='ranking-page__grid'>
          {displayData.slice(0, 100).map((data) => {
            return (
              <div key={data.walletAddress} className='ranking-page__grid-item'>
                <PfpImage src={data.profilePicture || null} ></PfpImage>
              </div>
            );
          })}
        </TabPanel>
        <TabPanel className='ranking-page__list'>
          {displayData.slice(0, 100).map((data) => {
            return <ListItem data={data} key={data.username || ''} />;
          })}
        </TabPanel>
      </section>
      {/*
      <table className='ranking-page__table'>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Artist</th>
            <th>Total Artwork Value</th>
            <th>Artworks Sold</th>
            <th>Highest Sale</th>
            <th>Average Sale</th>
          </tr>
        </thead>
        <tbody>
          {displayData.slice(0, 10).map((item, i) => {
            const avgSale = item.amountTotalUSD / item.nftCountTotal;
            return (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>{item.username}</td>
                <td>{usdFormatter.format(item.amountTotalUSD)}</td>
                <td>{item.nftCountTotal}</td>
                <td>{usdFormatter.format(item.highestSaleUSD)}</td>
                <td>{isNaN(avgSale) || avgSale == 0 ? '-' : usdFormatter.format(avgSale)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
*/}
    </Tabs>
  );
}

export async function getStaticProps() {
  const salesData = await getArtistsSalesData(prisma);
  return {
    props: { salesData },
    revalidate: 600,
  };
}
