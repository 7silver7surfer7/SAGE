-- Whole-token total supply on SocialTokenLaunch.
--
-- The UI hardcoded 1,000,000,000 for market cap and holder share because every
-- SocialTokenFactory launch mints exactly that. Doppler launches do not — SAGE
-- (new) has 100B — so its holders rendered at 524% of supply and its market cap
-- came out 100x too low. NULL keeps the old assumption for existing rows.
--
-- Additive and idempotent.
ALTER TABLE "SocialTokenLaunch" ADD COLUMN IF NOT EXISTS "totalSupplyWhole" DOUBLE PRECISION;

UPDATE "SocialTokenLaunch"
   SET "totalSupplyWhole" = 100000000000
 WHERE lower("tokenAddress") = lower('0xE21a2b120FAcF995bC8bF6b1843f409E568beBA3')
   AND "totalSupplyWhole" IS DISTINCT FROM 100000000000;
