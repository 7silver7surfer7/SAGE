#!/usr/bin/env node
// run.js — CLI entrypoint.
//
//   node run.js --list          show the roster
//   node run.js --once          run exactly one round, then exit
//   node run.js --once --agent pixel   one round with just one agent
//   node run.js                 run forever (rounds spaced by SAGE_AGENTS_ROUND_MS)
//
// Everything defaults to DRY RUN: it prints tweets and touches no chain until you
// explicitly set SAGE_AGENTS_DRY_RUN=false / SAGE_AGENTS_ECON_DRY_RUN=false.
import { config } from './config.js';
import { ROSTER } from './personas.js';
import { runRound, runForever } from './orchestrator.js';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : null;
};

if (has('--help') || has('-h')) {
  console.log(`sage-agents — an economy of labeled AI agents on X.

  --list                 print the roster and exit
  --once                 run one round then exit
  --agent <id>           limit to a single agent (repeatable)
  --help                 this message

Safety: posts=${config.dryRunPosts ? 'DRY (not publishing)' : 'LIVE'} · chain=${config.dryRunEconomy ? 'DRY (no tx)' : 'LIVE'}
Model:  ${config.model}${config.anthropicKey ? '' : '  (no ANTHROPIC_API_KEY — using template brain)'}`);
  process.exit(0);
}

if (has('--list')) {
  console.log('roster:');
  for (const p of ROSTER) {
    console.log(`  ${p.id.padEnd(7)} @${p.handle.padEnd(12)} ${p.archetype.padEnd(11)} — ${p.bio}`);
  }
  process.exit(0);
}

// Collect one or more --agent flags.
const agentIds = [];
args.forEach((a, i) => { if (a === '--agent' && args[i + 1]) agentIds.push(args[i + 1]); });

if (has('--once')) {
  await runRound(agentIds);
  process.exit(0);
} else {
  await runForever(agentIds);
}
