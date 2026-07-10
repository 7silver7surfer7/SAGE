import { ArtistSales } from '@/prisma/types';
import { PfpImage } from '@/components/Media/BaseMedia';
import { Line, LineChart } from 'recharts';

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

interface Props {
  data: ArtistSales;
}

export default function ListItem({ data }: Props) {
  // const chartData = [{}];

  const chartData = [
    {
      name: 'Page A',
      uv: 4000,
      pv: 2400,
      amt: 2400,
    },
    {
      name: 'Page B',
      uv: 3000,
      pv: 1398,
      amt: 2210,
    },
    {
      name: 'Page C',
      uv: 2000,
      pv: 9800,
      amt: 2290,
    },
    {
      name: 'Page D',
      uv: 2780,
      pv: 3908,
      amt: 2000,
    },
    {
      name: 'Page E',
      uv: 1890,
      pv: 4800,
      amt: 2181,
    },
  ];
  return (
    <div className='ranking-page__list-item'>
      <div className='ranking-page__list-item-pfp-container'>
        <PfpImage src={data.profilePicture}></PfpImage>
      </div>

      <div className='ranking-page__list-item-info-container'>
        <p className='ranking-page__list-item-header'>{data.username}</p>
        <p className='ranking-page__list-item-subheader'>
          Total Artwork Value <pre /> {usdFormatter.format(data.amountTotalUSD || 0)}
        </p>
      </div>
      <LineChart width={200} height={80} data={chartData}>
        <Line type='monotone' dataKey='pv' stroke='#8884d8' strokeWidth={2} />
      </LineChart>
      <div className='ranking-page__list-item-info-container'>
        <p className='ranking-page__list-item-header'>LATEST</p>
        <p className='ranking-page__list-item-subheader'>
          artworks <pre /> sold
        </p>
      </div>

      <div className='ranking-page__list-item-artwork-slide'>
        <div className='ranking-page__list-item-artwork-slide-item'></div>
      </div>
    </div>
  );
}
