import { getHomePageData } from '@/prisma/functions';
import React from 'react';
import { computeDropStatus } from '@/utilities/status';
import { BaseMedia, PfpImage } from '@/components/Media/BaseMedia';
import Countdown from '@/components/Countdown';
import useWindowDimensions from '@/hooks/useWindowSize';
import useSageRoutes from '@/hooks/useSageRoutes';
import { transformTitle } from '@/utilities/strings';
import useDrop, { UseDropArgs } from '@/hooks/useDrop';
import useCountdown from '@/hooks/useCountdown';

interface Props {
  upcomingDrops: Awaited<ReturnType<typeof getHomePageData>>['upcomingDrops'];
}

export default function UpcomingDrops({ upcomingDrops }: Props) {
  const { pushToDrops } = useSageRoutes();
  const { isMobile } = useWindowDimensions();
  if (isMobile) {
    const midPoint: number = Math.floor(upcomingDrops.length / 2);
    const rowData1 = upcomingDrops.slice(0, midPoint);
    const rowData2 = upcomingDrops.slice(midPoint, upcomingDrops.length);
    const rows = new Array(rowData1, rowData2);
    return (
      <React.Fragment>
        {rows.map((row, i: number) => {
          return (
            <div key={i} className='home-page__upcoming-drops-grid--mobile'>
              <div className='home-page__upcoming-drops-row--mobile'>
                {row.map((d) => {
                  return (
                    <UpcomingDropsTile
                      Lotteries={d.Lotteries}
                      Auctions={d.Auctions}
                      OpenEditions={d.OpenEditions}
                      CollectionMints={(d as any).CollectionMints}
                      drop={d}
                      artist={d.NftContract.Artist}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </React.Fragment>
    );
  }
  return (
    <div className='home-page__upcoming-drops-grid'>
      {upcomingDrops.map((d, i: number) => {
        if (i > 3) return null;
        const src = d.bannerImageS3Path;
        let shouldTileSpanTwoColumns: boolean = false;
        const isIndexEven = Boolean(i % 2 === 0);
        const nextIndexNull = Boolean(!upcomingDrops[i + 1]);
        if (isIndexEven && nextIndexNull) {
          shouldTileSpanTwoColumns = true;
        }
        function onClick() {
          pushToDrops(d.id);
        }
        return (
          <UpcomingDropsTile
            key={d.id}
            Lotteries={d.Lotteries}
            Auctions={d.Auctions}
            OpenEditions={d.OpenEditions}
            CollectionMints={(d as any).CollectionMints}
            drop={d}
            artist={d.NftContract.Artist}
          />
        );
      })}
    </div>
  );
}

interface UpcomingDropsTileProps extends UseDropArgs {}

function UpcomingDropsTile(props: UpcomingDropsTileProps) {
  const {
    goToDropOnClick,
    status: dropStatus,
    soldOut,
    statusDisplay,
    bannerImgSrc,
    startTime,
    endTime,
    artistName,
    dropName,
  } = useDrop(props);
  const { displayValue: openingTime } = useCountdown({ targetDate: startTime });
  return (
    <div className='home-page__upcoming-drops-tile' onClick={goToDropOnClick}>
      {/* Done drops carry no badge — except a sold-out collection, which is
          the strongest social proof a drop can show */}
      {(dropStatus !== 'Done' || soldOut) && (
        <div
          className='home-page__upcoming-drops-countdown'
          data-status={soldOut ? 'SoldOut' : dropStatus}
        >
          {dropStatus === 'Upcoming' ? openingTime : statusDisplay}
        </div>
      )}
      <BaseMedia src={bannerImgSrc} />
      <div className='home-page__upcoming-drops-tile-tag'>
        {/* <div className='home-page__upcoming-drops-tile-pfp'>
          <PfpImage src={props.artist.profilePicture}></PfpImage>
        </div> */}
        <span className='home-page__upcoming-drops-tile-item-name'>
          {dropName}
          <pre />
          <i className='home-page__upcoming-drops-tile-artist-name'>by {artistName}</i>
        </span>
      </div>
    </div>
  );
}
