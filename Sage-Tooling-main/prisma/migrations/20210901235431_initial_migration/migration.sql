-- CreateTable
CREATE TABLE "Drop" (
    "id" SERIAL NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "bannerImagePath" VARCHAR(255) NOT NULL,
    "bannerImageName" VARCHAR(255) NOT NULL,
    "metadataPath" VARCHAR(255) NOT NULL,

    PRIMARY KEY ("id")
);
