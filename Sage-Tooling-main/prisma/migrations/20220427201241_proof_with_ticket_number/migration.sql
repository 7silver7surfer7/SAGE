/*
  Warnings:

  - You are about to drop the column `amount` on the `PrizeProof` table. All the data in the column will be lost.
  - Added the required column `ticketNumber` to the `PrizeProof` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "PrizeProof" DROP COLUMN "amount",
ADD COLUMN     "ticketNumber" INTEGER NOT NULL;
