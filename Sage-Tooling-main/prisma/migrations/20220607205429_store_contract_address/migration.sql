/*
  Warnings:

  - You are about to drop the column `blockchainCreatedAt` on the `Auction` table. All the data in the column will be lost.
  - You are about to drop the column `blockchainCreatedAt` on the `Lottery` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Auction" DROP COLUMN "blockchainCreatedAt",
ADD COLUMN     "contractAddress" CHAR(42);

-- AlterTable
ALTER TABLE "Lottery" DROP COLUMN "blockchainCreatedAt",
ADD COLUMN     "contractAddress" CHAR(42);
