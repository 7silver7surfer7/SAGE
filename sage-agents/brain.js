// brain.js — turns an agent's REAL economic activity into an in-persona tweet.
//
// Uses Claude when ANTHROPIC_API_KEY is set; otherwise falls back to a simple
// template so the whole system runs offline at zero cost. The @anthropic-ai/sdk
// import is lazy so dry-runs work before `npm install`.
import { config } from './config.js';

const GLOBAL_RULES = `You write ONE tweet (max 280 characters) as an autonomous AI agent in the SAGE on-chain art economy.

Hard rules:
- You are a bot and never pretend otherwise; stay in your persona's voice.
- Ground the tweet in the ACTIVITY provided. Never invent trades, prices, holdings, or artworks.
- No financial advice, no "buy"/"sell" calls, no price predictions, no shilling at humans.
- Do NOT @-mention anyone except handles listed under PEERS. Never tag real users or brands.
- At most one hashtag, only #SAGE, and only if it fits naturally. No hashtag stuffing.
- No links unless one appears in ACTIVITY.
- Read like a person with a point of view, not an advertisement. Vary sentence shape.

Return ONLY the tweet text — no quotes, no preamble, no explanation.`;

export async function composeTweet({ persona, activity, state, peers }) {
  if (config.anthropicKey) {
    try {
      return clamp(await composeWithClaude({ persona, activity, state, peers }));
    } catch (e) {
      console.error(`[brain] Claude failed (${e.message}); using template fallback.`);
    }
  }
  return clamp(template({ persona, activity }));
}

async function composeWithClaude({ persona, activity, state, peers }) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: config.anthropicKey });

  const system = `You are ${persona.displayName} (@${persona.handle}), an autonomous agent.
Persona: ${persona.voice}

${GLOBAL_RULES}`;

  const user = [
    `ACTIVITY (what you just did on-chain, ground your tweet in this):`,
    JSON.stringify(activity, null, 2),
    ``,
    `YOUR STATE (balances/holdings, for flavor — don't just recite numbers):`,
    JSON.stringify(state?.summary ?? state, null, 2),
    ``,
    `PEERS (the only accounts you may @-mention; mention at most one, only if it adds something):`,
    peers.join(' '),
  ].join('\n');

  const resp = await client.messages.create({
    model: config.model,
    max_tokens: 300,
    system,
    messages: [{ role: 'user', content: user }],
  });

  if (resp.stop_reason === 'refusal') throw new Error('model refused');
  const text = (resp.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  if (!text) throw new Error('empty completion');
  return stripQuotes(text);
}

// Deterministic fallback so the pipeline always produces something.
function template({ persona, activity }) {
  const tag = { collector: '🖼️', trader: '📈', whale: '🐋', critic: '🧠', shitposter: '👾', lottery: '🎟️' }[
    persona.archetype
  ] || '🤖';
  const base = activity?.summary || 'watching the SAGE tape tick by';
  return `${tag} ${base}`;
}

function stripQuotes(s) {
  return s.replace(/^["'“”]+|["'“”]+$/g, '').trim();
}
function clamp(s) {
  const t = (s || '').trim();
  return t.length <= 280 ? t : t.slice(0, 277).trimEnd() + '…';
}
