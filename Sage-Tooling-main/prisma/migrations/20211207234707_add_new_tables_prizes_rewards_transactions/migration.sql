/*
  Warnings:

  - You are about to drop the column `artistName` on the `Drop` table. All the data in the column will be lost.
  - You are about to drop the column `costPerTicket` on the `Drop` table. All the data in the column will be lost.
  - You are about to drop the column `prizes` on the `Drop` table. All the data in the column will be lost.
  - You are about to drop the `Proof` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `_UserFavoriteNFT` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `createdBy` to the `Drop` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('ETH_MEMEINU', 'FTM_MEMEINU', 'FTM_LIQUIDITY');

-- DropForeignKey
ALTER TABLE "_UserFavoriteNFT" DROP CONSTRAINT "_UserFavoriteNFT_A_fkey";

-- DropForeignKey
ALTER TABLE "_UserFavoriteNFT" DROP CONSTRAINT "_UserFavoriteNFT_B_fkey";

-- AlterTable
ALTER TABLE "Drop" DROP COLUMN "artistName",
DROP COLUMN "costPerTicket",
DROP COLUMN "prizes",
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedBy" CHAR(42),
ADD COLUMN     "blockchainCreatedAt" TIMESTAMP(3),
ADD COLUMN     "costPerTicketCoins" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
ADD COLUMN     "costPerTicketPoints" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "createdBy" CHAR(42) NOT NULL,
ADD COLUMN     "defaultPrizeId" INTEGER,
ADD COLUMN     "isLive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "maxParticipants" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "royaltyPercentage" DOUBLE PRECISION NOT NULL DEFAULT 0.0;

-- AlterTable
ALTER TABLE "Nft" ADD COLUMN     "numberOfMints" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "bio" VARCHAR(200),
ADD COLUMN     "profilePicture" TEXT;

-- DropTable
DROP TABLE "Proof";

-- DropTable
DROP TABLE "_UserFavoriteNFT";

-- CreateTable
CREATE TABLE "PrizeProof" (
    "lotteryId" INTEGER NOT NULL,
    "winnerAddress" CHAR(42) NOT NULL,
    "proof" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,
    "nftId" INTEGER NOT NULL,

    CONSTRAINT "PrizeProof_pkey" PRIMARY KEY ("lotteryId","winnerAddress")
);

-- CreateTable
CREATE TABLE "MemeTransactions" (
    "blockNumber" INTEGER NOT NULL,
    "blockTimestamp" INTEGER NOT NULL,
    "from" CHAR(42) NOT NULL,
    "to" CHAR(42) NOT NULL,
    "value" TEXT NOT NULL,
    "assetType" "AssetType" NOT NULL,
    "id" SERIAL NOT NULL,
    "txHash" CHAR(66) NOT NULL,

    CONSTRAINT "MemeTransactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardPublished" (
    "address" CHAR(42) NOT NULL,
    "totalPointsEarned" BIGINT NOT NULL DEFAULT 0,
    "proof" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardPublished_pkey" PRIMARY KEY ("address")
);

-- CreateTable
CREATE TABLE "RewardType" (
    "type" "AssetType" NOT NULL,
    "rewardRate" DOUBLE PRECISION NOT NULL,
    "lastBlockInspected" BIGINT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "contract" CHAR(42) NOT NULL,
    "startingBlock" BIGINT NOT NULL,

    CONSTRAINT "RewardType_pkey" PRIMARY KEY ("type")
);

-- CreateTable
CREATE TABLE "_userFavoriteDrops" (
    "A" INTEGER NOT NULL,
    "B" CHAR(42) NOT NULL
);

-- CreateIndex
CREATE INDEX "MemeTransactions_from_to_idx" ON "MemeTransactions"("from", "to");

-- CreateIndex
CREATE UNIQUE INDEX "_userFavoriteDrops_AB_unique" ON "_userFavoriteDrops"("A", "B");

-- CreateIndex
CREATE INDEX "_userFavoriteDrops_B_index" ON "_userFavoriteDrops"("B");

-- CreateIndex
CREATE INDEX "User_walletAddress_idx" ON "User"("walletAddress");

-- AddForeignKey
ALTER TABLE "Drop" ADD CONSTRAINT "Drop_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "User"("walletAddress") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Drop" ADD CONSTRAINT "Drop_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("walletAddress") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Drop" ADD CONSTRAINT "Drop_defaultPrizeId_fkey" FOREIGN KEY ("defaultPrizeId") REFERENCES "Nft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrizeProof" ADD CONSTRAINT "PrizeProof_nftId_fkey" FOREIGN KEY ("nftId") REFERENCES "Nft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_userFavoriteDrops" ADD FOREIGN KEY ("A") REFERENCES "Drop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_userFavoriteDrops" ADD FOREIGN KEY ("B") REFERENCES "User"("walletAddress") ON DELETE CASCADE ON UPDATE CASCADE;
