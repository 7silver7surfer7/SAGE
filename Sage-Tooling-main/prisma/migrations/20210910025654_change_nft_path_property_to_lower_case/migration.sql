/*
  Warnings:

  - You are about to drop the column `IpfsPath` on the `Nft` table. All the data in the column will be lost.
  - Added the required column `ipfsPath` to the `Nft` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Nft" DROP COLUMN "IpfsPath",
ADD COLUMN     "ipfsPath" TEXT NOT NULL;
