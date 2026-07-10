/*
  Warnings:

  - You are about to drop the column `isLive` on the `Drop` table. All the data in the column will be lost.
  - You are about to drop the column `membercostPerTicketPoints` on the `Lottery` table. All the data in the column will be lost.
  - You are about to drop the column `vipcostPerTicketPoints` on the `Lottery` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Auction" ADD COLUMN     "isLive" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Drop" DROP COLUMN "isLive";

-- AlterTable
ALTER TABLE "Lottery" DROP COLUMN "membercostPerTicketPoints",
DROP COLUMN "vipcostPerTicketPoints",
ADD COLUMN     "isLive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "memberCostPerTicketPoints" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "vipCostPerTicketPoints" INTEGER NOT NULL DEFAULT 0;
