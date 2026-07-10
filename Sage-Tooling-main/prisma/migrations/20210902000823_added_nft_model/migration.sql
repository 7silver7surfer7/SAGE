-- CreateTable
CREATE TABLE "Nft" (
    "id" SERIAL NOT NULL,
    "dropId" INTEGER NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "IpfsPath" VARCHAR(255) NOT NULL,

    PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Nft" ADD FOREIGN KEY ("dropId") REFERENCES "Drop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
