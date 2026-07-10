/*
  Warnings:

  - You are about to drop the column `memberCostPerTicketCoins` on the `Lottery` table. All the data in the column will be lost.
  - You are about to drop the column `memberCostPerTicketPoints` on the `Lottery` table. All the data in the column will be lost.
  - You are about to drop the column `nonMemberCostPerTicketCoins` on the `Lottery` table. All the data in the column will be lost.
  - You are about to drop the column `vipCostPerTicketCoins` on the `Lottery` table. All the data in the column will be lost.
  - You are about to drop the column `vipCostPerTicketPoints` on the `Lottery` table. All the data in the column will be lost.
  - Made the column `signedMessage` on table `EarnedPoints` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "EarnedPoints" ALTER COLUMN "signedMessage" SET NOT NULL;

-- AlterTable
ALTER TABLE "Lottery" DROP COLUMN "memberCostPerTicketCoins",
DROP COLUMN "memberCostPerTicketPoints",
DROP COLUMN "nonMemberCostPerTicketCoins",
DROP COLUMN "vipCostPerTicketCoins",
DROP COLUMN "vipCostPerTicketPoints",
ADD COLUMN     "costPerTicketPoints" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "costPerTicketTokens" DOUBLE PRECISION NOT NULL DEFAULT 0.0;
