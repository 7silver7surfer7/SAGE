/*
  Warnings:

  - You are about to alter the column `username` on the `User` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(40)`.

*/
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "displayName" VARCHAR(40),
ALTER COLUMN "username" SET DATA TYPE VARCHAR(40);
