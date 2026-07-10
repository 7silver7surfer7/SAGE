/*
  Warnings:

  - Added the required column `artistName` to the `Drop` table without a default value. This is not possible if the table is not empty.
  - Added the required column `costPerTicket` to the `Drop` table without a default value. This is not possible if the table is not empty.
  - Added the required column `dropDescription` to the `Drop` table without a default value. This is not possible if the table is not empty.
  - Added the required column `dropName` to the `Drop` table without a default value. This is not possible if the table is not empty.
  - Added the required column `endTime` to the `Drop` table without a default value. This is not possible if the table is not empty.
  - Added the required column `lotteryId` to the `Drop` table without a default value. This is not possible if the table is not empty.
  - Added the required column `prizeMetadataCid` to the `Drop` table without a default value. This is not possible if the table is not empty.
  - Added the required column `startTime` to the `Drop` table without a default value. This is not possible if the table is not empty.
  - Added the required column `description` to the `Nft` table without a default value. This is not possible if the table is not empty.
  - Added the required column `rarity` to the `Nft` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Nft" DROP CONSTRAINT "Nft_dropId_fkey";

-- AlterTable
ALTER TABLE "Drop" ADD COLUMN     "artistName" TEXT NOT NULL,
ADD COLUMN     "costPerTicket" INTEGER NOT NULL,
ADD COLUMN     "dropDescription" TEXT NOT NULL,
ADD COLUMN     "dropName" TEXT NOT NULL,
ADD COLUMN     "endTime" TEXT NOT NULL,
ADD COLUMN     "lotteryId" INTEGER NOT NULL,
ADD COLUMN     "prizeIds" INTEGER[],
ADD COLUMN     "prizeMetadataCid" TEXT NOT NULL,
ADD COLUMN     "startTime" TEXT NOT NULL,
ALTER COLUMN "title" SET DATA TYPE TEXT,
ALTER COLUMN "bannerImagePath" SET DATA TYPE TEXT,
ALTER COLUMN "bannerImageName" SET DATA TYPE TEXT,
ALTER COLUMN "metadataPath" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "Nft" ADD COLUMN     "description" TEXT NOT NULL,
ADD COLUMN     "rarity" TEXT NOT NULL,
ALTER COLUMN "name" SET DATA TYPE TEXT,
ALTER COLUMN "IpfsPath" SET DATA TYPE TEXT;

-- AddForeignKey
ALTER TABLE "Nft" ADD CONSTRAINT "Nft_dropId_fkey" FOREIGN KEY ("dropId") REFERENCES "Drop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
