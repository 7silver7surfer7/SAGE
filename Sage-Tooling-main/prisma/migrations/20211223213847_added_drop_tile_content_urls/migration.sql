/*
  Warnings:

  - Added the required column `dropTileContentIpfsUrl` to the `Drop` table without a default value. This is not possible if the table is not empty.
  - Added the required column `dropTileContentS3Url` to the `Drop` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Drop" ADD COLUMN     "dropTileContentIpfsUrl" TEXT NOT NULL,
ADD COLUMN     "dropTileContentS3Url" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Nft" ADD COLUMN     "isVideo" BOOLEAN NOT NULL DEFAULT false;
