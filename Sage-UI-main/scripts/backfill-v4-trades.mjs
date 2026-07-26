#!/usr/bin/env node
/**
 * Backfill SocialTokenTrade from a Uniswap V4 pool.
 *
 * WHY THE EXISTING SWEEP FINDS NOTHING
 * ------------------------------------
 * social.page.ts's lazy pool sweep reads Swap events off a v2 PAIR CONTRACT.
 * V4 has no pair: every pool lives inside the singleton PoolManager, and swaps
 * are emitted there keyed by a poolId (keccak of the abi-encoded PoolKey). A
 * v2-shaped sweep against a v4 token scans an address that never emits, finds
 * zero, and reports success — which is exactly what the SAGE token page shows.
 *
 * The PoolKey is already pinned in utilities/uniswapV4.ts (V4_POOLS); this
 * recomputes the same poolId and filters PoolManager logs on it.
 *
 * V4 SIGN CONVENTION: amount0/amount1 are int128 from the POOL's perspective —
 * negative means the pool paid it out, positive means it took it in. So a BUY
 * of the token (ETH in, token out) has amount0 > 0 and amount1 < 0 when the
 * token is currency1. Getting this backwards silently inverts every buy and
 * sell on the chart.
 *
 *   node scripts/backfill-v4-trades.mjs            # dry run
 *   node scripts/backfill-v4-trades.mjs --commit   # write
 */
import { ethers } from 'ethers';
import { PrismaClient } from '@prisma/client';

const TOKEN = '0xE21a2b120FAcF995bC8bF6b1843f409E568beBA3';
const WETH = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73';
const POOL_MANAGER = '0x8366a39CC670B4001A1121B8F6A443A643e40951';
const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const CHAIN_ID = 4663;
const EXPLORER = 'https://robinhoodchain.blockscout.com';

// must match V4_POOLS in utilities/uniswapV4.ts
const POOL_KEY = {
  currency0: WETH,
  currency1: TOKEN,
  fee: 8388608, // DYNAMIC_FEE_FLAG — the Doppler hook sets the real fee
  tickSpacing: 200,
  hooks: '0x4e3468951D49f2EEa976eD0D6e75fFCb44a9a544',
};

const CHUNK = 2000; // this RPC rejects wider eth_getLogs windows
const WEI = 1e18;
const COMMIT = process.argv.includes('--commit');
const prisma = new PrismaClient();

const SWAP_TOPIC = ethers.utils.id(
  'Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)'
);

function poolIdOf(k) {
  return ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ['address', 'address', 'uint24', 'int24', 'address'],
      [k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks]
    )
  );
}

async function creationBlock(provider, address) {
  // Same reasoning as seed-from-purchases: this RPC is not a reliable archive
  // node for getCode, so a binary search converges on a different wrong block
  // each run. Read the creation tx from the explorer instead.
  const r = await fetch(`${EXPLORER}/api/v2/addresses/${address}`).catch(() => null);
  const meta = r && r.ok ? await r.json().catch(() => null) : null;
  const hash = meta?.creation_transaction_hash || meta?.creation_tx_hash;
  if (!hash) throw new Error('could not read the token creation block from the explorer');
  const receipt = await provider.getTransactionReceipt(hash);
  if (!receipt?.blockNumber) throw new Error(`creation tx ${hash} has no receipt`);
  return receipt.blockNumber;
}

async function main() {
  const provider = new ethers.providers.StaticJsonRpcProvider(RPC, CHAIN_ID);
  const head = await provider.getBlockNumber();
  const poolId = poolIdOf(POOL_KEY);
  console.log(`poolId ${poolId}`);

  const fromArg = process.argv.indexOf('--from-block');
  const start =
    fromArg > -1 ? Number(process.argv[fromArg + 1]) : await creationBlock(provider, TOKEN);
  console.log(`scanning ${start.toLocaleString()} -> ${head.toLocaleString()} for PoolManager swaps`);

  const logs = [];
  for (let from = start; from <= head; from += CHUNK) {
    const to = Math.min(from + CHUNK - 1, head);
    const batch = await provider
      .getLogs({ address: POOL_MANAGER, topics: [SWAP_TOPIC, poolId], fromBlock: from, toBlock: to })
      .catch(() => []);
    logs.push(...batch);
  }
  console.log(`${logs.length} swaps in this pool`);
  if (!logs.length) {
    console.log('nothing to backfill');
    await prisma.$disconnect();
    return;
  }

  const tokenIsCurrency1 = POOL_KEY.currency1.toLowerCase() === TOKEN.toLowerCase();
  const blockTimes = new Map();
  const rows = [];

  for (const l of logs) {
    // data = amount0, amount1, sqrtPriceX96, liquidity, tick, fee
    const [a0, a1] = ethers.utils.defaultAbiCoder.decode(
      ['int128', 'int128', 'uint160', 'uint128', 'int24', 'uint24'],
      l.data
    );
    const ethDelta = tokenIsCurrency1 ? a0 : a1; // pool's ETH leg
    const tokDelta = tokenIsCurrency1 ? a1 : a0; // pool's token leg

    // pool RECEIVES eth (+) and PAYS token (-) => the trader bought
    const side = ethDelta.gt(0) ? 'buy' : 'sell';
    const ethAmount = Math.abs(Number(ethers.utils.formatEther(ethDelta)));
    const tokenAmount = Math.abs(Number(ethers.utils.formatEther(tokDelta)));
    if (!(ethAmount > 0) || !(tokenAmount > 0)) continue;

    if (!blockTimes.has(l.blockNumber)) {
      const b = await provider.getBlock(l.blockNumber);
      blockTimes.set(l.blockNumber, new Date(b.timestamp * 1000));
    }
    // the trader is the tx sender, NOT the Swap event's `sender` — that is the
    // router/hook that called the PoolManager, identical for every swap
    const tx = await provider.getTransaction(l.transactionHash);

    rows.push({
      tokenAddress: ethers.utils.getAddress(TOKEN),
      trader: ethers.utils.getAddress(tx?.from || l.topics[2].replace(/^0x0{24}/, '0x')),
      side,
      ethAmount,
      tokenAmount,
      // the chart's unit: ETH per 1,000,000 tokens
      priceEth: (ethAmount / tokenAmount) * 1_000_000,
      txHash: l.transactionHash,
      createdAt: blockTimes.get(l.blockNumber),
    });
  }

  /**
   * ONE ROW PER TRANSACTION, and it must be the USER'S leg.
   *
   * SocialTokenTrade.txHash is UNIQUE, but a v4 transaction contains SEVERAL
   * swaps: the trade itself plus whatever the Doppler hook does for fees or
   * rebalancing, all against the same pool in the same tx. A plain insert with
   * skipDuplicates therefore keeps whichever leg happened to be inserted first
   * — 183 swaps collapsed to 73 rows chosen by array order, which is luck.
   *
   * Losing the dust legs is right (they are not user decisions). Letting a
   * 0.0004 ETH fee leg REPLACE a 0.22 ETH buy is not: the tape would show a
   * tiny sell where someone actually bought 1.8 billion tokens. So collapse
   * deterministically on the largest ETH leg, which is always the real trade.
   */
  const byTx = new Map();
  for (const r of rows) {
    const prev = byTx.get(r.txHash);
    if (!prev || r.ethAmount > prev.ethAmount) byTx.set(r.txHash, r);
  }
  const collapsed = Array.from(byTx.values());
  console.log(
    `${rows.length} swaps -> ${collapsed.length} transactions ` +
      `(${rows.length - collapsed.length} hook/fee legs folded into their trade)`
  );
  rows.length = 0;
  rows.push(...collapsed);

  rows.sort((a, b) => a.createdAt - b.createdAt);
  const buys = rows.filter((r) => r.side === 'buy').length;
  console.log(`\n${rows.length} trades — ${buys} buys, ${rows.length - buys} sells`);
  for (const r of rows.slice(-10)) {
    console.log(
      `  ${r.createdAt.toISOString().slice(0, 16)}  ${r.side.padEnd(4)}  ` +
        `${r.ethAmount.toFixed(6)} ETH  ${Math.round(r.tokenAmount).toLocaleString()} SAGE  ${r.trader.slice(0, 10)}…`
    );
  }

  if (!COMMIT) {
    console.log('\nDRY RUN — pass --commit to write.');
    await prisma.$disconnect();
    return;
  }

  // txHash is UNIQUE; skipDuplicates makes a re-run a no-op
  const res = await prisma.socialTokenTrade.createMany({ data: rows, skipDuplicates: true });
  await prisma.socialTokenLaunch.update({
    where: { tokenAddress: ethers.utils.getAddress(TOKEN) },
    data: { poolSyncedBlock: head },
  });
  console.log(`\nwrote ${res.count} trades, cursor at block ${head.toLocaleString()}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e.message || e);
  await prisma.$disconnect();
  process.exit(1);
});
