/*
  Warnings:

  - The primary key for the `PrizeProof` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - Added the required column `name` to the `Drop` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Drop" ADD COLUMN     "name" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "PrizeProof" DROP CONSTRAINT "PrizeProof_pkey",
ADD CONSTRAINT "PrizeProof_pkey" PRIMARY KEY ("lotteryId", "winnerAddress", "nftId", "ticketNumber");

-- AddForeignKey
ALTER TABLE "PrizeProof" ADD CONSTRAINT "PrizeProof_lotteryId_fkey" FOREIGN KEY ("lotteryId") REFERENCES "Lottery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
