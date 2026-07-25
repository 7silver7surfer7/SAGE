/**
 * Pixel economics — the single source for both the server ledger and the UI.
 *
 * These lived in utilities/pixelsLedger.ts, which is server-only (it imports
 * prisma), so the profile page could not read them and hardcoded its own copy:
 * `Math.min(balance, 100000) * 0.25`. That is how a display drifts from the
 * ledger — the numbers agreed when written and nothing kept them agreeing.
 * The repricing to the new token would have left the profile showing a rate
 * 250x too high, with no error anywhere.
 *
 * Client-safe on purpose: no prisma, no ethers, no server config.
 */

/** 25/25000 = 0.001 pixels per whole token per day. */
export const RATE_SCALED = 25;
export const RATE_DIVISOR = 25000;

/** Per-wallet ceiling, in whole tokens. 25,000,000 -> 25,000 pixels/day. */
export const CAP_SAGE = 25000000;

/**
 * One legacy token earns what 250 new ones do — the old pair was 0.25/day
 * capped at 100,000, and 100,000 x 250 is exactly the new cap, so a legacy
 * holder's ceiling is unchanged for the migration window.
 */
export const LEGACY_PIXEL_RATIO = 250;

/** Pixels per day for a holding, in whole tokens of the CURRENT token. */
export function pixelsPerDay(wholeTokens: number): number {
  if (!Number.isFinite(wholeTokens) || wholeTokens <= 0) return 0;
  return (Math.min(wholeTokens, CAP_SAGE) * RATE_SCALED) / RATE_DIVISOR;
}

/** Pixels per day for a legacy-token holding, during the migration window. */
export function legacyPixelsPerDay(wholeLegacyTokens: number): number {
  if (!Number.isFinite(wholeLegacyTokens) || wholeLegacyTokens <= 0) return 0;
  return pixelsPerDay(wholeLegacyTokens * LEGACY_PIXEL_RATIO);
}
