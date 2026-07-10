import Image from 'next/image';
import { GetStaticPropsContext, GetStaticPathsResult, GetStaticPropsResult } from 'next';
import prisma from '@/prisma/client';
import type {
  Drop_include_GamesAndArtist,
  Lottery_include_Nft,
  Auction_include_Nft,
} from '@/prisma/types';
import { Drop as DropType, Nft as NftType } from '@prisma/client';
import DrawingTile from '@/components/Tiles/DrawingTile';
import LotteryTile from '@/components/Tiles/LotteryTile';
import AuctionTile from '@/components/Tiles/AuctionTile';

//determines the type interface received from getStaticProps()
interface Props {
  drop: Drop_include_GamesAndArtist;
}

function filterDrawingsFromLottery(array: Lottery_include_Nft[]) {
  return {
    Drawings: array.filter((l: Lottery_include_Nft) => l.Nfts.length == 1),
    Lotteries: array.filter((l: Lottery_include_Nft) => l.Nfts.length > 1),
  };
}

export default function drop({ drop }: Props) {
  //TODO: restrict access to unapproved drops
  if (!drop) {
    return (
      <div className=''>Oops it appears the drop you are trying to reach is not available</div>
    );
  }
  const { Drawings, Lotteries } = filterDrawingsFromLottery(drop.Lotteries);
  const { Auctions } = drop;
  const hasAuctions: boolean = Auctions.length > 0;
  const hasDrawings: boolean = Drawings.length > 0;
  const hasLotteries: boolean = Lotteries.length > 0;

  //TODO: add admin only functionalities
  //if (!drop.approvedBy && user?.role !== "ADMIN") return null;
  return (
    <div className='drop-page'>
      <div className='drop-page__hero'>
        <Image src={drop.bannerImageS3Path || '/'} layout='fill' objectFit='cover' />
      </div>
      {/* --------------------DROP INFO------------------------ */}
      <section className='drop-page__dropinfo'>
        <div className='drop-page__details'>
          <div className='artist'>
            <div className='artist__pfp'>
              <Image src={drop.Artist.profilePicture || '/sample/pfp.svg'} layout='fill'></Image>
            </div>
            <div className='artist__info'>
              {/* TODO: display using new artist name field */}
              <div className='artist__name'>{drop.Artist.displayName}</div>
              <div className='artist__handle'>@{drop.Artist.username}</div>
            </div>
          </div>
          <div className='description'>
            <h1 className='description__title'>Description Title</h1>
            <p className='description__content'>{drop.description}</p>
          </div>
        </div>
        <div className='drop-page__mechanics'>
          <h1 className='header'>
            <div>
              {hasAuctions && <span>Auctions</span>}
              {hasAuctions && hasDrawings && <span className='header__divider'>×</span>}
              {hasDrawings && <span>Drawings</span>}
            </div>
            <div className='header__ticket-count'>
              {/* TODO: fetch number of tickets user owns */}
              You have {'0'} tickets
            </div>
          </h1>
          <p className='details'>
            This drop includes {hasAuctions && `${Auctions.length} NFTs for auction`}{' '}
            {hasAuctions && hasDrawings && 'and'}{' '}
            {hasDrawings &&
              `${Lotteries.length} individual drawing${Lotteries.length > 1 ? 's' : ''}`}
            . <span>The highest bidder on each auction wins each auction piece.</span>
            <span>
              Drawings are a fair drop mechanic: buy a ticket for each NFT you want to win. After
              the ticket window closes the drop winners will be selected. Come back and see if you
              were drawn.
            </span>
          </p>
          <div className='extra'>
            {hasAuctions && (
              <a className='extra__link' href='#auctions'>
                Auctions Below
              </a>
            )}
            {hasDrawings && (
              <a className='extra__link' href='#drawings'>
                Tickets Below
              </a>
            )}
            {hasLotteries && (
              <a className='extra__link' href='#lotteries'>
                Tickets Below
              </a>
            )}
            {/* TODO:add sub 24 hour till drop closes timer */}
          </div>
        </div>
      </section>
      {/* --------------------LOTTERIES------------------------ */}
      {hasLotteries && (
        <section className='games' id='lotteries'>
          <h1 className='games__title'>Lotteries</h1>
          <div className='games__grid'>
            {Lotteries.map((l: Lottery_include_Nft) => {
              return (
                <LotteryTile lottery={l} artist={drop.Artist} key={l.id} dropName={drop.name} />
              );
            })}
          </div>
        </section>
      )}
      {/* --------------------Drawings------------------------ */}
      {hasDrawings && (
        <section className='games' id='drawings'>
          <h1 className='games__title'>Drawings</h1>
          <div className='games__grid'>
            {Drawings.map((d: Lottery_include_Nft) => {
              return (
                <DrawingTile drawing={d} artist={drop.Artist} key={d.id} dropName={drop.name} />
              );
            })}
          </div>
        </section>
      )}
      {/* --------------------AUCTIONS------------------------ */}
      {hasAuctions && (
        <section className='games' id='auctions'>
          <h1 className='games__title'>Auctions</h1>
          <div className='games__grid'>
            {Auctions.map((a: Auction_include_Nft) => {
              return <AuctionTile auction={a} artist={drop.Artist} key={a.id} />;
            })}
          </div>
        </section>
      )}
    </div>
  );
}

export async function getStaticProps({
  params,
}: GetStaticPropsContext): Promise<GetStaticPropsResult<Props>> {
  const drop: Drop_include_GamesAndArtist | null = await prisma.drop.findFirst({
    include: {
      Lotteries: {
        include: {
          Nfts: true,
        },
      },
      Auctions: {
        include: {
          Nft: true,
        },
      },
      Artist: true,
    },
    where: { id: Number(params!.id) },
  });

  if (!drop) {
    return {
      redirect: {
        destination: '/',
        permanent: false,
      },
    };
  }
  return {
    props: {
      drop,
    },
    revalidate: 60,
  };
}

// This function gets called at build time
export async function getStaticPaths(): Promise<GetStaticPathsResult> {
  const useHeroku = process.env.getDropsFromHeroku;

  let drops: DropType[] = [];
  // Fleek environment variables come in as strings, so gotta check the value this way.
  if (useHeroku === 'true') {
    drops = await prisma.drop.findMany({
      where: {
        approvedAt: {
          not: null,
        },
      },
    });
  } else {
    //const dropsPath = path.join(process.cwd(), "data/drops.json");
    //const someDrops = await fs.readFile(dropsPath, "utf8");
    //drops = JSON.parse(someDrops);
  }

  // Get the paths we want to pre-render based on drops
  const paths = drops.map((drop) => ({
    params: { id: String(drop.id) },
  }));
  // We'll pre-render only these paths at build time.
  // { fallback: blocking } allows for ISR, if a new page is needed for a new drop then the server will serve the page for the first request and cache static html for all future reqeusts
  return { paths, fallback: 'blocking' };
}
