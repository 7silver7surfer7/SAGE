/**
 * Published Anthropic list prices, USD per million tokens.
 *
 * Shared by the agent UI (which labels each model with its multiplier) and the
 * agent API route (which actually debits credits). One table, because the
 * price the user is shown and the price they are charged drifting apart is a
 * billing bug, not a display bug.
 *
 * Output is exactly 5× input for all four models. That is what makes a single
 * per-model `rate` correct: the meter weights output 5× and then scales by the
 * input ratio, which prices both halves of a turn accurately.
 */
export interface ModelPrice {
  id: string;
  label: string;
  /** upstream model id actually called */
  api: string;
  maxTokens: number;
  /** USD per million input tokens */
  usdIn: number;
  /** USD per million output tokens */
  usdOut: number;
  note: string;
}

export const DEFAULT_MODEL_ID = 'claude-sonnet-5';

/**
 * Ordered most to least expensive — the picker reads top-down.
 *
 * `api` MUST be the model the price describes. It previously pointed at the
 * 4.5-era ids: picking FABLE 5 billed $10/MTok and called Sonnet at $2, a
 * silent 5× overcharge, and OPUS 5 called opus-4-5. Billing a customer for one
 * model and serving them another is the one thing this table exists to prevent
 * — if a price and an id here ever disagree again, the price is not the bug.
 */
export const MODEL_PRICES: ModelPrice[] = [
  {
    id: 'claude-fable-5',
    label: 'FABLE 5',
    api: 'claude-fable-5',
    maxTokens: 1200,
    usdIn: 10,
    usdOut: 50,
    note: 'HARDEST PROBLEMS',
  },
  {
    id: 'claude-opus-5',
    label: 'OPUS 5',
    api: 'claude-opus-5',
    maxTokens: 1200,
    usdIn: 5,
    usdOut: 25,
    note: 'DEEPEST REASONING',
  },
  {
    id: 'claude-sonnet-5',
    label: 'SONNET 5',
    api: 'claude-sonnet-5',
    maxTokens: 1200,
    usdIn: 2,
    usdOut: 10,
    note: 'BALANCED · DEFAULT',
  },
  {
    id: 'claude-haiku-4-5',
    label: 'HAIKU 4.5',
    api: 'claude-haiku-4-5-20251001',
    maxTokens: 1000,
    usdIn: 1,
    usdOut: 5,
    note: 'FAST · CHEAPEST',
  },
];

const BASE_USD_IN = MODEL_PRICES.find((m) => m.id === DEFAULT_MODEL_ID)!.usdIn;

/** Credit multiplier, relative to the default model. Derived, never typed. */
export function rateFor(price: ModelPrice): number {
  return price.usdIn / BASE_USD_IN;
}

export function priceFor(id: string): ModelPrice {
  return (
    MODEL_PRICES.find((m) => m.id === id) ||
    MODEL_PRICES.find((m) => m.id === DEFAULT_MODEL_ID)!
  );
}

/**
 * Credits for one turn. 1 credit ≈ 1,000 input-equivalent tokens on the
 * default model, output weighted 5×. Always at least 1, so a turn can never
 * be free.
 */
export function creditsForUsage(modelId: string, inputTokens: number, outputTokens: number): number {
  const price = priceFor(modelId);
  const weighted = (inputTokens + outputTokens * 5) / 1000;
  return Math.max(1, Math.ceil(weighted * rateFor(price)));
}

// ── image generation ────────────────────────────────────────────────────────
/**
 * Krea 2 tiers, priced per image in USD from Krea's published rates.
 *
 * Metered on the SAME unit as text: 1 credit = $0.002 of real spend. That is
 * what lets one balance cover both — a Large render costs 30 credits because
 * it costs us $0.06, exactly as 30 credits of Sonnet would.
 *
 * `path` is verified against the live API, not inferred: the fast tier is
 * `medium-turbo`, and `/krea-2/turbo` 404s.
 */
export interface ImageModelPrice {
  id: string;
  label: string;
  path: string;
  usdPerImage: number;
  note: string;
  /** rough wall-clock, for the picker */
  seconds: number;
}

export const IMAGE_MODELS: ImageModelPrice[] = [
  {
    id: 'krea-2-large',
    label: 'KREA 2 LARGE',
    path: '/generate/image/krea/krea-2/large',
    usdPerImage: 0.06,
    note: 'PHOTOREALISM · 2K',
    seconds: 25,
  },
  {
    id: 'krea-2-medium',
    label: 'KREA 2 MEDIUM',
    path: '/generate/image/krea/krea-2/medium',
    usdPerImage: 0.03,
    note: 'EXPRESSIVE · 1.5K',
    seconds: 10,
  },
  {
    id: 'krea-2-turbo',
    label: 'KREA 2 TURBO',
    path: '/generate/image/krea/krea-2/medium-turbo',
    usdPerImage: 0.015,
    note: 'FAST ITERATION · 1.5K',
    seconds: 3,
  },
];

export const DEFAULT_IMAGE_MODEL_ID = 'krea-2-medium';

/** USD per credit — the unit the whole meter is built on. */
export const USD_PER_CREDIT = 0.002;

export function imagePriceFor(id: string): ImageModelPrice {
  return (
    IMAGE_MODELS.find((m) => m.id === id) ||
    IMAGE_MODELS.find((m) => m.id === DEFAULT_IMAGE_MODEL_ID)!
  );
}

/** Credits for one image, on the same $0.002/credit basis as text. */
export function creditsForImage(id: string): number {
  return Math.max(1, Math.ceil(imagePriceFor(id).usdPerImage / USD_PER_CREDIT));
}
