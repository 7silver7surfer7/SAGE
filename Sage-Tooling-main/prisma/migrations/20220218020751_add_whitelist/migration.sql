/*
  Warnings:

  - You are about to drop the column `createdAt` on the `Drop` table. All the data in the column will be lost.
  - You are about to drop the column `createdBy` on the `Drop` table. All the data in the column will be lost.
  - You are about to drop the column `royaltyPercentage` on the `Drop` table. All the data in the column will be lost.
  - You are about to drop the column `splitterId` on the `Drop` table. All the data in the column will be lost.
  - You are about to drop the column `dropId` on the `Nft` table. All the data in the column will be lost.
  - You are about to drop the `RewardPublished` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `RoyaltySplit` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[lotteryId]` on the table `Drop` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `collectionId` to the `Nft` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "WhitelistType" AS ENUM ('WALLET', 'ERC20', 'ERC721', 'ERC1155', 'MERKLE');

-- DropForeignKey
ALTER TABLE "Drop" DROP CONSTRAINT "Drop_createdBy_fkey";

-- DropForeignKey
ALTER TABLE "Drop" DROP CONSTRAINT "Drop_splitterId_fkey";

-- DropForeignKey
ALTER TABLE "Nft" DROP CONSTRAINT "Nft_dropId_fkey";

-- DropForeignKey
ALTER TABLE "RoyaltySplit" DROP CONSTRAINT "RoyaltySplit_splitterId_fkey";

-- AlterTable
ALTER TABLE "Drop" DROP COLUMN "createdAt",
DROP COLUMN "createdBy",
DROP COLUMN "royaltyPercentage",
DROP COLUMN "splitterId";

-- AlterTable
ALTER TABLE "Nft" DROP COLUMN "dropId",
ADD COLUMN     "collectionId" INTEGER NOT NULL;

-- DropTable
DROP TABLE "RewardPublished";

-- DropTable
DROP TABLE "RoyaltySplit";

-- CreateTable
CREATE TABLE "Collection" (
    "id" SERIAL NOT NULL,
    "collectionContractId" INTEGER,
    "primarySplitterId" INTEGER,
    "secondarySplitterId" INTEGER,
    "whitelistId" INTEGER,
    "dropId" INTEGER,
    "auctionId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "royaltyPercentage" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "artistAddress" CHAR(42) NOT NULL,

    CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SplitEntry" (
    "id" SERIAL NOT NULL,
    "destinationAddress" CHAR(42) NOT NULL,
    "splitterId" INTEGER NOT NULL,
    "percent" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "SplitEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhitelistEntry" (
    "id" SERIAL NOT NULL,
    "whitelistId" INTEGER NOT NULL,
    "minBalance" TEXT,
    "tokenId" BIGINT,
    "type" "WhitelistType" NOT NULL,

    CONSTRAINT "WhitelistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Whitelist" (
    "id" SERIAL NOT NULL,
    "contractAddress" CHAR(42) NOT NULL,

    CONSTRAINT "Whitelist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Auction" (
    "id" SERIAL NOT NULL,
    "collectionId" INTEGER NOT NULL,

    CONSTRAINT "Auction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EarnedPoints" (
    "address" CHAR(42) NOT NULL,
    "totalPointsEarned" BIGINT NOT NULL DEFAULT 0,
    "proof" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EarnedPoints_pkey" PRIMARY KEY ("address")
);

-- CreateIndex
CREATE UNIQUE INDEX "Auction_collectionId_key" ON "Auction"("collectionId");

-- CreateIndex
CREATE UNIQUE INDEX "Drop_lotteryId_key" ON "Drop"("lotteryId");

-- AddForeignKey
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_primarySplitterId_fkey" FOREIGN KEY ("primarySplitterId") REFERENCES "Splitter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_secondarySplitterId_fkey" FOREIGN KEY ("secondarySplitterId") REFERENCES "Splitter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_whitelistId_fkey" FOREIGN KEY ("whitelistId") REFERENCES "Whitelist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_artistAddress_fkey" FOREIGN KEY ("artistAddress") REFERENCES "User"("walletAddress") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SplitEntry" ADD CONSTRAINT "SplitEntry_splitterId_fkey" FOREIGN KEY ("splitterId") REFERENCES "Splitter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhitelistEntry" ADD CONSTRAINT "WhitelistEntry_whitelistId_fkey" FOREIGN KEY ("whitelistId") REFERENCES "Whitelist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Auction" ADD CONSTRAINT "Auction_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Nft" ADD CONSTRAINT "Nft_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Drop" ADD CONSTRAINT "Drop_lotteryId_fkey" FOREIGN KEY ("lotteryId") REFERENCES "Collection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
