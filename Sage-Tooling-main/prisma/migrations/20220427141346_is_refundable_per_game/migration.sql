/*
  Warnings:

  - You are about to drop the column `isRefundable` on the `Drop` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Drop" DROP COLUMN "isRefundable";

-- AlterTable
ALTER TABLE "Lottery" ADD COLUMN     "isRefundable" BOOLEAN NOT NULL DEFAULT false;
