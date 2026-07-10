/*
  Warnings:

  - Added the required column `tags` to the `Drop` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tags` to the `Nft` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Drop" ADD COLUMN     "tags" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Nft" ADD COLUMN     "tags" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "Proof" (
    "lotteryId" INTEGER NOT NULL,
    "winnerAddress" CHAR(42) NOT NULL,
    "prizeId" INTEGER NOT NULL,
    "proof" TEXT NOT NULL,
    "claimed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Proof_pkey" PRIMARY KEY ("lotteryId","winnerAddress","prizeId")
);
