import { ethers } from 'ethers';

/**
 * Compute-credit pricing, shared by the browser and the API route.
 *
 * Kept out of the API page deliberately: the client needs the treasury address
 * and the prices to build a payment, and importing a page module would drag
 * Prisma into the browser bundle.
 *
 * The client uses these to SEND a payment. It does not use them to decide what
 * it is owed — the server re-derives the tier from the value actually received
 * on chain, so these numbers being wrong in the browser cannot mint credits.
 */

/** Where credit payments must land — the platform treasury. */
export const CREDIT_TREASURY = '0x3E099aF007CaB8233D44782D8E6fe80FECDC321e';

/**
 * Prices are denominated in USD and converted to ETH at purchase time.
 *
 * They used to be fixed in ETH, which quietly made the margin a function of
 * the ETH price: the ladder was set at roughly 10× cost with ETH near $1,860,
 * and would have become ~24× at $4,000 without anyone choosing that, or fallen
 * under infrastructure cost in a crash. Pricing in USD and converting with the
 * same live feed `prepare_buy` already uses keeps the price the one intended.
 */
export interface CreditTier {
  id: string;
  title: string;
  credits: number;
  /** price in USD — the authority */
  usd: number;
  note: string;
  /** volume discount vs the entry tier, derived from credits-per-dollar */
  bonus?: string;
}

/**
 * ETH is the only accepted currency. The design offered SAGE at a 15%
 * discount, but there is no SAGE price the server can trust at claim time, and
 * discounting against a figure the client supplies is how credits get minted
 * for free.
 *
 * At ~$0.002 of API cost per credit these run 5.0× / 4.5× / 4.0× — the ladder
 * now gets CHEAPER per credit as it goes up. It previously ran the other way:
 * the entry tier a newcomer buys was the worst rate on the board.
 */
const RAW = [
  { id: 'taste', title: 'Taste', credits: 500, usd: 5, note: 'A few sessions' },
  { id: 'curator', title: 'Curator', credits: 2500, usd: 22.5, note: 'Most popular' },
  { id: 'patron', title: 'Patron', credits: 10000, usd: 80, note: 'Heavy tool use' },
];

/**
 * The bonus badges are DERIVED from the ladder, never typed.
 *
 * They were hardcoded "+10%" and "+20%", and both were false: nothing granted
 * a bonus, and the prices implied +7% and +22%. A badge that overstates what a
 * customer receives is a refund waiting to happen.
 */
const basePerUsd = RAW[0].credits / RAW[0].usd;

export const CREDIT_TIERS: CreditTier[] = RAW.map((t) => {
  const bonus = Math.round((t.credits / t.usd / basePerUsd - 1) * 100);
  return { ...t, ...(bonus >= 1 ? { bonus: `+${bonus}%` } : {}) };
});

/**
 * Tolerance on the amount received, in basis points.
 *
 * ETH moves between the moment a quote is shown and the moment the payment
 * confirms, so demanding an exact wei match would reject honest purchases.
 * 3% is wide enough for that drift and far too narrow to buy a tier cheaply.
 */
export const PRICE_TOLERANCE_BPS = 300;

/** USD price converted to wei at a given ETH/USD rate. */
export function weiForUsd(usd: number, ethUsd: number): ethers.BigNumber {
  if (!(ethUsd > 0)) throw new Error('ETH/USD rate unavailable');
  // 6dp of ETH is well inside wei and keeps the quoted figure legible.
  return ethers.utils.parseEther((usd / ethUsd).toFixed(6));
}

/** Display helper: "0.002684 ETH". */
export function ethLabelForUsd(usd: number, ethUsd: number): string {
  return `${(usd / ethUsd).toFixed(6)} ETH`;
}
