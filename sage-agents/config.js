// config.js — environment parsing, safety defaults, and a tiny zero-dependency
// .env loader so the framework boots and dry-runs with no `npm install`.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Minimal .env loader (avoids a hard dependency on dotenv for the dry-run path).
function loadEnvFile(p) {
  if (!fs.existsSync(p)) return;
  for (const raw of fs.readFileSync(p, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnvFile(path.join(here, '.env'));

const bool = (v, d) => (v == null ? d : /^(1|true|yes|on)$/i.test(String(v)));
const num = (v, d) => (v == null || v === '' ? d : Number(v));

export const config = {
  here,
  // Reuse the existing single-account MCP server for all on-chain actions.
  sageMcpPath: path.resolve(here, '..', 'sage-mcp', 'index.js'),
  siteUrl: process.env.SAGE_SITE_URL || 'https://sageart.xyz',

  // ── SAFETY DEFAULTS ──────────────────────────────────────────────────────
  // Nothing is published and no transaction is signed unless you flip these off.
  dryRunPosts: bool(process.env.SAGE_AGENTS_DRY_RUN, true), // true => never posts to X
  dryRunEconomy: bool(process.env.SAGE_AGENTS_ECON_DRY_RUN, true), // true => never touches chain

  // Content brain.
  model: process.env.SAGE_AGENTS_MODEL || 'claude-opus-4-8',
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',

  // Cadence — deliberately slow. A bot army that posts fast looks like spam
  // (and burns X API quota). Rounds are spaced out and jittered.
  roundIntervalMs: num(process.env.SAGE_AGENTS_ROUND_MS, 15 * 60 * 1000),
  jitterMs: num(process.env.SAGE_AGENTS_JITTER_MS, 90 * 1000),
  perAgentGapMs: num(process.env.SAGE_AGENTS_AGENT_GAP_MS, 20 * 1000),

  // Guardrails.
  perAgentDailyCap: num(process.env.SAGE_AGENTS_DAILY_CAP, 12),
  killSwitchFile: process.env.SAGE_AGENTS_KILL_FILE || path.join(here, 'STOP'),

  logFile: process.env.SAGE_AGENTS_LOG || path.join(here, 'agents.log.jsonl'),
};

// A file-based kill switch: `touch sage-agents/STOP` halts the loop between rounds.
export function killSwitchActive() {
  return fs.existsSync(config.killSwitchFile);
}
