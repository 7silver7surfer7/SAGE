/*
  Warnings:

  - You are about to drop the column `finished` on the `Lottery` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Auction" ADD COLUMN     "blockchainCreatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Lottery" DROP COLUMN "finished",
ADD COLUMN     "prizesAwardedAt" TIMESTAMP(3);
