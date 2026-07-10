/*
  Warnings:

  - You are about to drop the column `costPerTicketCoins` on the `Lottery` table. All the data in the column will be lost.
  - You are about to drop the column `costPerTicketPoints` on the `Lottery` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Lottery" DROP COLUMN "costPerTicketCoins",
DROP COLUMN "costPerTicketPoints",
ADD COLUMN     "memberCostPerTicketCoins" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
ADD COLUMN     "membercostPerTicketPoints" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "nonMemberCostPerTicketCoins" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
ADD COLUMN     "vipCostPerTicketCoins" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
ADD COLUMN     "vipcostPerTicketPoints" INTEGER NOT NULL DEFAULT 0;
