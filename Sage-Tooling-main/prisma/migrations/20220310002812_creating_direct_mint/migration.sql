/*
  Warnings:

  - The primary key for the `Auction` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `id` on the `Auction` table. All the data in the column will be lost.
  - You are about to drop the column `auctionId` on the `Collection` table. All the data in the column will be lost.
  - You are about to drop the column `dropId` on the `Collection` table. All the data in the column will be lost.
  - The primary key for the `PrizeProof` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `lotteryId` on the `PrizeProof` table. All the data in the column will be lost.
  - You are about to drop the column `userName` on the `User` table. All the data in the column will be lost.
  - You are about to drop the `Drop` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `ERC20Address` to the `Auction` table without a default value. This is not possible if the table is not empty.
  - Added the required column `endTime` to the `Auction` table without a default value. This is not possible if the table is not empty.
  - Added the required column `nftId` to the `Auction` table without a default value. This is not possible if the table is not empty.
  - Added the required column `settled` to the `Auction` table without a default value. This is not possible if the table is not empty.
  - Added the required column `startTime` to the `Auction` table without a default value. This is not possible if the table is not empty.
  - Added the required column `bannerImageS3Path` to the `Collection` table without a default value. This is not possible if the table is not empty.
  - Added the required column `collectionMetadataCid` to the `Collection` table without a default value. This is not possible if the table is not empty.
  - Added the required column `description` to the `Collection` table without a default value. This is not possible if the table is not empty.
  - Added the required column `metadataS3Path` to the `Collection` table without a default value. This is not possible if the table is not empty.
  - Added the required column `name` to the `Collection` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tags` to the `Collection` table without a default value. This is not possible if the table is not empty.
  - Added the required column `collectionId` to the `PrizeProof` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Drop" DROP CONSTRAINT "Drop_approvedBy_fkey";

-- DropForeignKey
ALTER TABLE "Drop" DROP CONSTRAINT "Drop_defaultPrizeId_fkey";

-- DropForeignKey
ALTER TABLE "Drop" DROP CONSTRAINT "Drop_lotteryId_fkey";

-- DropForeignKey
ALTER TABLE "_userFavoriteDrops" DROP CONSTRAINT "_userFavoriteDrops_A_fkey";

-- DropIndex
DROP INDEX "Auction_collectionId_key";

-- AlterTable
ALTER TABLE "Auction" DROP CONSTRAINT "Auction_pkey",
DROP COLUMN "id",
ADD COLUMN     "ERC20Address" CHAR(42) NOT NULL,
ADD COLUMN     "buyNowPrice" TEXT,
ADD COLUMN     "contractDataFetchedAt" TIMESTAMP(3),
ADD COLUMN     "endTime" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "minimumPrice" TEXT,
ADD COLUMN     "nftId" INTEGER NOT NULL,
ADD COLUMN     "settled" BOOLEAN NOT NULL,
ADD COLUMN     "startTime" TIMESTAMP(3) NOT NULL,
ADD CONSTRAINT "Auction_pkey" PRIMARY KEY ("collectionId");

-- AlterTable
ALTER TABLE "Collection" DROP COLUMN "auctionId",
DROP COLUMN "dropId",
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedBy" CHAR(42),
ADD COLUMN     "bannerImageS3Path" TEXT NOT NULL,
ADD COLUMN     "collectionMetadataCid" TEXT NOT NULL,
ADD COLUMN     "description" TEXT NOT NULL,
ADD COLUMN     "metadataS3Path" TEXT NOT NULL,
ADD COLUMN     "name" TEXT NOT NULL,
ADD COLUMN     "tags" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "PrizeProof" DROP CONSTRAINT "PrizeProof_pkey",
DROP COLUMN "lotteryId",
ADD COLUMN     "collectionId" INTEGER NOT NULL,
ADD CONSTRAINT "PrizeProof_pkey" PRIMARY KEY ("collectionId", "winnerAddress", "nftId");

-- AlterTable
ALTER TABLE "User" DROP COLUMN "userName",
ADD COLUMN     "username" TEXT;

-- DropTable
DROP TABLE "Drop";

-- CreateTable
CREATE TABLE "DirectMint" (
    "collectionId" INTEGER NOT NULL,
    "mintCost" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DirectMint_pkey" PRIMARY KEY ("collectionId")
);

-- CreateTable
CREATE TABLE "Lottery" (
    "collectionId" INTEGER NOT NULL,
    "blockchainCreatedAt" TIMESTAMP(3),
    "costPerTicketCoins" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "costPerTicketPoints" INTEGER NOT NULL DEFAULT 0,
    "defaultPrizeId" INTEGER,
    "isLive" BOOLEAN NOT NULL DEFAULT false,
    "maxParticipants" INTEGER NOT NULL DEFAULT 0,
    "finished" BOOLEAN NOT NULL DEFAULT false,
    "endTime" INTEGER NOT NULL,
    "startTime" INTEGER NOT NULL,

    CONSTRAINT "Lottery_pkey" PRIMARY KEY ("collectionId")
);

-- AddForeignKey
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "User"("walletAddress") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectMint" ADD CONSTRAINT "DirectMint_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lottery" ADD CONSTRAINT "Lottery_defaultPrizeId_fkey" FOREIGN KEY ("defaultPrizeId") REFERENCES "Nft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lottery" ADD CONSTRAINT "Lottery_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_userFavoriteDrops" ADD FOREIGN KEY ("A") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
