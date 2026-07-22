// orchestrator.js — one "turn" per agent: read economy → act → compose → post.
// Runs turns in rounds, spaced out and jittered, with a per-agent daily cap and
// a file-based kill switch. This is the loop that makes the roster feel like a
// living economy instead of a broadcast.
import fs from 'fs';
import { config, killSwitchActive } from './config.js';
import { ROSTER, byId, peerHandles } from './personas.js';
import { getState, act } from './economy.js';
import { composeTweet } from './brain.js';
import { postTweet } from './twitter.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date().toISOString().slice(0, 10);
const posted = new Map(); // `${id}:${date}` -> count

function underDailyCap(persona) {
  const k = `${persona.id}:${today()}`;
  return (posted.get(k) || 0) < config.perAgentDailyCap;
}
function recordPost(persona) {
  const k = `${persona.id}:${today()}`;
  posted.set(k, (posted.get(k) || 0) + 1);
}
function log(entry) {
  try {
    fs.appendFileSync(config.logFile, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
  } catch { /* logging is best-effort */ }
}

export async function runTurn(persona) {
  if (!underDailyCap(persona)) {
    console.log(`  ⏸  @${persona.handle}: hit daily cap (${config.perAgentDailyCap}). Skipping.`);
    return;
  }
  const state = await getState(persona);
  const activity = await act(persona, state);
  const text = await composeTweet({
    persona,
    activity,
    state,
    peers: peerHandles(persona),
  });
  const result = await postTweet(persona, text);
  if (result.id && !result.skipped) recordPost(persona);
  log({ agent: persona.id, archetype: persona.archetype, action: activity.action, ok: activity.ok, text, post: result });
}

export async function runRound(agentIds) {
  const agents = (agentIds && agentIds.length ? agentIds.map(byId).filter(Boolean) : ROSTER);
  console.log(
    `\n▶ round · ${agents.length} agents · posts=${config.dryRunPosts ? 'DRY' : 'LIVE'} · chain=${config.dryRunEconomy ? 'DRY' : 'LIVE'} · model=${config.model}`
  );
  for (const persona of agents) {
    if (killSwitchActive()) {
      console.log('⏹  kill switch present — stopping round.');
      break;
    }
    try {
      await runTurn(persona);
    } catch (e) {
      console.error(`  ❌ @${persona.handle}: turn errored — ${e.message}`);
      log({ agent: persona.id, error: e.message });
    }
    await sleep(config.perAgentGapMs);
  }
}

export async function runForever(agentIds) {
  console.log('sage-agents: running. Create a file named STOP in this folder to halt between rounds.');
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (killSwitchActive()) {
      console.log('⏹  kill switch present — exiting loop.');
      return;
    }
    await runRound(agentIds);
    const wait = config.roundIntervalMs + Math.floor(Math.random() * config.jitterMs);
    console.log(`… next round in ${Math.round(wait / 1000)}s`);
    await sleep(wait);
  }
}
