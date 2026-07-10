/**
 * Node --require preload that fixes a dead upstream URL in @nomiclabs/hardhat-etherscan.
 *
 * That plugin hardcodes https://solc-bin.ethereum.org/bin/list.json to fetch the
 * official solc version list before verifying a contract. That host no longer
 * resolves (decommissioned; the project moved to binaries.soliditylang.org), so
 * every `hardhat verify` call fails with ENOTFOUND before it ever reaches Blockscout.
 *
 * This does NOT modify node_modules. It reads the original file (unmodified on
 * disk), patches the URL in memory, and registers the patched module under the
 * same path in Node's require cache — so the one `require()` call the plugin
 * makes internally resolves to our patched version for this process only.
 *
 * Usage:  NODE_OPTIONS="--require ./scripts/patch-solc-bin-url.js" npx hardhat verify ...
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');

const DEAD_URL = 'https://solc-bin.ethereum.org/bin/list.json';
const LIVE_URL = 'https://binaries.soliditylang.org/bin/list.json';

const targetPath = require.resolve('@nomiclabs/hardhat-etherscan/dist/src/solc/version.js');
const source = fs.readFileSync(targetPath, 'utf8');
if (!source.includes(DEAD_URL)) {
  // upstream may have fixed it, or path/content changed — don't silently no-op
  throw new Error(`patch-solc-bin-url.js: expected URL not found in ${targetPath}`);
}
const patched = source.replace(DEAD_URL, LIVE_URL);

const m = new Module(targetPath, module);
m.filename = targetPath;
m.paths = Module._nodeModulePaths(path.dirname(targetPath));
m._compile(patched, targetPath);
require.cache[targetPath] = m;

console.log('[patch-solc-bin-url] redirected solc version list fetch to binaries.soliditylang.org');
