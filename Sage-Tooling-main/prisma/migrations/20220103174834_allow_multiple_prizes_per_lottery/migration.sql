/*
  Warnings:

  - The primary key for the `PrizeProof` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to alter the column `lastBlockInspected` on the `RewardType` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Integer`.
  - You are about to alter the column `startingBlock` on the `RewardType` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Integer`.

*/
-- AlterTable
ALTER TABLE "PrizeProof" DROP CONSTRAINT "PrizeProof_pkey",
ADD CONSTRAINT "PrizeProof_pkey" PRIMARY KEY ("lotteryId", "winnerAddress", "nftId");

-- AlterTable
ALTER TABLE "RewardType" ALTER COLUMN "lastBlockInspected" SET DATA TYPE INTEGER,
ALTER COLUMN "startingBlock" SET DATA TYPE INTEGER;
