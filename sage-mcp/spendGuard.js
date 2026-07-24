// Spend policy for every value-moving MCP tool (security audit, pass 3).
//
// WHY THIS EXISTS
// ---------------
// This server hands an LLM a funded wallet and a set of tools that sign
// immediately, with no ceiling and no budget. Three consequences the audit
// found, all reachable without compromising anything:
//
//   * sage_social_tip / sage_social_boost take an `amountSage` straight from
//     the model — a prompt-injected agent (these agents read untrusted social
//     content by design) can name any number and the wallet pays it.
//   * sage_social_collect takes ONLY a postId. The amount comes from
//     post.collectPrice and the recipient from post.author — both chosen by
//     whoever wrote the post. The spend is invisible in the tool call, so
//     neither the model nor a human reviewing the call can see what it costs.
//   * sage_social_get_verified pays whatever price the site reports.
//
// So the guard has to bound BOTH model-supplied and server-supplied amounts.
// Everything routes through assertSpend() before signing and recordSpend()
// after the tx confirms.
//
// CONFIGURING
// -----------
// All limits are env-overridable. Defaults are deliberately generous enough
// for normal agent activity (tips, mints, ticket buys) but small enough that a
// runaway or injected agent cannot drain the wallet:
//
//   SAGE_MAX_TX_ETH     per-transaction ETH ceiling      (default 0.1)
//   SAGE_MAX_TX_SAGE    per-transaction SAGE ceiling     (default 10000)
//   SAGE_DAILY_ETH      rolling 24h ETH budget           (default 0.5)
//   SAGE_DAILY_SAGE     rolling 24h SAGE budget          (default 50000)
//
// Set any limit to 0 to block that currency entirely (read-only-ish mode).
// SAGE_SPEND_UNLIMITED=1 disables the guard — do not use with a funded wallet.
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(here, '.spend-state.json');
const WINDOW_MS = 24 * 60 * 60 * 1000;

const num = (key, fallback) => {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${key} must be a non-negative number (got "${raw}")`);
  }
  return n;
};

export const limits = {
  get unlimited() {
    return process.env.SAGE_SPEND_UNLIMITED === '1';
  },
  get maxTx() {
    return { ETH: num('SAGE_MAX_TX_ETH', 0.1), SAGE: num('SAGE_MAX_TX_SAGE', 10000) };
  },
  get daily() {
    return { ETH: num('SAGE_DAILY_ETH', 0.5), SAGE: num('SAGE_DAILY_SAGE', 50000) };
  },
};

function loadState() {
  try {
    const s = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    if (!Array.isArray(s.spends)) return { spends: [] };
    return s;
  } catch {
    // missing/corrupt state must not fail OPEN — an unreadable ledger would
    // otherwise reset the budget to zero-spent on every call.
    return { spends: [] };
  }
}

function saveState(state) {
  try {
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    // If we cannot persist, we cannot enforce the rolling budget across
    // restarts. Surface it loudly rather than silently losing the ceiling.
    console.error(`[spendGuard] WARNING: could not persist spend ledger: ${e.message}`);
  }
}

/** Total already spent in the trailing 24h for one currency. */
function spentInWindow(state, currency) {
  const cutoff = Date.now() - WINDOW_MS;
  return state.spends
    .filter((s) => s.currency === currency && s.at >= cutoff)
    .reduce((sum, s) => sum + s.amount, 0);
}

/**
 * Throws unless this spend is within both the per-transaction ceiling and the
 * rolling 24h budget. Call IMMEDIATELY BEFORE signing.
 *
 * @param {object} p
 * @param {'ETH'|'SAGE'} p.currency
 * @param {number|string} p.amount   human units (not wei)
 * @param {string} p.tool            tool name, for the error + ledger
 * @param {string} [p.to]            recipient, for the ledger
 * @param {boolean} [p.serverPriced] true when the amount came from the site or
 *                                   a post author rather than the model — these
 *                                   are the "invisible spend" paths, so the
 *                                   error text has to name the real number.
 */
export function assertSpend({ currency, amount, tool, to, serverPriced = false }) {
  const cur = currency === 'ETH' ? 'ETH' : 'SAGE';
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt < 0) {
    throw new Error(`${tool}: refusing to spend a non-numeric amount (${amount})`);
  }
  if (amt === 0) return;
  if (limits.unlimited) return;

  const maxTx = limits.maxTx[cur];
  const daily = limits.daily[cur];
  const origin = serverPriced
    ? ' (this amount was set by the post author / server, not by you)'
    : '';

  if (maxTx === 0) {
    throw new Error(
      `${tool}: spending ${cur} is disabled (SAGE_MAX_TX_${cur} = 0). Refusing to send ${amt} ${cur}${origin}.`
    );
  }
  if (amt > maxTx) {
    throw new Error(
      `${tool}: ${amt} ${cur} exceeds the per-transaction limit of ${maxTx} ${cur}${origin}. ` +
        `Raise SAGE_MAX_TX_${cur} only if this spend is genuinely intended.`
    );
  }

  const state = loadState();
  const already = spentInWindow(state, cur);
  if (already + amt > daily) {
    throw new Error(
      `${tool}: ${amt} ${cur} would exceed the 24h budget of ${daily} ${cur} ` +
        `(${already.toFixed(6)} already spent)${origin}. Raise SAGE_DAILY_${cur} or wait for the window to roll.`
    );
  }
}

/** Record a CONFIRMED spend against the rolling budget. Call after tx.wait(). */
export function recordSpend({ currency, amount, tool, to, txHash }) {
  const cur = currency === 'ETH' ? 'ETH' : 'SAGE';
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return;
  const state = loadState();
  const cutoff = Date.now() - WINDOW_MS;
  // prune outside the window so the file cannot grow without bound
  state.spends = state.spends.filter((s) => s.at >= cutoff);
  state.spends.push({ at: Date.now(), currency: cur, amount: amt, tool, to: to || null, txHash: txHash || null });
  saveState(state);
}

/** Remaining headroom, for the status tool. */
export function spendStatus() {
  const state = loadState();
  const out = {};
  for (const cur of ['ETH', 'SAGE']) {
    const spent = spentInWindow(state, cur);
    out[cur] = {
      perTxLimit: limits.maxTx[cur],
      dailyLimit: limits.daily[cur],
      spent24h: Number(spent.toFixed(8)),
      remaining24h: Number(Math.max(0, limits.daily[cur] - spent).toFixed(8)),
    };
  }
  out.unlimitedOverride = limits.unlimited;
  return out;
}
