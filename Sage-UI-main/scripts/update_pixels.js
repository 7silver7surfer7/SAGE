/**
 * SAGE pixels (staking points) updater for Robinhood Chain — mainnet + testnet.
 *
 * Replaces Sage-Solidity/scripts/update_balances.js, which relied on the
 * Covalent API (no Robinhood Chain support). This script talks directly to the
 * Robinhood RPCs:
 *
 *   1. Scans SAGE-token Transfer events on every configured chain into the
 *      TokenTransaction table (one AssetType per chain).
 *   2. Recomputes every user's pixels per asset: min(balance, 100k SAGE) * 0.25
 *      per day, accrued second-by-second from each balance change, then summed
 *      across assets.
 *   3. Upserts EarnedPoints, which /api/points serves to the UI.
 *
 * Run periodically (e.g. cron/launchd every hour):  npm run points:update
 *
 * RewardType row semantics (seeded on first run):
 *   rewardRate        = pixels per whole SAGE token per DAY (0.25)
 *   positionSizeLimit = balance cap in wei ("100000" + 18 zeros)
 */
// dotenv is a dev convenience; inside the Pi/standalone container env vars
// come from docker-compose and the package may not be traced into the image
try {
  require('dotenv').config();
} catch {}
const { PrismaClient } = require('@prisma/client');
const { ethers } = require('ethers');
const prisma = new PrismaClient();

// Oracle that signs each user's pixel balance so it can be spent on-chain
// (lottery tickets / open-edition mints). Its address must be set as the
// signerAddress on the Lottery and SAGEOpenEdition contracts. When unset,
// balances are stored with an empty signature — the UI can still show pixels
// and users can pay with SAGE, but pixel-priced purchases stay unavailable.
const POINTS_ORACLE_PK = process.env.POINTS_ORACLE_PK || '';
const oracle = POINTS_ORACLE_PK ? new ethers.Wallet(POINTS_ORACLE_PK) : null;

/**
 * Signs (address user, uint256 points) exactly as the contracts verify it:
 * ECDSA.recover(prefixed(keccak256(abi.encode(user, points))), sig) == signer.
 */
async function signPointsBalance(walletAddress, points) {
  if (!oracle) return '';
  const hash = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(['address', 'uint256'], [walletAddress, points])
  );
  // signMessage over the raw 32-byte hash applies the "\x19Ethereum Signed
  // Message:\n32" prefix, matching the contracts' prefixed() helper.
  return oracle.signMessage(ethers.utils.arrayify(hash));
}

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const REORG_SAFETY_BLOCKS = 10;
const REWARD_RATE_PER_DAY = 0.25; // pixels per SAGE per day
const CAP_WEI = 100000n * 10n ** 18n; // 100,000 SAGE per asset
const WEI = 10n ** 18n;

// One entry per chain whose SAGE holdings earn pixels. The cap applies per asset.
const ASSETS = [
  {
    type: 'ETH_ASH', // legacy enum name: SAGE on Robinhood mainnet
    label: 'SAGE (Robinhood mainnet)',
    rpcUrl: 'https://rpc.mainnet.chain.robinhood.com',
    chainId: 4663,
    token: '0x08deaa8250beAeD65366fbbde0088E76261637bA',
    deployBlock: 5442246, // first Transfer of this token
  },
  {
    type: 'SAGE_TESTNET',
    label: 'SAGE (Robinhood testnet)',
    rpcUrl: 'https://rpc.testnet.chain.robinhood.com',
    chainId: 46630,
    // testnet's own SAGE deployment (per user, 2026-07-09)
    token: '0x5498Ab846Bc64819eB4Fa8c1A76d7DDef594AA0B',
    deployBlock: 88807242, // first Transfer of this token
  },
];

async function rpc(rpcUrl, method, params) {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${JSON.stringify(json.error)}`);
  return json.result;
}

async function ensureRewardType(asset) {
  return prisma.rewardType.upsert({
    where: { type: asset.type },
    update: {},
    create: {
      type: asset.type,
      rewardRate: REWARD_RATE_PER_DAY,
      lastBlockInspected: asset.deployBlock - 1,
      chainId: asset.chainId,
      contract: asset.token,
      startingBlock: asset.deployBlock,
      positionSizeLimit: CAP_WEI.toString(),
    },
  });
}

async function scanTransfers(asset, rewardType) {
  const latest = parseInt(await rpc(asset.rpcUrl, 'eth_blockNumber', []), 16) - REORG_SAFETY_BLOCKS;
  const fromBlock = Math.max(rewardType.lastBlockInspected + 1, rewardType.startingBlock);
  if (fromBlock > latest) {
    console.log(`[${asset.label}] no new blocks to scan.`);
    return;
  }
  console.log(`[${asset.label}] scanning Transfer events from block ${fromBlock} to ${latest}…`);
  const logs = await rpc(asset.rpcUrl, 'eth_getLogs', [
    {
      address: asset.token,
      topics: [TRANSFER_TOPIC],
      fromBlock: '0x' + fromBlock.toString(16),
      toBlock: '0x' + latest.toString(16),
    },
  ]);

  const blockNumbers = [...new Set(logs.map((l) => l.blockNumber))];
  const timestamps = {};
  for (const bn of blockNumbers) {
    const block = await rpc(asset.rpcUrl, 'eth_getBlockByNumber', [bn, false]);
    timestamps[bn] = parseInt(block.timestamp, 16);
  }

  // Dedupe against rows already stored (idempotent re-runs)
  const existing = await prisma.tokenTransaction.findMany({
    where: { assetType: asset.type },
    select: { txHash: true, from: true, to: true, value: true },
  });
  const seen = new Set(existing.map((t) => `${t.txHash}|${t.from}|${t.to}|${t.value}`));

  const rows = [];
  for (const log of logs) {
    const from = ('0x' + log.topics[1].slice(26)).toLowerCase();
    const to = ('0x' + log.topics[2].slice(26)).toLowerCase();
    const value = BigInt(log.data).toString();
    const key = `${log.transactionHash}|${from}|${to}|${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      txHash: log.transactionHash,
      assetType: asset.type,
      blockNumber: parseInt(log.blockNumber, 16),
      blockTimestamp: timestamps[log.blockNumber],
      from,
      to,
      value,
    });
  }
  if (rows.length) {
    await prisma.tokenTransaction.createMany({ data: rows });
  }
  await prisma.rewardType.update({
    where: { type: asset.type },
    data: { lastBlockInspected: latest },
  });
  console.log(`[${asset.label}] stored ${rows.length} new transactions; lastBlockInspected=${latest}.`);
}

const PER_SECOND = REWARD_RATE_PER_DAY / 86400;

/** Pixels earned by a wei balance over a time span (capped per asset). */
function pixelsForSpan(balanceWei, fromTs, untilTs) {
  if (fromTs <= 0 || untilTs <= fromTs) return 0;
  let counted = balanceWei;
  if (counted < 0n) counted = 0n;
  if (counted > CAP_WEI) counted = CAP_WEI;
  const tokens = Number(counted / WEI) + Number(counted % WEI) / 1e18;
  return tokens * PER_SECOND * (untilTs - fromTs);
}

const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

// Run an async fn over items with a bounded number of in-flight calls, keeping
// results index-aligned with the input. Used to parallelize per-holder RPCs.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// eth_getCode cache: only EOAs earn pixels. Contracts that hold SAGE (the token
// itself, the Uniswap pair, the auction/open-edition escrow) must be excluded —
// they'd otherwise accrue pixels and get a bogus User row.
const codeCache = new Map();
async function isContract(address) {
  const key = address.toLowerCase();
  if (codeCache.has(key)) return codeCache.get(key);
  let contract = false;
  for (const asset of ASSETS) {
    try {
      const code = await rpc(asset.rpcUrl, 'eth_getCode', [address, 'latest']);
      if (code && code !== '0x') {
        contract = true;
        break;
      }
    } catch {}
  }
  codeCache.set(key, contract);
  return contract;
}

/**
 * Folds NEW transfers (since each asset's pointsBlockProcessed watermark)
 * into per-(holder, asset) PixelAccrual checkpoints. The old version reloaded
 * the ENTIRE TokenTransaction table and replayed every holder's full history
 * every run — memory and time grew forever with chain activity. Now each run
 * touches only the new rows; the first run after this change folds the whole
 * backlog once and checkpoints it.
 */
async function foldNewTransfersIntoAccruals() {
  for (const asset of ASSETS) {
    const rt = await prisma.rewardType.findUnique({ where: { type: asset.type } });
    const fromBlock = rt?.pointsBlockProcessed ?? 0;
    const newTxns = await prisma.tokenTransaction.findMany({
      where: { assetType: asset.type, blockNumber: { gt: fromBlock } },
      orderBy: { blockNumber: 'asc' },
    });
    if (newTxns.length === 0) continue;

    const touched = new Set();
    for (const tx of newTxns) {
      touched.add(tx.from.toLowerCase());
      touched.add(tx.to.toLowerCase());
    }
    touched.delete(ZERO_ADDR);
    const existing = await prisma.pixelAccrual.findMany({
      where: { assetType: asset.type, address: { in: [...touched] } },
    });
    const state = new Map(existing.map((r) => [r.address, r]));

    let maxBlock = fromBlock;
    for (const tx of newTxns) {
      if (tx.blockNumber > maxBlock) maxBlock = tx.blockNumber;
      const from = tx.from.toLowerCase();
      const to = tx.to.toLowerCase();
      if (from === to) continue;
      for (const [addr, delta] of [
        [from, -BigInt(tx.value)],
        [to, BigInt(tx.value)],
      ]) {
        if (addr === ZERO_ADDR) continue;
        let s = state.get(addr);
        if (!s) {
          s = { address: addr, assetType: asset.type, balance: '0', pixels: 0, refTime: 0 };
          state.set(addr, s);
        }
        // accrue the balance held since the last change, then apply this one
        s.pixels += pixelsForSpan(BigInt(s.balance), s.refTime, tx.blockTimestamp);
        s.balance = (BigInt(s.balance) + delta).toString();
        if (tx.blockTimestamp > s.refTime) s.refTime = tx.blockTimestamp;
      }
    }

    for (const s of state.values()) {
      await prisma.pixelAccrual.upsert({
        where: { address_assetType: { address: s.address, assetType: asset.type } },
        update: { balance: s.balance, pixels: s.pixels, refTime: s.refTime },
        create: {
          address: s.address,
          assetType: asset.type,
          balance: s.balance,
          pixels: s.pixels,
          refTime: s.refTime,
        },
      });
    }
    await prisma.rewardType.update({
      where: { type: asset.type },
      data: { pointsBlockProcessed: maxBlock },
    });
    console.log(
      `[${asset.label}] folded ${newTxns.length} new transfers into ${state.size} accruals; pointsBlockProcessed=${maxBlock}.`
    );
  }
}

async function updateEarnedPoints() {
  const now = Math.floor(Date.now() / 1000);
  await foldNewTransfersIntoAccruals();

  // One small row per (holder, asset) — bounded by holder count, not history.
  // Holders are derived from on-chain activity, NOT the User table: a wallet
  // earns pixels for HOLDING SAGE whether or not it ever visited the site.
  const accruals = await prisma.pixelAccrual.findMany();
  const byHolder = new Map();
  for (const a of accruals) {
    if (!byHolder.has(a.address)) byHolder.set(a.address, []);
    byHolder.get(a.address).push(a);
  }

  // Classify contract-vs-EOA in parallel (bounded) rather than one blocking
  // eth_getCode per holder — each is an independent RPC.
  const holderList = [...byHolder.keys()];
  const contractFlags = await mapWithConcurrency(holderList, 8, (h) => isContract(h));
  const isContractByAddr = new Map(holderList.map((h, i) => [h, contractFlags[i]]));

  const summary = [];
  for (const lower of holderList) {
    if (isContractByAddr.get(lower)) continue;
    // EIP-55 checksum so the row matches this wallet's future SIWE login exactly
    // (SIWE stores the checksummed address; a lowercase row would orphan behind a
    //  second account). getAddress() is deterministic, so existing rows still match.
    const walletAddress = ethers.utils.getAddress(lower);
    let totalPixels = 0;
    const balances = {};
    for (const a of byHolder.get(lower)) {
      const balance = BigInt(a.balance);
      // stored pixels run through refTime; the held balance keeps earning to now
      totalPixels += a.pixels + pixelsForSpan(balance, a.refTime, now);
      const label = ASSETS.find((x) => x.type === a.assetType)?.label || a.assetType;
      balances[label] = (Number(balance / WEI) + Number(balance % WEI) / 1e18).toFixed(2);
    }
    const rounded = Math.floor(totalPixels);
    const signedMessage = await signPointsBalance(walletAddress, rounded);
    // EarnedPoints.address FKs to User.walletAddress, so ensure a minimal account
    // exists for holders that never signed in. It's forward-compatible: if they
    // later log in, getUser finds this same (checksummed) row.
    await prisma.user.upsert({
      where: { walletAddress },
      update: {},
      create: { walletAddress },
    });
    await prisma.earnedPoints.upsert({
      where: { address: walletAddress },
      update: { totalPointsEarned: BigInt(rounded), updatedAt: new Date(), signedMessage },
      create: { address: walletAddress, totalPointsEarned: BigInt(rounded), signedMessage },
    });
    summary.push({ address: walletAddress, ...balances, pixels: rounded });
  }
  console.table(summary);
}

(async () => {
  console.log(
    oracle
      ? `Signing pixel balances with oracle ${oracle.address}`
      : 'POINTS_ORACLE_PK unset — balances stored without signatures (pixel-priced purchases disabled)'
  );
  for (const asset of ASSETS) {
    const rewardType = await ensureRewardType(asset);
    await scanTransfers(asset, rewardType);
  }
  await updateEarnedPoints();
  await prisma.$disconnect();
  console.log('Pixels update complete.');
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
