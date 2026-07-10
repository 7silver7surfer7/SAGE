import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/prisma/client';
import aws from 'aws-sdk';
import NextCors from 'nextjs-cors';
import { Role } from '@prisma/client';
import { createUcanRequestToken } from '@/utilities/nftStorage';

const toNumber = (val: string): number => (val ? Number(val) : 0);

/*
 * TODO authenticate requests coming from the (external) upload app
 */
async function handler(request: NextApiRequest, response: NextApiResponse) {
  await NextCors(request, response, {
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
    origin: '*',
    optionsSuccessStatus: 200,
  });
  const {
    query: { action },
  } = request;
  switch (action) {
    case 'CreateS3SignedUrl':
      await createS3SignedUrl(
        request.query.bucket as string,
        request.query.filename as string,
        response
      );
      break;
    case 'CreateNftStorageRequestToken':
      await createNftStorageRequestToken(response);
      break;
    case 'InsertDrop':
      await insertDrop(request.body, response);
      break;
    case 'InsertAuction':
      await insertAuction(request.body, response);
      break;
    case 'InsertDrawing':
      await insertDrawing(request.body, response);
      break;
    case 'InsertNft':
      await insertNft(request.body, response);
      break;
    case 'UpdateDefaultPrize':
      await updateDefaultPrize(request.body, response);
      break;
    case 'UpdateMetadataCid':
      await updateMetadataCid(request.body, response);
      break;
    default:
      response.status(400).json('Bad Request');
  }
  response.end();
}

/**
 * https://github.com/nftstorage/ucan.storage#creating-a-request-token-to-upload-content
 */
async function createNftStorageRequestToken(response: NextApiResponse) {
  try {
    const token = await createUcanRequestToken();
    response.json({ token });
  } catch (e: any) {
    console.log(e);
    response.json({ error: e.message });
  }
  response.end();
}

/**
 * https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#getSignedUrl-property
 */
async function createS3SignedUrl(dropBucket: string, filename: string, response: NextApiResponse) {
  const region = 'us-east-2';
  aws.config.update({
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID_MEMEX || '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY_MEMEX || '',
    },
    signatureVersion: 'v4',
    region,
  });
  const s3 = new aws.S3();
  var params = {
    Bucket: `${process.env.S3_BUCKET}/${dropBucket}`,
    Key: filename,
    Expires: 60,
    ACL: 'public-read',
  };
  const uploadUrl = s3.getSignedUrl('putObject', params);
  const getUrl = `https://${process.env.S3_BUCKET}.s3.${region}.amazonaws.com/${dropBucket}/${filename}`;
  response.json({ uploadUrl, getUrl });
  response.end();
}

async function insertDrop(data: any, response: NextApiResponse) {
  console.log('insertDrop()');
  try {
    var insertData = {
      data: {
        name: data.name,
        description: data.description || '',
        createdAt: new Date(),
        royaltyPercentage: toNumber(data.rltyPercent),
        tags: data.tags || '',
        bannerImageS3Path: data.bannerImageS3Path,
        metadataS3Path: '',
        dropMetadataCid: '',
        Artist: {
          connectOrCreate: {
            where: {
              walletAddress: data.artistWallet,
            },
            create: {
              walletAddress: data.artistWallet,
              role: Role.ARTIST,
            },
          },
        },
        PrimarySplitter: {
          create: {
            SplitterEntries: {
              createMany: {
                data: data.primarySalesSplitEntries,
              },
            },
          },
        },
        SecondarySplitter: {
          create: {
            SplitterEntries: {
              createMany: {
                data: data.royaltySplitEntries,
              },
            },
          },
        },
        Whitelist: null || {},
      },
    };
    /* TODO add whitelist feature
    if ("new" == data.whitelist) {
      insertData.data.Whitelist = {
        create: {
          name: data.whitelistNewEntryName,
          contractAddress: data.whitelistNewEntryToken,
        },
      };
    }
    */
    var record = await prisma.drop.create(insertData);
    response.json({ dropId: record.id });
  } catch (e: any) {
    console.log(e);
    response.json({ error: e.message });
  }
  response.end();
}

async function insertAuction(data: any, response: NextApiResponse) {
  console.log('insertAuction()');
  try {
    var record = await prisma.auction.create({
      data: {
        Drop: {
          connect: {
            id: Number(data.dropId),
          },
        },
        minimumPrice: data.minPrice,
        buyNowPrice: data.buyNowPrice ? data.buyNowPrice : null,
        startTime: new Date(Number(data.startDate) * 1000),
        endTime: new Date(Number(data.endDate) * 1000),
        Nft: {
          create: {
            name: data.name,
            description: data.description || '',
            tags: data.tags || '',
            rarity: '',
            numberOfEditions: 1,
            isVideo: 'true' == data.isVideo,
            ipfsPath: data.ipfsPath,
            s3Path: data.s3Path,
          },
        },
      },
    });
    response.json({ auctionId: record.id, nftId: record.id });
  } catch (e: any) {
    console.log(e);
    response.json({ error: e.message });
  }
  response.end();
}

async function insertNft(data: any, response: NextApiResponse) {
  console.log('insertNft()');
  try {
    var insertData = {
      data: {
        name: data.name,
        description: data.description || '',
        tags: data.tags || '',
        rarity: data.rarity || '',
        numberOfEditions: toNumber(data.numberOfEditions),
        isVideo: 'true' == data.isVideo,
        ipfsPath: data.ipfsPath,
        s3Path: data.s3Path,
        Auction: null || {},
        Lottery: null || {},
      },
    };
    // NFT either belongs to an Auction or to a Lottery
    if (data.auctionId) {
      insertData.data.Auction = {
        connect: {
          id: data.auctionId,
        },
      };
    } else {
      insertData.data.Lottery = {
        connect: {
          id: data.drawingId,
        },
      };
    }
    var record = await prisma.nft.create(insertData);
    response.json({ nftId: record.id });
  } catch (e: any) {
    console.log(e);
    response.json({ error: e.message });
  }
  response.end();
}

async function insertDrawing(data: any, response: NextApiResponse) {
  console.log('insertDrawing()');
  try {
    var record = await prisma.lottery.create({
      data: {
        dropId: Number(data.dropId),
        costPerTicketTokens: toNumber(data.ticketCostCoins),
        costPerTicketPoints: toNumber(data.ticketCostPoints),
        maxTickets: toNumber(data.maxTickets),
        maxTicketsPerUser: toNumber(data.maxTicketsPerUser),
        endTime: new Date(Number(data.endDate) * 1000),
        startTime: new Date(Number(data.startDate) * 1000),
        isRefundable: 'true' == data.isRefundable,
      },
    });
    response.json({ drawingId: record.id });
  } catch (e: any) {
    console.log(e);
    response.json({ error: e.message });
  }
  response.end();
}

async function updateDefaultPrize(data: any, response: NextApiResponse) {
  console.log('updateDefaultPrize()');
  try {
    await prisma.lottery.update({
      where: {
        id: Number(data.drawingId),
      },
      data: {
        defaultPrizeId: Number(data.nftId),
      },
    });
    response.json({ success: true });
  } catch (e: any) {
    console.log(e);
    response.json({ error: e.message });
  }
  response.end();
}

async function updateMetadataCid(data: any, response: NextApiResponse) {
  console.log('updateMetadataCid()');
  try {
    await prisma.drop.update({
      where: {
        id: Number(data.dropId),
      },
      data: {
        dropMetadataCid: data.dropMetadataCid,
      },
    });
    response.json({ success: true });
  } catch (e: any) {
    console.log(e);
    response.json({ error: e.message });
  }
  response.end();
}

export default handler;
