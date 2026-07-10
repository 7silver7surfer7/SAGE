/*
  Warnings:

  - You are about to drop the column `numberOfMints` on the `Nft` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Nft" DROP COLUMN "numberOfMints",
ADD COLUMN     "numberOfEditions" INTEGER NOT NULL DEFAULT 0;
