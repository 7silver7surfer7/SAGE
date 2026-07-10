/*
  Warnings:

  - You are about to drop the column `ERC20Address` on the `Auction` table. All the data in the column will be lost.
  - Added the required column `erc20Address` to the `Auction` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "User_email_key";

-- AlterTable
ALTER TABLE "Auction" DROP COLUMN "ERC20Address",
ADD COLUMN     "erc20Address" CHAR(42) NOT NULL;
