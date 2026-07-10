/*
  Warnings:

  - You are about to drop the column `prizeIds` on the `Drop` table. All the data in the column will be lost.
  - Added the required column `s3Path` to the `Nft` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ARTIST', 'ADMIN');

-- AlterTable
ALTER TABLE "Drop" DROP COLUMN "prizeIds",
ADD COLUMN     "prizes" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Nft" ADD COLUMN     "s3Path" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "User" (
    "walletAddress" CHAR(42) NOT NULL,
    "userName" TEXT,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "role" "Role" NOT NULL DEFAULT E'USER',

    CONSTRAINT "User_pkey" PRIMARY KEY ("walletAddress")
);

-- CreateTable
CREATE TABLE "_UserFavoriteNFT" (
    "A" INTEGER NOT NULL,
    "B" CHAR(42) NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "_UserFavoriteNFT_AB_unique" ON "_UserFavoriteNFT"("A", "B");

-- CreateIndex
CREATE INDEX "_UserFavoriteNFT_B_index" ON "_UserFavoriteNFT"("B");

-- AddForeignKey
ALTER TABLE "_UserFavoriteNFT" ADD FOREIGN KEY ("A") REFERENCES "Nft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_UserFavoriteNFT" ADD FOREIGN KEY ("B") REFERENCES "User"("walletAddress") ON DELETE CASCADE ON UPDATE CASCADE;
