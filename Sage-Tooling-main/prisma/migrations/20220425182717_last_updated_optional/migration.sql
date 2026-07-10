-- AlterTable
ALTER TABLE "Auction" ALTER COLUMN "settled" SET DEFAULT false,
ALTER COLUMN "lastUpdatedAt" DROP NOT NULL;
