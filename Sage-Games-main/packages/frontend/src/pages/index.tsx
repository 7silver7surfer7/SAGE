import prisma from '@/prisma/client';
import React from 'react';
// Import carousel css files
import 'slick-carousel/slick/slick.css';
import 'slick-carousel/slick/slick-theme.css';
import Slider from 'react-slick';

import { Drop_include_GamesAndArtist } from '@/prisma/types';
import Drop from '@/components/Drop';
import Link from 'next/link';
import AWS from 'aws-sdk';

interface BannerType {
  imagePath: string;
  link: string;
}

function createBanner(imagePath: string, link: string): BannerType {
  return { imagePath, link };
}

const banners: BannerType[] = [];

const sliderSettings = {
  dots: true,
  infinite: true,
  speed: 500,
  adaptiveHeight: true,
  slidesToShow: 1,
  autoplay: true,
  arrows: false,
  slidesToScroll: 1,
};

interface Props {
  drops: Drop_include_GamesAndArtist[];
  useS3: boolean;
}

function home({ drops, useS3 }: Props) {
  return (
    <div id='home-page'>
      <Slider {...sliderSettings} className='banner-slider'>
        {banners.map((b) => {
          const src = `/banners/${b.imagePath}`;
          return (
            <a key={b.imagePath} href={b.link} target='_blank'>
              <img className='banner-image' src={src} />
            </a>
          );
        })}
      </Slider>
      <h1 id='header'>Available Drops</h1>
      <div id='featured-drops'>
        {drops.map((d: Drop_include_GamesAndArtist) => {
          return <Drop drop={d} key={d.id} />;
        })}
      </div>
      {
        // <div id='explore-all'>
        //   <Link href='/drops'>
        //     <button>Explore all drops</button>
        //   </Link>
        // </div>
      }
    </div>
  );
}

export async function getStaticProps() {
  const useHeroku = process.env.getDropsFromHeroku || 'false';
  const getImagesFromS3 = process.env.getImagesFromS3 || 'false';
  const s3Bucket = process.env.S3_BUCKET || '';
  const awsAccessKeyId = process.env.AWS_ACCESS_KEY_ID_MEMEX || '';
  const awsSecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY_MEMEX || '';

  let drops: Drop_include_GamesAndArtist[] = [];

  // Fleek environment variables come in as strings, so gotta check the value this way.
  if (useHeroku === 'true') {
    drops = await prisma.drop.findMany({
      where: { approvedAt: { not: null } },
      include: {
        Artist: true,
        Lotteries: { include: { Nfts: true } },
        Auctions: { include: { Nft: true } },
      },
    });
  } else {
    AWS.config.update({
      credentials: {
        accessKeyId: awsAccessKeyId,
        secretAccessKey: awsSecretAccessKey,
      },
      region: 'us-east-1',
    });

    var s3 = new AWS.S3({
      params: {
        Bucket: s3Bucket,
      },
    });

    const targetBucket = s3Bucket + '/currentDrops';

    s3.getObject(
      {
        Bucket: targetBucket,
        Key: 'drops.json',
      },
      function (err, response) {
        if (err) {
          console.log('Something went wrong while trying to load drops.json from S3...', err);
        } else {
          if (response.Body) {
            console.log('Found drops from S3.');
            const asString = response.Body.toString('utf-8');
            const asJson = JSON.parse(asString);
            drops = asJson;
          }
        }
      }
    );

    // Need this here to give the S3 getObject operation enough time to complete.
    // Otherwise allDrops will remain null.
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return {
    props: {
      drops: drops,
      useS3: getImagesFromS3,
    },
    revalidate: 60,
  };
}

export default home;
