import prisma from '@/prisma/client';
import React, { useState } from 'react';
import { Drop_include_GamesAndArtist, NewArtwork, Nft, User } from '@/prisma/types';
import { getHomePageData } from '@/prisma/functions';
import UpcomingDrops from '@/components/Pages/Home/UpcomingDrops';
import FeaturedDrop from '@/components/Pages/Home/FeaturedDrop';
import LatestArtists from '@/components/Pages/Home/LatestArtists';
import NewArtworks from '@/components/Pages/Home/NewArtworks';
import Logotype from '@/components/Logotype';
import LaunchTrailer from '@/components/LaunchTrailer';
import useSageRoutes from '@/hooks/useSageRoutes';
import useWindowDimensions from '@/hooks/useWindowSize';
import Cover from '@/components/Pages/Home/Cover';

type Props = Awaited<ReturnType<typeof getHomePageData>>;

function home({
  featuredDrop,
  upcomingDrops,
  welcomeMessage,
  latestArtists,
  newArtworks,
}: Props) {
  const { isMobile } = useWindowDimensions();
  // no cover media -> skip the cover entirely so the page isn't hidden behind it
  const [coverOn, setCoverOn] = useState(Boolean(featuredDrop?.featuredMediaS3Path));
  // messages with a comma break onto two lines at the first comma; messages
  // without one render as a single line (no stray trailing comma)
  const [welcomeFirstLine, ...welcomeRest] = welcomeMessage.split(',');
  const welcomeSecondLine = welcomeRest.join(',').trim();
  function removeCover() {
    setCoverOn(false);
    if ('vibrate' in navigator) {
      const vibrates = navigator.vibrate(1000);
    }
  }
  const { pushToCreators, pushToDrops, pushToAgentApi } = useSageRoutes();

  return (
    <div className='home-page' data-cy='home-page' data-on={coverOn}>
      <Cover
        artist={featuredDrop?.NftContract.Artist}
        src={featuredDrop?.featuredMediaS3Path}
        coverOn={coverOn}
        removeCover={removeCover}
      />
      <div data-on={isMobile ? coverOn : false} className='home-page__main'>
        <Logotype></Logotype>
        <LaunchTrailer
          src={featuredDrop?.featuredMediaS3Path}
          onClick={() => {
            pushToDrops(featuredDrop?.id);
          }}
        ></LaunchTrailer>

        {featuredDrop && (
          <div className='home-page__featured-drop-tag-section'>
            <meta property='og:image' content={featuredDrop.bannerImageS3Path} />
            <div className='home-page__featured-drop-tag-info'>
              <span
                className='home-page__featured-drop-tag-label'
                onClick={() => pushToCreators(featuredDrop.NftContract.Artist?.username)}
              >
                {featuredDrop.name} by {featuredDrop.NftContract.Artist?.username}
              </span>
            </div>
          </div>
        )}

        <h1 className='home-page__statement'>
          {welcomeSecondLine ? `${welcomeFirstLine},` : welcomeFirstLine} <pre />{' '}
          {welcomeSecondLine}
        </h1>
        <button className='home-page__agent-api-link' onClick={pushToAgentApi}>
          AI Agent API →
        </button>
        <div className='home-page__upcoming-drops-header'>
          <h1 className='home-page__upcoming-drops-header-left'>drops</h1>
          <div className='home-page__upcoming-drops-header-right'>
            <div className='home-page__upcoming-drops-header-right-dot'></div>
            <h1 className='home-page__upcoming-drops-header-right-text'>
              We only accept SAGE as a medium of exchange. SAGE is the native token of the SAGE
              ecosystem on Robinhood Chain.
            </h1>
          </div>
        </div>
        <UpcomingDrops upcomingDrops={upcomingDrops}></UpcomingDrops>
        <NewArtworks newArtworks={newArtworks}></NewArtworks>
      </div>
    </div>
  );
}

export async function getStaticProps() {
  const { featuredDrop, upcomingDrops, welcomeMessage, newArtworks, latestArtists } =
    await getHomePageData(prisma);
  return {
    props: {
      newArtworks,
      featuredDrop,
      upcomingDrops,
      welcomeMessage,
      latestArtists,
    },
    revalidate: 60,
  };
}

export default home;
