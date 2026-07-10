/*
  Warnings:

  - Changed the type of `endTime` on the `Drop` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `startTime` on the `Drop` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "Drop" ADD COLUMN     "finished" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "splitterId" INTEGER,
DROP COLUMN "endTime",
ADD COLUMN     "endTime" INTEGER NOT NULL,
DROP COLUMN "startTime",
ADD COLUMN     "startTime" INTEGER NOT NULL;

-- CreateTable
CREATE TABLE "RoyaltySplit" (
    "id" SERIAL NOT NULL,
    "destinationAddress" CHAR(42) NOT NULL,
    "splitterId" INTEGER NOT NULL,
    "percent" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "RoyaltySplit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Splitter" (
    "id" SERIAL NOT NULL,
    "splitterAddress" CHAR(42),

    CONSTRAINT "Splitter_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "RoyaltySplit" ADD CONSTRAINT "RoyaltySplit_splitterId_fkey" FOREIGN KEY ("splitterId") REFERENCES "Splitter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Drop" ADD CONSTRAINT "Drop_splitterId_fkey" FOREIGN KEY ("splitterId") REFERENCES "Splitter"("id") ON DELETE SET NULL ON UPDATE CASCADE;
