#!/usr/bin/env node
// Has each of the 11 agent wallets (deployer + collector-1..10) mint one
// piece from the local test "rMonet" collection on testnet — collectionId 5
// on 0x5aC7DB61278fFd8F19f6d93957Cd47263C62c3Bf (chain 46630), maxSupply 11,
// limitPerUser 1, ungated, costs 0.000001 ETH each. Confirmed live via a
// direct on-chain getCollection(5) read: whitelist is AddressZero (open),
// startTime already elapsed, closeTime 0 (no deadline).
//
// This is a direct contract call (same mint(uint256,uint256) the site's own
// sage_mint_collection MCP tool uses), not a call through that tool, since
// this script needs to drive 11 separate keys in one run.
//
// SAFE BY DEFAULT: prints the plan and mints NOTHING unless you pass --send.
// This script is meant to be run BY YOU — it is deliberately never invoked
// by the assistant.
//
// Usage:
//   node agents/collect-rmonet-testnet.js          # dry run (default)
//   node agents/collect-rmonet-testnet.js --send   # actually mints
import { ethers } from 'ethers';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));
const walletsDir = path.join(here, 'wallets');

const args = process.argv.slice(2);
const SEND = args.includes('--send');

const RPC = 'https://rpc.testnet.chain.robinhood.com';
const CHAIN_ID = 46630;
const COLLECTION_ADDRESS = '0x5aC7DB61278fFd8F19f6d93957Cd47263C62c3Bf';
const COLLECTION_ID = 5;
const COLLECTION_ABI = JSON.parse(readFileSync(path.join(here, '..', 'abis', 'SageCollection.json'), 'utf8')).abi;

const manifest = JSON.parse(readFileSync(path.join(walletsDir, 'manifest.json'), 'utf8'));

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
  console.log(`collection:      #${COLLECTION_ID} on ${COLLECTION_ADDRESS}`);
  console.log(`window:          ${notOpenYet ? 'NOT OPEN YET' : closed ? 'CLOSED' : 'open'}`);
  console.log(`remaining:       ${remaining} / ${c.maxSupply}`);
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
    const txRequest = { to: COLLECTION_ADDRESS, value: c.costTokens };
    let gasLimit;
    try {
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
        `  ${agent.name.padEnd(12)} ${agent.address} — needs testnet ETH ` +
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
