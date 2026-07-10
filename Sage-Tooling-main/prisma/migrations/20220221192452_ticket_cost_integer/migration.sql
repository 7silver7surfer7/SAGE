/*
  Warnings:

  - You are about to alter the column `costPerTicketPoints` on the `Drop` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Integer`.

*/
-- AlterTable
ALTER TABLE "Drop" ALTER COLUMN "costPerTicketPoints" SET DEFAULT 0,
ALTER COLUMN "costPerTicketPoints" SET DATA TYPE INTEGER;
