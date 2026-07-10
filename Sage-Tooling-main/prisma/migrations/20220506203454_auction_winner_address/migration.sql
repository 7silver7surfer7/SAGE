/*
  Warnings:

  - You are about to drop the column `auctionId` on the `Nft` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Auction" ADD COLUMN     "claimedAt" TIMESTAMP(3),
ADD COLUMN     "winnerAddress" CHAR(42);

-- AlterTable
ALTER TABLE "Nft" DROP COLUMN "auctionId";
