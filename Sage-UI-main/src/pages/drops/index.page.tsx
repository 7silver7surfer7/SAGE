import React from 'react';
import { GetStaticPropsContext, GetStaticPropsResult } from 'next';
import Logotype from '@/components/Logotype';
import { Lottery_include_Nft } from '@/prisma/types';
import prisma from '@/prisma/client';
import { getDropsPageData } from '@/prisma/functions';
import DropItem from '@/components/Pages/Drops/DropItem';

interface Props {
  drops: Awaited<ReturnType<typeof getDropsPageData>>;
}

function drops({ drops }: Props) {
  return (
    <div className='drops-page'>
      <section className='drops-page__header'>
        <Logotype />
        <div className='drops-page__subheader'>
          <div className='drops-page__subheader-top'>
            <div className='drops-page__subheader-content'>
              <h1 className='drops-page__subheader-label'>UPCOMING AND LIVE DROPS</h1>
              <h2 className='drops-page__subheader-info'>
                HIGHLIGHTING THE LEADING ARTISTS FOR THE COMMUNITY TO COLLECT ON SAGE.
              </h2>
            </div>
          </div>
        </div>
      </section>
      <section className='drops-page__drops-section'>
        {drops.map((d) => {
          return (
            <DropItem
              key={d.id}
              drop={d}
              Lotteries={d.Lotteries}
              Auctions={d.Auctions}
              OpenEditions={d.OpenEditions}
              artist={d.NftContract.Artist}
            />
          );
        })}
      </section>
    </div>
  );
}

export default drops;

export async function getStaticProps(
  _context: GetStaticPropsContext
): Promise<GetStaticPropsResult<Props>> {
  const drops = await getDropsPageData(prisma);

  return {
    props: {
      drops,
    },
    revalidate: 300, // re-generate every 5 minutes
  };
}
