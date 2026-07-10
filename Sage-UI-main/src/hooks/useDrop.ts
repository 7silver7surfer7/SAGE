import { Drop, User } from '@prisma/client';
import { formatDateYYMMddHHmm, transformTitle } from '@/utilities/strings';
import useSageRoutes from './useSageRoutes';
import { computeDropStatus } from '@/utilities/status';
import { Lottery_include_Nft, Auction_include_Nft, OpenEdition_include_Nft } from '@/prisma/types';
import { computeDropSystems } from '@/components/Icons/System';

interface Args {
  drop: Drop;
  artist: User;
  Lotteries: Lottery_include_Nft[];
  Auctions: Auction_include_Nft[];
  OpenEditions?: OpenEdition_include_Nft[];
}

export type UseDropArgs = Parameters<typeof useDrop>['0'];

function useDrop({ drop, artist, Lotteries, Auctions, OpenEditions }: Args) {
  const { pushToCreators, pushToDrops } = useSageRoutes();
  const { startTime, endTime, status } = computeDropStatus({ Lotteries, Auctions, OpenEditions });
  const dropName: string = transformTitle(drop.name);
  const artistName: string = transformTitle(artist.username);
  const bannerImgSrc: string = drop.bannerImageS3Path;
  const dropDescription: string = drop.description;
  // const artistLocation: string = artist.state + ',' + artist.country;
  const country: string = artist.country;
  const state: string = artist.state;
  const createdAt = formatDateYYMMddHHmm(drop.createdAt);
  const systemTypes = computeDropSystems({ lottery: Lotteries, auction: Auctions });
  const statusDisplay = status.toLocaleUpperCase();
  function goToDropOnClick() {
    pushToDrops(drop.id);
  }

  function goToArtistOnClick() {
    pushToCreators(artist.username);
  }

  return {
    dropName,
    artistName,
    bannerImgSrc,
    dropDescription,
    startTime,
    endTime,
    status,
    systemTypes,
    createdAt,
    statusDisplay,
    // artistLocation,
    country,
    state,
    goToArtistOnClick,
    goToDropOnClick,
  };
}

export default useDrop;
