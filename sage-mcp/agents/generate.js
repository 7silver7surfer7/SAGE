#!/usr/bin/env node
// Generates fresh, dedicated wallets for a roster of SAGE collector agents
// (+ one "deployer"/orchestrator wallet) and writes each one a ready-to-paste
// Claude Desktop / Claude Code MCP config, pointed at MAINNET (sageart.xyz is
// the live production marketplace — see Sage-Solidity-main/contracts.js
// `robinhood` block for where these addresses come from).
//
// SAFE BY DESIGN:
//  - 100% local key generation (ethers.Wallet.createRandom()) — no network
//    calls, nothing sent anywhere.
//  - Generates keys and configs only. Does NOT fund any wallet and does NOT
//    call any SAGE tool — that's a deliberate boundary, not an oversight.
//  - Private keys are written ONLY to sage-mcp/agents/wallets/ (gitignored —
//    see root .gitignore) and are NEVER printed to stdout. The console
//    summary shows addresses only.
//
// Usage:
//   node agents/generate.js
//
// Output (sage-mcp/agents/wallets/, gitignored):
//   <name>.mcp.json   — one per agent: {"mcpServers":{"sage-<name>": {...}}}
//                        paste straight into claude_desktop_config.json (or
//                        merge the inner block into an existing one)
//   manifest.json      — [{ name, role, address }] — addresses only, no keys
//   ADDRESSES.txt       — plain list of "name  address", for quick copy/paste
//                        when sending funding instructions
import { ethers } from 'ethers';
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'wallets');
mkdirSync(outDir, { recursive: true });

const sageMcpIndex = path.resolve(here, '..', 'index.js');

// Mainnet marketplace deployment (Sage-Solidity-main/contracts.js `robinhood`
// block, verified on-chain 2026-07-12) — sage-mcp's own config.js still
// DEFAULTS to testnet (other in-flight work depends on that default), so
// every agent gets these as explicit env overrides instead of relying on
// changed defaults.
const MAINNET_ENV = {
  SAGE_SITE_URL: 'https://sageart.xyz',
  SAGE_MARKETPLACE_RPC: 'https://rpc.mainnet.chain.robinhood.com',
  SAGE_MARKETPLACE_CHAIN_ID: '4663',
  SAGE_TOKEN_ADDRESS: '0x14561006002e8f76E68EC69e6A32527730bb73c8',
  SAGE_OPENEDITION_ADDRESS: '0x78cA991872839Bfa6223A41039E3895ce8eefF5D',
  SAGE_LOTTERY_ADDRESS: '0xfF1dF77766c5dbc3C440a8d70782406B32C0Fb54',
  SAGE_AUCTION_ADDRESS: '0x83Eac0DCfd0bC5D52Edf4e631CdDb6C0e6438E03',
  SAGE_COLLECTION_ADDRESS: '0xc9821B48922111fBe9067f4f63bdD0A6599aC81C',
  // SAGE_REWARDS_ADDRESS omitted deliberately: mainnet pixel-priced mints
  // aren't live yet, so the testnet default there is harmless (unused).
  // SAGE_MAINNET_* (the DEX chain) is left at config.js's own default —
  // it already points at mainnet, since that's the only chain with a market.
};

const roster = [
  // "deployer" — sage-mcp exposes no drop-deployment tool (creating a drop
  // requires on-chain role.admin + the dashboard UI, a materially different
  // and more sensitive grant than a collector wallet). Until/unless that's
  // wired up, this wallet is functionally identical to the collectors —
  // labeled separately so it's easy to give it a distinct job later
  // (orchestrating the other 10, holding shared gas reserve, etc.).
  { name: 'deployer', role: 'deployer' },
  ...Array.from({ length: 10 }, (_, i) => ({ name: `collector-${i + 1}`, role: 'collector' })),
];

const results = [];
for (const agent of roster) {
  const wallet = ethers.Wallet.createRandom();
  const config = {
    mcpServers: {
      [`sage-${agent.name}`]: {
        command: 'node',
        args: [sageMcpIndex],
        env: {
          SAGE_AGENT_PRIVATE_KEY: wallet.privateKey,
          ...MAINNET_ENV,
        },
      },
    },
  };
  writeFileSync(
    path.join(outDir, `${agent.name}.mcp.json`),
    JSON.stringify(config, null, 2) + '\n',
    { mode: 0o600 }
  );
  results.push({ name: agent.name, role: agent.role, address: wallet.address });
}

writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(results, null, 2) + '\n');
writeFileSync(
  path.join(outDir, 'ADDRESSES.txt'),
  results.map((r) => `${r.name.padEnd(12)} ${r.role.padEnd(10)} ${r.address}`).join('\n') + '\n'
);

console.log(`Generated ${results.length} wallets -> ${outDir}`);
console.log('(private keys never printed — see the .mcp.json files, gitignored)\n');
for (const r of results) console.log(`  ${r.name.padEnd(12)} ${r.role.padEnd(10)} ${r.address}`);
