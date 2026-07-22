// economy.js — bridges each agent to the SAGE marketplace through the existing
// sage-mcp server. One MCP process is spawned per wallet and driven over
// JSON-RPC/stdio, so ALL transaction logic (SIWE sessions, pixel-claim mints,
// bids) is reused verbatim from sage-mcp/index.js — same approach as swarm.js.
//
// When config.dryRunEconomy is true (the default), no process is spawned and no
// chain is touched: getState() returns synthetic state and act() simulates the
// decision. That makes the whole framework runnable with zero funds and zero deps.
import { spawn } from 'child_process';
import { config } from './config.js';

// ── Real path: talk to sage-mcp for one wallet ─────────────────────────────
function callAgentTools(privateKey, calls) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [config.sageMcpPath], {
      env: { ...process.env, SAGE_AGENT_PRIVATE_KEY: privateKey, SAGE_SITE_URL: config.siteUrl },
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
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id != null && pending.has(msg.id)) {
          pending.get(msg.id)(msg);
          pending.delete(msg.id);
        }
      }
    });
    child.on('error', reject);
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
        clientInfo: { name: 'sage-agents', version: '0' },
      });
      child.stdin.write(
        JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n'
      );
      const out = [];
      for (const c of calls) {
        const r = await rpc('tools/call', { name: c.name, arguments: c.arguments || {} });
        const text = r.result?.content?.[0]?.text ?? JSON.stringify(r.result ?? r.error);
        out.push({ call: c.name, text });
      }
      child.kill();
      resolve(out);
    })().catch((e) => { child.kill(); reject(e); });
  });
}

function parse(text) { try { return JSON.parse(text); } catch { return null; } }

// ── State ──────────────────────────────────────────────────────────────────
export async function getState(persona) {
  if (config.dryRunEconomy) return mockState(persona);
  const key = process.env[persona.walletEnv];
  if (!key) return { error: `no wallet key in ${persona.walletEnv}`, drops: [] };
  const [bal, drops] = await callAgentTools(key, [
    { name: 'sage_balances' },
    { name: 'sage_list_drops' },
  ]);
  const balances = parse(bal.text) || {};
  const catalog = parse(drops.text) || [];
  return {
    balances,
    drops: catalog,
    summary: {
      sage: balances?.marketplace?.sage ?? balances?.sage ?? '?',
      pixels: balances?.pixels ?? '?',
      openDrops: catalog.length,
    },
  };
}

// ── Act — archetype decides the move, sage-mcp executes it ──────────────────
export async function act(persona, state) {
  const plan = decide(persona, state);
  if (!plan) return { action: 'idle', ok: true, summary: 'sat this round out and just watched the market' };

  if (config.dryRunEconomy) {
    return { ...plan, ok: true, simulated: true, summary: `${plan.summary} (simulated — dry run)` };
  }
  const key = process.env[persona.walletEnv];
  if (!key) return { action: plan.action, ok: false, summary: `wanted to ${plan.action} but has no funded wallet` };
  try {
    const [res] = await callAgentTools(key, [plan.call]);
    return { ...plan, ok: true, detail: res.text.replace(/\s+/g, ' ').slice(0, 300) };
  } catch (e) {
    return { ...plan, ok: false, summary: `tried to ${plan.action} but it failed: ${e.message}` };
  }
}

// Pure decision: given archetype + state, what tool call (if any) to make.
function decide(persona, state) {
  const s = persona.strategy || {};
  const drops = state?.drops || [];
  // Prefer a currently-live game; fall back to the first one listed.
  const pick = (list) => (list || []).find((x) => x.live) || (list || [])[0] || null;
  const firstEdition = () => {
    for (const d of drops) { const e = pick(d.openEditions); if (e) return e.editionId ?? e.id; }
    return null;
  };
  const firstAuction = () => {
    for (const d of drops) { const a = pick(d.auctions); if (a) return a; }
    return null;
  };
  const firstLottery = () => {
    for (const d of drops) { const l = pick(d.lotteries); if (l) return l.lotteryId ?? l.id; }
    return null;
  };

  switch (persona.archetype) {
    case 'collector': {
      const editionId = firstEdition();
      if (editionId == null) return null;
      return {
        action: 'mint',
        summary: `minted ${s.mintQty || 1}× open edition ${editionId}`,
        call: { name: 'sage_mint_open_edition', arguments: { editionId, quantity: s.mintQty || 1 } },
      };
    }
    case 'trader':
      return {
        action: 'buy_sage',
        summary: `swapped ${s.buyEthAmount || '0.01'} ETH into SAGE to keep the pixel meter running`,
        call: { name: 'sage_buy_sage', arguments: { ethAmount: s.buyEthAmount || '0.01' } },
      };
    case 'whale': {
      const a = firstAuction();
      if (!a) return null;
      const min = Number(a.nextMinBidSage ?? a.minBidSage ?? 1000);
      const bid = String(min + (s.bidMarginSage || 25));
      return {
        action: 'bid',
        summary: `bid ${bid} SAGE on auction ${a.auctionId ?? a.id}`,
        call: { name: 'sage_place_auction_bid', arguments: { auctionId: a.auctionId ?? a.id, bidSage: bid } },
      };
    }
    case 'lottery': {
      const lotteryId = firstLottery();
      if (lotteryId == null) return null;
      return {
        action: 'buy_tickets',
        summary: `grabbed ${s.ticketQty || 1} lottery ticket(s) on drawing ${lotteryId}`,
        call: { name: 'sage_buy_lottery_tickets', arguments: { lotteryId, tickets: s.ticketQty || 1 } },
      };
    }
    case 'shitposter': {
      if (Math.random() > (s.mintChance ?? 0.35)) return null; // usually just posts
      const editionId = firstEdition();
      if (editionId == null) return null;
      return {
        action: 'mint',
        summary: `impulse-minted edition ${editionId} because why not`,
        call: { name: 'sage_mint_open_edition', arguments: { editionId, quantity: 1 } },
      };
    }
    case 'critic':
    default:
      return null; // observers comment without transacting
  }
}

// ── Synthetic state for dry runs (no chain, no funds needed) ────────────────
function mockState(persona) {
  const editions = [18, 19, 20];
  const editionId = editions[Math.floor(Math.random() * editions.length)];
  const auctionId = 5;
  const lotteryId = 3;
  // Mirror the real sage_list_drops shape (openEditions/auctions/lotteries, `live`)
  // so the same picking logic runs in dry-run as against the live catalog.
  return {
    drops: [
      {
        name: 'Drop 15 — “Signal / Noise”',
        openEditions: [{ editionId, live: true }],
        auctions: [{ auctionId, nextMinBidSage: 1000 + Math.floor(Math.random() * 500), live: true }],
        lotteries: [{ lotteryId, live: true }],
      },
    ],
    summary: {
      sage: 1000 + Math.floor(Math.random() * 9000),
      pixels: Math.floor(Math.random() * 400),
      openDrops: 1,
    },
  };
}
