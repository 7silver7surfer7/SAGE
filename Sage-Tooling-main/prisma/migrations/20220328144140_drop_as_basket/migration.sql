/*
  Warnings:

  - The primary key for the `Auction` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `collectionId` on the `Auction` table. All the data in the column will be lost.
  - You are about to drop the column `contractDataFetchedAt` on the `Auction` table. All the data in the column will be lost.
  - You are about to drop the column `nftId` on the `Auction` table. All the data in the column will be lost.
  - The primary key for the `Lottery` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `collectionId` on the `Lottery` table. All the data in the column will be lost.
  - You are about to drop the column `isLive` on the `Lottery` table. All the data in the column will be lost.
  - You are about to drop the column `maxParticipants` on the `Lottery` table. All the data in the column will be lost.
  - You are about to drop the column `collectionId` on the `Nft` table. All the data in the column will be lost.
  - The primary key for the `PrizeProof` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `collectionId` on the `PrizeProof` table. All the data in the column will be lost.
  - You are about to drop the `Collection` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `DirectMint` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `dropId` to the `Auction` table without a default value. This is not possible if the table is not empty.
  - Added the required column `lastUpdatedAt` to the `Auction` table without a default value. This is not possible if the table is not empty.
  - Added the required column `dropId` to the `Lottery` table without a default value. This is not possible if the table is not empty.
  - Added the required column `amount` to the `PrizeProof` table without a default value. This is not possible if the table is not empty.
  - Added the required column `lotteryId` to the `PrizeProof` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Auction" DROP CONSTRAINT "Auction_collectionId_fkey";

-- DropForeignKey
ALTER TABLE "Collection" DROP CONSTRAINT "Collection_approvedBy_fkey";

-- DropForeignKey
ALTER TABLE "Collection" DROP CONSTRAINT "Collection_artistAddress_fkey";

-- DropForeignKey
ALTER TABLE "Collection" DROP CONSTRAINT "Collection_primarySplitterId_fkey";

-- DropForeignKey
ALTER TABLE "Collection" DROP CONSTRAINT "Collection_secondarySplitterId_fkey";

-- DropForeignKey
ALTER TABLE "Collection" DROP CONSTRAINT "Collection_whitelistId_fkey";

-- DropForeignKey
ALTER TABLE "DirectMint" DROP CONSTRAINT "DirectMint_collectionId_fkey";

-- DropForeignKey
ALTER TABLE "Lottery" DROP CONSTRAINT "Lottery_collectionId_fkey";

-- DropForeignKey
ALTER TABLE "Nft" DROP CONSTRAINT "Nft_collectionId_fkey";

-- DropForeignKey
ALTER TABLE "_userFavoriteDrops" DROP CONSTRAINT "_userFavoriteDrops_A_fkey";

-- AlterTable
ALTER TABLE "Auction" DROP CONSTRAINT "Auction_pkey",
DROP COLUMN "collectionId",
DROP COLUMN "contractDataFetchedAt",
DROP COLUMN "nftId",
ADD COLUMN     "dropId" INTEGER NOT NULL,
ADD COLUMN     "id" SERIAL NOT NULL,
ADD COLUMN     "lastUpdatedAt" TIMESTAMP(3) NOT NULL,
ADD CONSTRAINT "Auction_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "Lottery" DROP CONSTRAINT "Lottery_pkey",
DROP COLUMN "collectionId",
DROP COLUMN "isLive",
DROP COLUMN "maxParticipants",
ADD COLUMN     "dropId" INTEGER NOT NULL,
ADD COLUMN     "id" SERIAL NOT NULL,
ADD COLUMN     "maxTickets" INTEGER NOT NULL DEFAULT 0,
ADD CONSTRAINT "Lottery_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "Nft" DROP COLUMN "collectionId",
ADD COLUMN     "auctionId" INTEGER,
ADD COLUMN     "lotteryId" INTEGER;

-- AlterTable
ALTER TABLE "PrizeProof" DROP CONSTRAINT "PrizeProof_pkey",
DROP COLUMN "collectionId",
ADD COLUMN     "amount" INTEGER NOT NULL,
ADD COLUMN     "lotteryId" INTEGER NOT NULL,
ADD CONSTRAINT "PrizeProof_pkey" PRIMARY KEY ("lotteryId", "winnerAddress", "nftId");

-- DropTable
DROP TABLE "Collection";

-- DropTable
DROP TABLE "DirectMint";

-- CreateTable
CREATE TABLE "Drop" (
    "id" SERIAL NOT NULL,
    "primarySplitterId" INTEGER,
    "secondarySplitterId" INTEGER,
    "whitelistId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "royaltyPercentage" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" CHAR(42),
    "bannerImageS3Path" TEXT NOT NULL,
    "dropMetadataCid" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "metadataS3Path" TEXT NOT NULL,
    "tags" TEXT NOT NULL,
    "isLive" BOOLEAN NOT NULL,
    "artistAddress" CHAR(42) NOT NULL,

    CONSTRAINT "Drop_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Drop" ADD CONSTRAINT "Drop_primarySplitterId_fkey" FOREIGN KEY ("primarySplitterId") REFERENCES "Splitter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Drop" ADD CONSTRAINT "Drop_secondarySplitterId_fkey" FOREIGN KEY ("secondarySplitterId") REFERENCES "Splitter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Drop" ADD CONSTRAINT "Drop_whitelistId_fkey" FOREIGN KEY ("whitelistId") REFERENCES "Whitelist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Drop" ADD CONSTRAINT "Drop_artistAddress_fkey" FOREIGN KEY ("artistAddress") REFERENCES "User"("walletAddress") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Drop" ADD CONSTRAINT "Drop_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "User"("walletAddress") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lottery" ADD CONSTRAINT "Lottery_dropId_fkey" FOREIGN KEY ("dropId") REFERENCES "Drop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Auction" ADD CONSTRAINT "Auction_dropId_fkey" FOREIGN KEY ("dropId") REFERENCES "Drop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Nft" ADD CONSTRAINT "Nft_lotteryId_fkey" FOREIGN KEY ("lotteryId") REFERENCES "Lottery"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Nft" ADD CONSTRAINT "Nft_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_userFavoriteDrops" ADD FOREIGN KEY ("A") REFERENCES "Drop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
