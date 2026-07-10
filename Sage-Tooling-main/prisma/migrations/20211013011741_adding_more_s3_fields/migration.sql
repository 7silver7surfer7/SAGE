/*
  Warnings:

  - You are about to drop the column `bannerImagePath` on the `Drop` table. All the data in the column will be lost.
  - You are about to drop the column `metadataPath` on the `Drop` table. All the data in the column will be lost.
  - Added the required column `bannerImageIpfsPath` to the `Drop` table without a default value. This is not possible if the table is not empty.
  - Added the required column `bannerImageS3Path` to the `Drop` table without a default value. This is not possible if the table is not empty.
  - Added the required column `metadataIpfsPath` to the `Drop` table without a default value. This is not possible if the table is not empty.
  - Added the required column `metadataS3Path` to the `Drop` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Drop" DROP COLUMN "bannerImagePath",
DROP COLUMN "metadataPath",
ADD COLUMN     "bannerImageIpfsPath" TEXT NOT NULL,
ADD COLUMN     "bannerImageS3Path" TEXT NOT NULL,
ADD COLUMN     "metadataIpfsPath" TEXT NOT NULL,
ADD COLUMN     "metadataS3Path" TEXT NOT NULL;
