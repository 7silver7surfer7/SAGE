import pkg from '@prisma/client';
import fs from 'fs-extra';

const { PrismaClient } = pkg;

const prisma = new PrismaClient()

async function save(drop) {
  let nftsAsData = [];

    drop.nfts.forEach(nft => {
      nftsAsData.push({
        name: nft.name,
        description: nft.description,
        rarity: nft.rarity,
        ipfsPath: nft.ipfsPath,
        s3Path: nft.s3Path
      });
    });

    const someDrop = await prisma.drop.create({
      data: {
        lotteryId: drop.lotteryId,
        bannerImageIpfsPath: drop.banner.ipfsPath,
        bannerImageS3Path: drop.banner.s3Path,
        bannerImageName: drop.banner.name,
        metadataIpfsPath: drop.metadataIpfsPath,
        metadataS3Path: drop.metadataS3Path,
        costPerTicket: drop.costPerTicket,
        prizes: drop.prizes,
        prizeMetadataCid: drop.prizeMetadataCid,
        startTime: drop.startTime,
        endTime: drop.endTime,
        artistName: drop.artistName,
        dropName: drop.dropName,
        dropDescription: drop.dropDescription,
        Nft: {
          createMany: {
            data: nftsAsData
          }
        }
      }
    });

    return someDrop;
}

async function main() {
  const dropsJson = JSON.parse(fs.readFileSync('drops.json', 'utf8'));

  for (const drop of dropsJson) {
    const someDrop = await save(drop);

    console.log('someDrop was saved: ', someDrop);
  }

  console.log('done saving drops to db...');

  const drops = await prisma.drop.findMany({
    include: {
      Nft: true
    }
  });

  console.log('drops: ', drops);

  prisma.$disconnect();
}

main()
  .catch((e) => {
    throw e
  })
  .finally(async () => {
    await prisma.$disconnect()
  })