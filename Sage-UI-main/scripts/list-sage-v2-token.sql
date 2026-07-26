-- List the CURRENT SAGE token (Doppler / Uniswap v4) in the tokens registry.
--
-- It was launched through Doppler, not SocialTokenFactory, so no row was ever
-- created for it and /social/token/<address> 404s — the token trades fine but
-- is invisible in the app. Its v4 PoolKey is already pinned in
-- utilities/uniswapV4.ts (V4_POOLS), so quoting and swapping work the moment
-- the row exists; this only makes it discoverable.
--
-- imageUrl is deliberately the SAME S3 object as the original SAGE token: it is
-- the same brand, and pointing at one file means a future logo change updates
-- both rather than leaving one stale.
--
-- Idempotent: tokenAddress is UNIQUE and this is ON CONFLICT DO NOTHING.
INSERT INTO "SocialTokenLaunch"
  ("creatorAddress", "tokenAddress", name, symbol, "launchTxHash", "imageUrl", description, "airdropEnabled", "createdAt")
SELECT
  "creatorAddress",
  '0xE21a2b120FAcF995bC8bF6b1843f409E568beBA3',
  'SAGE (new)',
  'SAGE',
  '0x266c2884d2d1868c0157372fb15ec509c7270a962a8aa4fddd692d79429b3ac4',
  "imageUrl",
  'The current SAGE token. Trades in a Uniswap v4 pool on Robinhood Chain.',
  false,
  now()
FROM "SocialTokenLaunch"
WHERE lower("tokenAddress") = lower('0x14561006002e8f76E68EC69e6A32527730bb73c8')
ON CONFLICT ("tokenAddress") DO NOTHING;
