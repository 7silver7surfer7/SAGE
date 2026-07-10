-- DropForeignKey
ALTER TABLE "EarnedPoints" DROP CONSTRAINT "EarnedPoints_address_fkey";

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "EarnedPoints"("address") ON DELETE RESTRICT ON UPDATE CASCADE;
