import { parameters } from '../constants/config';
import { ArtistSales, Drop_include_GamesAndArtist, User } from '@/prisma/types';
import { PrismaClient, Prisma, Role } from '@prisma/client';
import { BigNumber, Contract, providers } from 'ethers';

// Matches NftDisplaySelect in prisma/types/index.d.ts — keep them in sync.
// The public drop/homepage/listing tiles + mint/bid modals only ever read
// this subset of Nft; a bare `include: { Nft: true }` was dragging
// arweavePath/tags/price/ownerAddress/etc. into every homepage load,
// drops-listing load, and drop-detail load for no reason.
const NFT_DISPLAY_SELECT = {
  id: true,
  name: true,
  description: true,
  s3Path: true,
  s3PathOptimized: true,
  mediaType: true,
  numberOfEditions: true,
  width: true,
  height: true,
  metadataPath: true,
  artistDisplayName: true,
} as const;

// Shared by getHomePageData / getDropsPageData / getIndividualDropsPageData —
// same tile components render all three, so they need the same shape.
const DROP_INCLUDES = {
  NftContract: { include: { Artist: true } },
  Lotteries: { include: { Nfts: { select: NFT_DISPLAY_SELECT } } },
  Auctions: { include: { Nft: { select: NFT_DISPLAY_SELECT } } },
  OpenEditions: { include: { Nft: { select: NFT_DISPLAY_SELECT } } },
  CollectionMints: true as const,
};

// A drop is publicly visible once approved AND its go-live timer (if any) has
// passed. Must be a function so `new Date()` is evaluated per query, not once
// at module load.
// A drop is only showable once at least one of its games actually deployed
// on-chain — an approved-but-gameless row (an aborted self-serve launch) used
// to render an UNKNOWN tile that 404'd on click.
const FilterDropHasDeployedGame: Prisma.DropWhereInput = {
  OR: [
    { Auctions: { some: { contractAddress: { not: null } } } },
    { Lotteries: { some: { contractAddress: { not: null } } } },
    { OpenEditions: { some: { contractAddress: { not: null } } } },
    { CollectionMints: { some: { contractAddress: { not: null } } } },
  ],
};

function filterDropApprovedOnly(): Prisma.DropWhereInput {
  return {
    approvedAt: { not: null },
    OR: [{ goLiveAt: null }, { goLiveAt: { lte: new Date() } }],
  };
}

const FilterDropContractValidation: Prisma.DropWhereInput = {
  Lotteries: { every: { contractAddress: { not: null, equals: parameters.LOTTERY_ADDRESS } } },
  Auctions: { every: { contractAddress: { not: null, equals: parameters.AUCTION_ADDRESS } } },
};

const FilterUserIsArtist: Prisma.UserWhereInput = {
  role: Role.ARTIST,
};

// A drop may set its own artistDisplayName at creation time (frozen — doesn't
// track later profile renames, doesn't apply to the wallet's other drops).
// When present, the drop presents a fully drop-scoped artist identity: the
// display name replaces the username AND the wallet-profile's personal fields
// (location, bio, socials) are scrubbed, so e.g. an admin deploying a drop
// under an artist pseudonym doesn't leak their own profile details onto the
// drop page. The underlying User row is never modified.
export function withArtistDisplayNameOverride<
  T extends {
    artistDisplayName?: string | null;
    NftContract?: { Artist?: { username: string | null } | null } | null;
  }
>(drop: T): T {
  if (drop?.artistDisplayName && drop.NftContract?.Artist) {
    drop.NftContract.Artist = { ...drop.NftContract.Artist, username: drop.artistDisplayName };
    Object.assign(drop.NftContract.Artist, {
      country: null,
      state: null,
      bio: null,
      email: null,
      twitterUsername: null,
      instagramUsername: null,
      mediumUsername: null,
      webpage: null,
    });
  }
  return drop;
}

/**
 * Best-effort refresh of cached CollectionMint.mintCount from chain. The
 * cached value normally only updates when a minter's browser completes the
 * post-mint registration call, so mints whose registration never lands
 * (closed tab, direct on-chain mints) leave the DB undercounting forever —
 * rMonet sat at 91/100 cached while the contract said 100/100, keeping a
 * sold-out drop badged LIVE on the homepage. Runs server-side during ISR
 * regeneration (throttled by each page's `revalidate`), only reads
 * collections that still look unsold, patches the in-memory rows so the
 * CURRENT render is already correct, and never throws.
 */
async function syncCollectionMintCounts(
  prisma: PrismaClient,
  drops: (Drop_include_GamesAndArtist | null | undefined)[]
) {
  const pending = drops
    .flatMap((d) => ((d as any)?.CollectionMints || []) as any[])
    .filter((cm) => cm.contractAddress && cm.maxSupply > 0 && cm.mintCount < cm.maxSupply);
  if (pending.length === 0) return;
  try {
    const provider = new providers.StaticJsonRpcProvider(parameters.RPC_URL, +parameters.CHAIN_ID);
    await Promise.all(
      pending.map(async (cm) => {
        try {
          const collection = new Contract(
            cm.contractAddress,
            ['function getMintCount(uint256) view returns (uint32)'],
            provider
          );
          const onChain = Number(await collection.getMintCount(cm.collectionId ?? cm.id));
          if (onChain !== cm.mintCount) {
            await prisma.collectionMint.update({
              where: { id: cm.id },
              data: { mintCount: onChain },
            });
            cm.mintCount = onChain;
          }
        } catch (e) {
          console.error(`mintCount sync failed for collection ${cm.id}`, e);
        }
      })
    );
  } catch (e) {
    console.error('mintCount sync skipped', e);
  }
}

export async function getHomePageData(prisma: PrismaClient) {
  let drops: Drop_include_GamesAndArtist[] = await prisma.drop.findMany({
    where: { ...filterDropApprovedOnly(), ...FilterDropHasDeployedGame },
    include: DROP_INCLUDES,
    orderBy: { approvedAt: 'desc' },
    take: 8,
  });
  drops.forEach(withArtistDisplayNameOverride);
  const config = await prisma.config.findFirst({
    include: { FeaturedDrop: { include: DROP_INCLUDES } },
  });
  if (config?.FeaturedDrop) withArtistDisplayNameOverride(config.FeaturedDrop);
  await syncCollectionMintCounts(prisma, [...drops, config?.FeaturedDrop as any]);
  const latestArtists = await prisma.user.findMany({
    where: { role: Role.ARTIST },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  const welcomeMessage = config
    ? config.welcomeMessage
    : 'THE FIRST AI-NATIVE NFT PLATFORM BUILT ON ROBINHOOD CHAIN.';
  // Only show the featured-drop tag when an admin has explicitly chosen one
  // in the Config panel — do not fall back to "most recently approved," which
  // shows an unintended drop tag on the homepage with no admin action behind it.
  const featuredDrop = config?.FeaturedDrop ?? null;
  return { featuredDrop, upcomingDrops: drops, drops, welcomeMessage, latestArtists };
}

export async function getDropsPageData(prisma: PrismaClient) {
  const drops = await prisma.drop.findMany({
    orderBy: { approvedAt: 'desc' },
    include: DROP_INCLUDES,
    where: {
      ...FilterDropContractValidation,
      ...filterDropApprovedOnly(),
      ...FilterDropHasDeployedGame,
    },
    take: 10,
  });

  drops.forEach(withArtistDisplayNameOverride);
  await syncCollectionMintCounts(prisma, drops);
  return drops;
}

export type DropPageData = Awaited<ReturnType<typeof getIndividualDropsPageData>>;

export async function getIndividualDropsPagePaths(prisma: PrismaClient) {
  let drops = await prisma.drop.findMany({
    where: {
      ...filterDropApprovedOnly(),
      ...FilterDropContractValidation,
    },
    // only .id is used below — this ran as a full-row fetch of every
    // approved drop (banner paths, description, everything) on every build
    // and every ISR revalidation, just to list ids for getStaticPaths.
    select: { id: true },
  });

  const paths = drops.map((drop) => ({
    params: { id: String(drop.id) },
  }));

  return paths;
}

export async function getIndividualDropsPageData(prisma: PrismaClient, id: number) {
  const drop = await prisma.drop.findFirst({
    include: DROP_INCLUDES,
    where: {
      id,
      ...filterDropApprovedOnly(),
      ...FilterDropContractValidation,
    },
  });

  if (drop) withArtistDisplayNameOverride(drop);
  return drop;
}

export async function getArtistsPageData(prisma: PrismaClient) {
  // find artists who have deployed drops or minted a listing
  var query = `
    select distinct "artistAddress" from "Drop" where "approvedAt" is not null and ("goLiveAt" is null or "goLiveAt" <= now())
    union
    select distinct "artistAddress" from "Nft" where "artistAddress" is not null`;
  var result = await prisma.$queryRaw(Prisma.raw(query));
  const artistWallets = (result as any).map((row: any) => ({
    walletAddress: row.artistAddress,
  }));
  return await prisma.user.findMany({
    where: { OR: artistWallets, bannerImageS3Path: { not: null } },
    take: 20,
  });
}

export async function getIndividualArtistsPagePaths(prisma: PrismaClient) {
  let artists = await prisma.user.findMany({
    // artists without a username have no page URL — String(null) used to
    // prerender a literal /creators/null and crash the whole build
    where: { ...FilterUserIsArtist, username: { not: null } },
    take: 20,
  });

  const paths = artists.map((artist) => ({
    params: { id: String(artist.username) },
  }));

  return paths;
}

export async function getIndividualArtistsPageData(prisma: PrismaClient, username: string) {
  const artist = await prisma.user.findFirst({
    where: { ...FilterUserIsArtist, username },
    include: { NftContract: true },
  });
  // unknown/renamed artist: the page 404s on a null artist — don't crash here
  if (!artist) {
    return { artist: null, drops: [] };
  }
  const drops = await prisma.drop.findMany({
    where: { artistAddress: artist.walletAddress },
  });
  return { artist, drops };
}

export async function getArtistsSalesData(prisma: PrismaClient) {
  const salesData = new Map<string, ArtistSales>();
  // get list of artists' usernames, wallets and nft counts from all games, including listings
  var query = `
    select "u"."walletAddress", "u"."username", "u"."profilePicture", 
	    coalesce("a"."auctionCount", 0) + coalesce("b"."lotteryCount", 0) + coalesce("c"."listingCount", 0) as "nftCount"
    from "User" as "u" 
    left join (
      select "artistAddress", count(*) as "auctionCount" from "Drop", "Auction"
      where ("Auction"."dropId" = "Drop"."id") and ("Auction"."settled" = true) group by "Drop"."artistAddress"
    ) as "a" on ("u"."walletAddress" = "a"."artistAddress")
    left join (
      select "Drop"."artistAddress", count(*) as "lotteryCount" from "Drop", "Lottery", "Nft"
      where ("Lottery"."dropId" = "Drop"."id") and ("Nft"."lotteryId" = "Lottery"."id") group by "Drop"."artistAddress"
    ) as "b" on ("u"."walletAddress" = "b"."artistAddress")
    left join (
      select "artistAddress", count(*) as "listingCount" from "Nft" 
      where ("ownerAddress" is not null) and ("artistAddress" is not null) group by "artistAddress"
    ) as "c" on ("u"."walletAddress" = "c"."artistAddress")
    where "u"."role" = 'ARTIST'`;
  var result = await prisma.$queryRaw(Prisma.raw(query));
  for (const row of result as any) {
    salesData.set(row.walletAddress, (<ArtistSales>{
      username: String(row.username),
      walletAddress: String(row.walletAddress),
      nftCountTotal: Number(row.nftCount),
      amountTotalUSD: 0,
      highestSaleUSD: 0,
      profilePicture: row.profilePicture,
    }) as ArtistSales);
  }

  // query sales statistics
  query = `
    select "seller", sum(coalesce("amountUSD", 0)) as "amount"
    from "SaleEvent" group by ("eventType", "eventId", "seller")`;
  result = await prisma.$queryRaw(Prisma.raw(query));
  for (const row of result as any) {
    const item = salesData.get(row.seller);
    item.amountTotalUSD += row.amount;
    if (row.amount > item.highestSaleUSD) {
      item.highestSaleUSD = row.amount;
    }
  }

  return salesData;
}
