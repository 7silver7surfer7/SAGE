/*
  Warnings:

  - The values [ETH_MEMEINU,FTM_MEMEINU,FTM_LIQUIDITY] on the enum `AssetType` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "AssetType_new" AS ENUM ('ETH_ASH');
ALTER TABLE "MemeTransactions" ALTER COLUMN "assetType" TYPE "AssetType_new" USING ("assetType"::text::"AssetType_new");
ALTER TABLE "RewardType" ALTER COLUMN "type" TYPE "AssetType_new" USING ("type"::text::"AssetType_new");
ALTER TYPE "AssetType" RENAME TO "AssetType_old";
ALTER TYPE "AssetType_new" RENAME TO "AssetType";
DROP TYPE "AssetType_old";
COMMIT;
