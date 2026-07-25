-- DropIndex

-- DropIndex

-- DropIndex

-- AlterTable
ALTER TABLE "DexPair" ADD COLUMN     "chainId" INTEGER NOT NULL DEFAULT 4663;

-- AlterTable
ALTER TABLE "PixelAccount" ADD COLUMN     "streamDust" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "twitterUserId" VARCHAR(24);

-- CreateTable
CREATE TABLE "AgentCreditAccount" (
    "address" CHAR(42) NOT NULL,
    "credits" INTEGER NOT NULL DEFAULT 0,
    "spent" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentCreditAccount_pkey" PRIMARY KEY ("address")
);

-- CreateTable
CREATE TABLE "AgentCreditPurchase" (
    "id" SERIAL NOT NULL,
    "txHash" CHAR(66) NOT NULL,
    "address" CHAR(42) NOT NULL,
    "tier" VARCHAR(20) NOT NULL,
    "credits" INTEGER NOT NULL,
    "weiPaid" VARCHAR(78) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentCreditPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentSession" (
    "id" TEXT NOT NULL,
    "address" CHAR(42) NOT NULL,
    "title" VARCHAR(80) NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentMessage" (
    "id" SERIAL NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" VARCHAR(12) NOT NULL,
    "text" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "XMention" (
    "tweetId" VARCHAR(24) NOT NULL,
    "authorXUserId" VARCHAR(24) NOT NULL,
    "authorHandle" VARCHAR(40) NOT NULL,
    "walletAddress" CHAR(42),
    "outcome" VARCHAR(24) NOT NULL,
    "intent" VARCHAR(16),
    "creditsSpent" INTEGER NOT NULL DEFAULT 0,
    "replyTweetId" VARCHAR(24),
    "imageUri" VARCHAR(300),
    "tokenUri" VARCHAR(300),
    "prompt" VARCHAR(500),
    "claimedTxHash" CHAR(66),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "XMention_pkey" PRIMARY KEY ("tweetId")
);

-- CreateTable
CREATE TABLE "XBotState" (
    "key" VARCHAR(40) NOT NULL,
    "value" VARCHAR(120) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "XBotState_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentCreditPurchase_txHash_key" ON "AgentCreditPurchase"("txHash");

-- CreateIndex
CREATE INDEX "AgentCreditPurchase_address_id_idx" ON "AgentCreditPurchase"("address", "id");

-- CreateIndex
CREATE INDEX "AgentSession_address_archived_updatedAt_idx" ON "AgentSession"("address", "archived", "updatedAt");

-- CreateIndex
CREATE INDEX "AgentMessage_sessionId_id_idx" ON "AgentMessage"("sessionId", "id");

-- CreateIndex
CREATE INDEX "XMention_authorXUserId_createdAt_idx" ON "XMention"("authorXUserId", "createdAt");

-- CreateIndex
CREATE INDEX "XMention_outcome_createdAt_idx" ON "XMention"("outcome", "createdAt");

-- CreateIndex
CREATE INDEX "DexPair_chainId_baseToken_idx" ON "DexPair"("chainId", "baseToken");

-- CreateIndex
CREATE INDEX "DexPair_chainId_updatedAt_idx" ON "DexPair"("chainId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DexPair_chainId_pairAddress_key" ON "DexPair"("chainId", "pairAddress");

-- CreateIndex
CREATE UNIQUE INDEX "User_twitterUserId_key" ON "User"("twitterUserId");

-- AddForeignKey
ALTER TABLE "AgentMessage" ADD CONSTRAINT "AgentMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

