/*
  Warnings:

  - Added the required column `isRefundable` to the `Drop` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Drop" ADD COLUMN     "isRefundable" BOOLEAN NOT NULL;
