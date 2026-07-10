/*
  Warnings:

  - You are about to drop the `MemeTransactions` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "MemeTransactions";

-- CreateTable
CREATE TABLE "TokenTransaction" (
    "blockNumber" INTEGER NOT NULL,
    "blockTimestamp" INTEGER NOT NULL,
    "from" CHAR(42) NOT NULL,
    "to" CHAR(42) NOT NULL,
    "value" TEXT NOT NULL,
    "assetType" "AssetType" NOT NULL,
    "id" SERIAL NOT NULL,
    "txHash" CHAR(66) NOT NULL,

    CONSTRAINT "TokenTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TokenTransaction_from_to_idx" ON "TokenTransaction"("from", "to");
