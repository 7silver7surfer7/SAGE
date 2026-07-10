-- AddForeignKey
ALTER TABLE "EarnedPoints" ADD CONSTRAINT "EarnedPoints_address_fkey" FOREIGN KEY ("address") REFERENCES "User"("walletAddress") ON DELETE RESTRICT ON UPDATE CASCADE;
