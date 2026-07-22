#!/usr/bin/env node
// Has each of the 10 collector wallets mint one piece of the real rMonet
// collection on MAINNET — collectionId 1 on 0x2c25d08251a0a1B6Ef954811a177D85482a82373
// (chain 4663), maxSupply 100, limitPerUser 1, free (costTokens 0, gas only).
// Whitelist-gated (0x2e07Bf3E70958998B73126F1E13Ab9163f58547c) — all 10
// collector addresses were added via the dashboard's Allowlists tab and
// confirmed on-chain (isWhitelisted == true) before this script was written.
//
// This is a REAL, LIVE production collection that real collectors are also
// minting from concurrently — remaining supply can shrink between checks, so
// eligibility (including "still sold out or not") is re-verified per wallet
// right before its mint via estimateGas, which reverts cleanly if another
// mint took the last spot in the meantime.
//
// Deliberately excludes `deployer` — the user asked to whitelist and mint
// with "the ten agents" specifically.
//
// SAFE BY DEFAULT: prints the plan and mints NOTHING unless you pass --send.
// This script is meant to be run BY YOU — it is deliberately never invoked
// by the assistant.
//
// Usage:
//   node agents/collect-rmonet-mainnet.js          # dry run (default)
//   node agents/collect-rmonet-mainnet.js --send   # actually mints
import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));
const walletsDir = path.join(here, 'wallets');

const args = process.argv.slice(2);
const SEND = args.includes('--send');

const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const CHAIN_ID = 4663;
const COLLECTION_ADDRESS = '0x2c25d08251a0a1B6Ef954811a177D85482a82373';
const COLLECTION_ID = 1;
const COLLECTION_ABI = JSON.parse(readFileSync(path.join(here, '..', 'abis', 'SageCollection.json'), 'utf8')).abi;

const manifest = JSON.parse(readFileSync(path.join(walletsDir, 'manifest.json'), 'utf8')).filter(
  (a) => a.role === 'collector'
);

const provider = new ethers.providers.StaticJsonRpcProvider(RPC, CHAIN_ID);
// same legacy-gas-pricing fix used throughout this chain's scripts: real gas
// price here is a fraction of a gwei, but ethers' default EIP-1559 estimate
// assumes a 1.5 gwei priority fee.
const _getGasPrice = provider.getGasPrice.bind(provider);
provider.getFeeData = async () => {
  const gasPrice = await _getGasPrice();
  return { gasPrice, maxFeePerGas: null, maxPriorityFeePerGas: null, lastBaseFeePerGas: null };
};

const GAS_PRICE_BUFFER_PCT = 150;
async function bufferedGasPrice() {
  return (await provider.getGasPrice()).mul(GAS_PRICE_BUFFER_PCT).div(100);
}

const collectionReader = new ethers.Contract(COLLECTION_ADDRESS, COLLECTION_ABI, provider);

function loadKey(name) {
  const config = JSON.parse(readFileSync(path.join(walletsDir, `${name}.mcp.json`), 'utf8'));
  return Object.values(config.mcpServers)[0].env.SAGE_AGENT_PRIVATE_KEY;
}

(async () => {
  const c = await collectionReader.getCollection(COLLECTION_ID);
  if (c.nftContract === ethers.constants.AddressZero) {
    console.error(`collectionId ${COLLECTION_ID} not found on ${COLLECTION_ADDRESS}`);
    process.exit(1);
  }
  const now = Math.floor(Date.now() / 1000);
  const closed = Number(c.closeTime) !== 0 && now > Number(c.closeTime);
  const notOpenYet = now < Number(c.startTime);
  const remaining = Number(c.maxSupply) - Number(c.mintCount);
  console.log(`collection:      #${COLLECTION_ID} on ${COLLECTION_ADDRESS} (MAINNET)`);
  console.log(`window:          ${notOpenYet ? 'NOT OPEN YET' : closed ? 'CLOSED' : 'open'}`);
  console.log(`remaining:       ${remaining} / ${c.maxSupply} (live — other collectors may also be minting)`);
  console.log(`cost:            ${ethers.utils.formatEther(c.costTokens)} ETH each\n`);
  if (notOpenYet || closed || remaining <= 0) {
    console.error('Nothing to do — window closed or sold out.');
    process.exit(1);
  }

  for (const agent of manifest) {
    const wallet = new ethers.Wallet(loadKey(agent.name), provider);
    const alreadyMinted = await collectionReader.mintedByUser(COLLECTION_ID, agent.address);
    if (alreadyMinted.gte(c.limitPerUser)) {
      console.log(`  ${agent.name.padEnd(12)} ${agent.address} — already minted, skipping`);
      continue;
    }
    const balance = await provider.getBalance(agent.address);
    const gasPrice = await bufferedGasPrice();
    let gasLimit;
    try {
      // also re-verifies eligibility live (whitelist, sold-out race, window) —
      // reverts cleanly here instead of wasting gas on a broadcast that fails.
      gasLimit = (
        await collectionReader.estimateGas.mint(COLLECTION_ID, 1, { from: agent.address, value: c.costTokens })
      )
        .mul(130)
        .div(100);
    } catch (e) {
      console.log(`  ${agent.name.padEnd(12)} ${agent.address} — mint would revert: ${e.reason || e.message}`);
      continue;
    }
    const estCost = c.costTokens.add(gasPrice.mul(gasLimit));
    if (balance.lt(estCost)) {
      console.log(
        `  ${agent.name.padEnd(12)} ${agent.address} — needs mainnet ETH ` +
          `(has ${ethers.utils.formatEther(balance)}, needs ~${ethers.utils.formatEther(estCost)})`
      );
      continue;
    }

    if (!SEND) {
      console.log(`  ${agent.name.padEnd(12)} ${agent.address} — [dry-run] would mint 1 (funded, eligible)`);
      continue;
    }
    const collection = new ethers.Contract(COLLECTION_ADDRESS, COLLECTION_ABI, wallet);
    // Reuse the gasLimit already estimated above (WITH the wallet's own
    // address as `from`) instead of re-estimating generically — a plain
    // provider.estimateGas(tx) with no `from` defaults to the zero address,
    // which this contract's mint() rejects outright ("mint to the zero
    // address") since it mints to msg.sender. Only refetch gas PRICE fresh,
    // since that (unlike gasLimit) genuinely drifts between estimate and send.
    const sendGasPrice = await bufferedGasPrice();
    const tx = await collection.mint(COLLECTION_ID, 1, {
      value: c.costTokens,
      gasPrice: sendGasPrice,
      gasLimit,
    });
    console.log(`  ${agent.name.padEnd(12)} ${agent.address} — minting ... ${tx.hash}`);
    await tx.wait(1);
    console.log(`    confirmed`);
  }

  if (!SEND) {
    console.log('\nDry run only — re-run with --send to actually mint.');
  } else {
    console.log('\nDone.');
  }
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
