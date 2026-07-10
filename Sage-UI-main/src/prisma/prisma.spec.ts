import {
  getArtistsPageData,
  getDropsPageData,
  getHomePageData,
  getIndividualArtistsPageData,
  getIndividualArtistsPagePaths,
  getIndividualDropsPageData,
  getIndividualDropsPagePaths,
} from './functions';
import { assert, expect } from 'chai';
import prisma from './client';
import { parameters } from '../constants/config';
import { Role } from '@prisma/client';

const { LOTTERY_ADDRESS, AUCTION_ADDRESS } = parameters;

console.log('Running mocha tests using config: ', process.env.NEXT_PUBLIC_APP_MODE);
Object.keys(parameters).forEach((key) => {
  console.log(`${key} = ${parameters[key]}`);
});

describe('Data fetching', async () => {
  after(() => {
    console.log('Test run complete, closing prisma instance...');
    prisma
      .$disconnect()
      .then(() => console.log('Successfully disconnected'))
      .catch(() => console.error('Failed to disconnect'));
  });

  describe('"/" (home page) data fetching', () => {
    type HomePageData = Awaited<ReturnType<typeof getHomePageData>>;
    type UpcomingDrops = HomePageData['upcomingDrops'];
    type FeaturedDrop = HomePageData['featuredDrop'];
    type Drops = HomePageData['drops'];
    type Drop = Drops[number];
    let upcomingDrops: UpcomingDrops;
    let featuredDrop: FeaturedDrop;
    let drops: Drops;

    before(async () => {
      const data = await getHomePageData(prisma);
      upcomingDrops = data.upcomingDrops;
      drops = data.drops;
    });

    it('Featured drop is not null', async () => {
      assert.isNotNull(featuredDrop);
    });

    describe('Drops include required display info', async () => {
      it('Artist', async () => {
        drops.forEach((d) => {
          assert.isNotNull(d.NftContract.Artist);
        });
      });
      it('Drop name', async () => {
        drops.forEach((d) => {
          assert.isNotNull(d.name);
        });
      });
      it('Banner image', async () => {
        drops.forEach((d) => {
          assert.isNotNull(d.bannerImageS3Path);
        });
      });
      it('Games', async () => {
        drops.forEach((d) => {
          d.Lotteries.forEach((l) => {
            assert.isNotNull(l);
            assert.isNotNull(l.endTime);
            assert.isNotNull(l.startTime);
          });
          d.Auctions.forEach((a) => {
            assert.isNotNull(a);
            assert.isNotNull(a.endTime);
            assert.isNotNull(a.startTime);
          });
        });
      });
    });

    it('Drops are approved', async () => {
      drops.forEach((d) => {
        assert.isNotNull(d.approvedBy);
        assert.isNotNull(d.approvedAt);
      });
    });

    it('Drops ordered by most recently created first', async () => {
      let dropA: Drop;
      let dropB: Drop;
      if (drops.length < 2) return;
      for (let i = 1; i < drops.length; i++) {
        dropA = drops[i - 1];
        dropB = drops[i];
        if (!dropB.approvedAt) continue;
        expect(dropA.approvedAt).least(dropB.approvedAt);
      }
    });

    it('Fetched drops should have games with valid contract addresses', async () => {
      drops.forEach((d) => {
        d.Lotteries.forEach(({ contractAddress }) => {
          assert.isNotNull(contractAddress);
          assert.deepEqual(contractAddress, LOTTERY_ADDRESS);
        });
        d.Auctions.forEach(({ contractAddress }) => {
          assert.isNotNull(contractAddress);
          assert.deepEqual(contractAddress, AUCTION_ADDRESS);
        });
      });
    });
  });

  describe('"/drops" (drops page) data fetching', () => {
    type Drops = Awaited<ReturnType<typeof getDropsPageData>>;
    type Drop = Drops[number];
    let drops: Drops;

    before(async () => {
      drops = await getDropsPageData(prisma);
    });

    it('Drops are approved', async () => {
      drops.forEach((d) => {
        assert.isNotNull(d.approvedBy);
        assert.isNotNull(d.approvedAt);
      });
    });

    it('Drops ordered by most recently created first', async () => {
      let dropA: Drop;
      let dropB: Drop;
      if (drops.length < 2) return;
      for (let i = 1; i < drops.length; i++) {
        dropA = drops[i - 1];
        dropB = drops[i];
        if (!dropB.approvedAt) continue;
        expect(dropA.approvedAt).least(dropB.approvedAt);
      }
    });

    it('Drops include required display info', async () => {
      drops.forEach((d) => {
        assert.isNotNull(d.name);
        assert.isNotNull(d.bannerImageS3Path);
        assert.isNotNull(d.NftContract.Artist);
        assert.isNotNull(d.NftContract.Artist.username);
        assert.isNotNull(d.Lotteries);
        assert.isNotNull(d.Auctions);
      });
    });

    it('Fetched drops should have games with valid contract addresses', async () => {
      drops.forEach((d) => {
        d.Lotteries.forEach(({ contractAddress }) => {
          assert.isNotNull(contractAddress);
          assert.deepEqual(contractAddress, LOTTERY_ADDRESS);
        });
        d.Auctions.forEach(({ contractAddress }) => {
          assert.isNotNull(contractAddress);
          assert.deepEqual(contractAddress, AUCTION_ADDRESS);
        });
      });
    });
  });

  describe('/drops/[id] (individual drop page) data fetching', () => {
    type Drop = Awaited<ReturnType<typeof getIndividualDropsPageData>>;
    type Paths = Awaited<ReturnType<typeof getIndividualDropsPagePaths>>;
    let paths: Paths;
    let drop: Drop;

    before(async () => {
      paths = await getIndividualDropsPagePaths(prisma);
      const randomSamplePathIndex = Math.floor(Math.random() * +paths.length);
      const randomSamplePath = Number(paths[randomSamplePathIndex].params.id);
      drop = await getIndividualDropsPageData(prisma, randomSamplePath);
    });

    beforeEach(() => {
      if (paths.length < 1) return;
    });

    it('Valid drop should be found', () => {
      assert.isNotNull(drop);
    });

    it('Drop should be approved', () => {
      assert.isNotNull(drop?.approvedBy);
      assert.isNotNull(drop?.approvedAt);
    });

    describe('Drop include required display info', () => {
      it('drop name', () => {
        assert.isNotNull(drop?.name);
      });
      it('banner image s3 path', () => {
        assert.isNotNull(drop?.bannerImageS3Path);
      });
      it('artist', () => {
        assert.isNotNull(drop?.NftContract?.Artist);
        assert.isNotNull(drop?.NftContract?.Artist.username);
      });
      it('games', () => {
        assert.isNotNull(drop?.Lotteries);
        assert.isNotNull(drop?.Auctions);
        drop?.Lotteries.forEach(({ Nfts }) => {
          assert.isNotNull(Nfts);
          assert.isAtLeast(Nfts.length, 1);
        });
        drop?.Auctions.forEach(({ Nft }) => {
          assert.isNotNull(Nft);
        });
      });
    });
  });
  describe('/artists (multi artists page) data fetching', () => {
    type Artists = Awaited<ReturnType<typeof getArtistsPageData>>;
    let artists: Artists;

    before(async () => {
      artists = await getArtistsPageData(prisma);
    });

    beforeEach(() => {
      if (artists.length < 1) return;
    });

    it('Users fetched should have artist role', () => {
      artists.forEach((a) => {
        assert.deepEqual(a.role, Role.ARTIST);
      });
    });

    describe('Artist info required for display should be available', () => {
      it('bio', () => {
        artists.forEach(({ bio }) => {
          assert.isNotNull(bio);
        });
      });
      it('display name', () => {
        artists.forEach(({ username }) => {
          assert.isNotNull(username);
        });
      });
      it('walletaddress ', () => {
        artists.forEach(({ walletAddress }) => {
          assert.isNotNull(walletAddress);
        });
      });
    });
  });
  describe('/artist/[id] (individual artists page) data fetching', () => {
    type Paths = Awaited<ReturnType<typeof getIndividualArtistsPagePaths>>;
    type Artist = Awaited<ReturnType<typeof getIndividualArtistsPageData>>;
    let artist: Artist;
    let paths: Paths;

    before(async () => {
      paths = await getIndividualArtistsPagePaths(prisma);
      const randomArtistId = String(paths[Math.floor(Math.random() * paths.length)].params.id);
      artist = await getIndividualArtistsPageData(prisma, randomArtistId);
    });

    beforeEach(() => {
      if (paths.length < 1) return;
    });

    it('User fetched should have artist role', () => {
      assert.deepEqual(artist?.role, Role.ARTIST);
    });
    describe('Artist info required for display should be available', () => {
      it('bio', () => {
        assert.isNotNull(artist?.bio);
      });
      it('username', () => {
        assert.isNotNull(artist?.username);
      });
    });
  });
});
