/*
  Warnings:

  - A unique constraint covering the columns `[nftId]` on the table `Auction` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `nftId` to the `Auction` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Nft" DROP CONSTRAINT "Nft_auctionId_fkey";

-- AlterTable
ALTER TABLE "Auction" ADD COLUMN     "nftId" INTEGER NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Auction_nftId_key" ON "Auction"("nftId");

-- AddForeignKey
ALTER TABLE "Auction" ADD CONSTRAINT "Auction_nftId_fkey" FOREIGN KEY ("nftId") REFERENCES "Nft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
