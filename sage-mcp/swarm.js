#!/usr/bin/env node
// Multi-account driver: runs a set of agent wallets through a drop — each mints
// the given open edition(s) and places a laddered bid on the auction. It reuses
// the single-account MCP server (spawning it once per key) so there is ZERO
// duplicated transaction logic: pixel-claim mints, SIWE sessions, bid recording
// all come straight from index.js.
//
// Config (env):
//   SAGE_SWARM_KEYS      comma-separated private keys (one per account)   [required]
//   SAGE_SITE_URL        site for the drop catalog / pixel + bid recording [default prod]
//   SAGE_SWARM_EDITIONS  comma-separated on-chain editionIds to mint       [required]
//   SAGE_SWARM_AUCTION   auctionId to bid on                               [optional]
//   SAGE_SWARM_QTY       copies to mint per edition per account            [default 1]
//   SAGE_SWARM_BID_MARGIN  extra SAGE added over the on-chain next-min bid [default 5]
//
// Example (drop 15):
//   SAGE_SWARM_KEYS=0xaaa...,0xbbb...,... \
//   SAGE_SWARM_EDITIONS=18,19 SAGE_SWARM_AUCTION=5 \
//   node swarm.js
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(here, 'index.js');

const KEYS = (process.env.SAGE_SWARM_KEYS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const SITE = process.env.SAGE_SITE_URL || 'https://sageart.xyz';
const EDITIONS = (process.env.SAGE_SWARM_EDITIONS || '')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n));
const AUCTION = process.env.SAGE_SWARM_AUCTION ? Number(process.env.SAGE_SWARM_AUCTION) : null;
const QTY = Number(process.env.SAGE_SWARM_QTY || '1');
const BID_MARGIN = Number(process.env.SAGE_SWARM_BID_MARGIN || '5');

if (KEYS.length === 0) {
  console.error('SAGE_SWARM_KEYS is empty — provide the agent private keys (comma-separated).');
  process.exit(1);
}

// Run a sequence of tool calls against the MCP started with a specific key.
function runAccount(privateKey, calls) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [SERVER], {
      env: { ...process.env, SAGE_AGENT_PRIVATE_KEY: privateKey, SAGE_SITE_URL: SITE },
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    let buf = '';
    const pending = new Map();
    let id = 1;
    child.stdout.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id != null && pending.has(msg.id)) {
          pending.get(msg.id)(msg);
          pending.delete(msg.id);
        }
      }
    });
    const rpc = (method, params) =>
      new Promise((res, rej) => {
        const myId = id++;
        pending.set(myId, res);
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: myId, method, params }) + '\n');
        setTimeout(() => rej(new Error(`timeout on ${method}`)), 180000);
      });

    (async () => {
      await rpc('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'swarm', version: '0' },
      });
      child.stdin.write(
        JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n'
      );
      const results = [];
      for (const c of calls) {
        const r = await rpc('tools/call', { name: c.name, arguments: c.arguments || {} });
        const text = r.result?.content?.[0]?.text ?? JSON.stringify(r.result ?? r.error);
        results.push({ call: c.name, args: c.arguments, text });
      }
      child.kill();
      resolve(results);
    })().catch((e) => {
      child.kill();
      reject(e);
    });
  });
}

// Read the auction's current on-chain next-minimum bid via sage_list_drops.
async function nextMinBid(privateKey) {
  if (AUCTION == null) return null;
  const [drops] = await runAccount(privateKey, [{ name: 'sage_list_drops' }]);
  try {
    const parsed = JSON.parse(drops.text);
    for (const d of parsed) {
      for (const a of d.auctions || []) {
        if (a.auctionId === AUCTION) return Number(a.nextMinBidSage);
      }
    }
  } catch {}
  return null;
}

(async () => {
  console.log(
    `swarm: ${KEYS.length} accounts | site ${SITE} | editions [${EDITIONS.join(', ')}] | auction ${AUCTION ?? 'none'}`
  );
  for (let i = 0; i < KEYS.length; i++) {
    const key = KEYS[i];
    console.log(`\n========== account ${i + 1}/${KEYS.length} ==========`);
    const calls = [];
    for (const editionId of EDITIONS) {
      calls.push({ name: 'sage_mint_open_edition', arguments: { editionId, quantity: QTY } });
    }
    if (AUCTION != null) {
      // ladder above the current highest so each account can win in turn
      const min = await nextMinBid(key);
      const bid = (min != null ? min : 1000) + BID_MARGIN;
      calls.push({
        name: 'sage_place_auction_bid',
        arguments: { auctionId: AUCTION, bidSage: String(bid) },
      });
    }
    try {
      const results = await runAccount(key, calls);
      for (const r of results) console.log(`  [${r.call}]`, r.text.replace(/\s+/g, ' ').slice(0, 300));
    } catch (e) {
      console.log(`  account ${i + 1} error:`, e.message);
    }
  }
  console.log('\nswarm complete.');
})();
