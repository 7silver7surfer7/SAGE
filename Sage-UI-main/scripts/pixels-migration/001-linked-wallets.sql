-- Pixels: linked wallets + penny-drop challenges.
--
-- Written by hand rather than run through `prisma db push`, on purpose: push
-- reconciles the ENTIRE schema against the live database, so any drift on
-- production could drop a column as a side effect of adding two tables. These
-- statements are additive and IF NOT EXISTS, so re-running is a no-op.
--
-- Apply BEFORE deploying the code that reads them. Accrual degrades to the
-- sign-in wallet alone if they are missing (the lookup in liveSageWhole is
-- wrapped), so the leaderboard and earning stay up either way — but the
-- wallet-linking panel on /howtobuysage returns 500 until these exist.
--
--   psql "<production session-pooler URL>" -f scripts/pixels-migration/001-linked-wallets.sql

CREATE TABLE IF NOT EXISTS "LinkedWallet" (
    "address" CHAR(42) NOT NULL,
    "walletAddress" CHAR(42) NOT NULL,
    "proof" VARCHAR(16) NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LinkedWallet_pkey" PRIMARY KEY ("address")
);

CREATE INDEX IF NOT EXISTS "LinkedWallet_walletAddress_idx" ON "LinkedWallet"("walletAddress");

CREATE TABLE IF NOT EXISTS "PixelLinkChallenge" (
    "walletAddress" CHAR(42) NOT NULL,
    "amountWei" VARCHAR(40) NOT NULL,
    "fromBlock" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PixelLinkChallenge_pkey" PRIMARY KEY ("walletAddress")
);
