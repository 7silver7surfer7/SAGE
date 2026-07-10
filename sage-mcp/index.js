#!/usr/bin/env node
// SAGE marketplace MCP server — lets an AI agent browse drops, buy SAGE
// (which passively earns pixels), and transact on the marketplace
// (open-edition mints, lottery tickets, auction bids) with its own wallet.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ethers } from 'ethers';
import { config } from './config.js';
import {
  ABIS,
  marketplaceProvider,
  dexProvider,
  requireWallet,
  agentAddress,
  ensureSageAllowance,
  fmt,
  parse,
} from './chain.js';
import { siteGet } from './siwe-session.js';

const server = new McpServer({ name: 'sage-marketplace', version: '0.1.0' });

const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const fail = (e) => ({
  isError: true,
  content: [{ type: 'text', text: `Error: ${e?.reason || e?.message || String(e)}` }],
});

// ---------------------------------------------------------------- market info
server.tool(
  'sage_market_info',
  'Current SAGE token market info: USD price, liquidity, token/contract addresses and chains. Call this first to orient yourself.',
  {},
  async () => {
    try {
      const res = await fetch(`${config.dexscreenerUrl}/${config.dex.sageToken}`);
      const { pairs } = await res.json();
      const p = pairs?.[0];
      return ok({
        agentWallet: agentAddress() ?? 'not configured (set SAGE_AGENT_PRIVATE_KEY)',
        price: p
          ? { usd: p.priceUsd, native: p.priceNative, liquidityUsd: p.liquidity?.usd, dex: p.dexId }
          : 'no market data',
        sageMainnet: { chainId: config.dex.chainId, token: config.dex.sageToken, pair: config.dex.pair },
        marketplace: {
          chainId: config.marketplace.chainId,
          sageToken: config.marketplace.sageToken,
          openEdition: config.marketplace.openEdition,
          lottery: config.marketplace.lottery,
          auction: config.marketplace.auction,
        },
        pixels:
          'Holding SAGE earns 0.25 pixels/day per SAGE (capped at 100,000 SAGE = 25,000/day, per chain). Pixels are spendable on lottery tickets and open-edition mints.',
      });
    } catch (e) {
      return fail(e);
    }
  }
);

// ------------------------------------------------------------------- balances
server.tool(
  'sage_balances',
  "The agent wallet's ETH + SAGE balances on both chains, and its earned pixel balance.",
  {},
  async () => {
    try {
      const address = agentAddress();
      if (!address) throw new Error('SAGE_AGENT_PRIVATE_KEY not set');
      const sageMkt = new ethers.Contract(config.marketplace.sageToken, ABIS.erc20, marketplaceProvider);
      const sageDex = new ethers.Contract(config.dex.sageToken, ABIS.erc20, dexProvider);
      const [ethMkt, sageMktBal, ethDex, sageDexBal] = await Promise.all([
        marketplaceProvider.getBalance(address),
        sageMkt.balanceOf(address),
        dexProvider.getBalance(address),
        sageDex.balanceOf(address),
      ]);
      let pixels = 'unavailable (site API unreachable)';
      try {
        const points = await siteGet('/api/points');
        pixels = points?.totalPointsEarned ?? '0';
      } catch {}
      return ok({
        address,
        marketplaceChain: { chainId: config.marketplace.chainId, eth: fmt(ethMkt), sage: fmt(sageMktBal) },
        mainnet: { chainId: config.dex.chainId, eth: fmt(ethDex), sage: fmt(sageDexBal) },
        pixels,
      });
    } catch (e) {
      return fail(e);
    }
  }
);

// ------------------------------------------------------------------- buy SAGE
server.tool(
  'sage_buy_sage',
  'Swap ETH for SAGE on Robinhood mainnet via the Uniswap v2 SAGE/WETH pair. Holding the SAGE earns pixels daily. Note: the SAGE token takes a 1% fee on AMM buys.',
  {
    ethAmount: z.string().describe("ETH to spend, e.g. '0.01'"),
    slippagePercent: z.number().min(0).max(50).default(2).describe('max slippage tolerance in % (default 2)'),
  },
  async ({ ethAmount, slippagePercent }) => {
    try {
      const wallet = requireWallet(dexProvider);
      const amountIn = parse(ethAmount);

      const pair = new ethers.Contract(config.dex.pair, ABIS.pair, wallet);
      const weth = new ethers.Contract(config.dex.weth, ABIS.weth, wallet);
      const sage = new ethers.Contract(config.dex.sageToken, ABIS.erc20, wallet);

      const [token0, reserves, sageBefore] = await Promise.all([
        pair.token0(),
        pair.getReserves(),
        sage.balanceOf(wallet.address),
      ]);
      const wethIsToken0 = token0.toLowerCase() === config.dex.weth.toLowerCase();
      const reserveIn = wethIsToken0 ? reserves.reserve0 : reserves.reserve1;
      const reserveOut = wethIsToken0 ? reserves.reserve1 : reserves.reserve0;

      // x*y=k quote with the 0.3% LP fee on the input side
      const amountInWithFee = amountIn.mul(997);
      const quoted = amountInWithFee.mul(reserveOut).div(reserveIn.mul(1000).add(amountInWithFee));
      const minOut = quoted.mul(Math.floor((100 - slippagePercent) * 100)).div(10000);

      // wrap -> fund the pair -> swap (no router deployed on this chain)
      const dep = await weth.deposit({ value: amountIn });
      await dep.wait(1);
      const tr = await weth.transfer(config.dex.pair, amountIn);
      await tr.wait(1);
      const swap = await pair.swap(
        wethIsToken0 ? 0 : minOut,
        wethIsToken0 ? minOut : 0,
        wallet.address,
        '0x'
      );
      await swap.wait(1);

      const received = (await sage.balanceOf(wallet.address)).sub(sageBefore);
      return ok({
        status: 'swapped',
        spentEth: ethAmount,
        sageReceived: fmt(received),
        note: 'received amount reflects the token’s 1% AMM fee',
        txHash: swap.hash,
      });
    } catch (e) {
      return fail(e);
    }
  }
);

// ----------------------------------------------------------------- list drops
const liveWindow = (g) => {
  const now = Date.now();
  return new Date(g.startTime).getTime() <= now && now <= new Date(g.endTime ?? 8640000000000000).getTime();
};

server.tool(
  'sage_list_drops',
  'List approved drops on SAGE with their purchasable games (open editions, lotteries, auctions) and prices in SAGE/pixels.',
  {},
  async () => {
    try {
      const drops = await siteGet('/api/drops?action=GetApprovedDrops');
      return ok(
        drops.map((d) => ({
          dropId: d.id,
          name: d.name,
          artist: d.artistDisplayName || d.NftContract?.Artist?.username || d.artistAddress,
          openEditions: (d.OpenEditions || []).map((oe) => ({
            editionId: oe.editionId,
            nft: oe.Nft?.name,
            costSage: oe.costTokens,
            costPixels: oe.costPoints,
            maxPerUser: oe.maxPerUser,
            live: liveWindow(oe),
            onChainReady: oe.editionId != null,
          })),
          lotteries: (d.Lotteries || []).map((l) => ({
            lotteryId: l.id,
            prizes: (l.Nfts || []).map((n) => n.name),
            ticketCostSage: l.costPerTicketTokens,
            ticketCostPixels: l.costPerTicketPoints,
            maxTicketsPerUser: l.maxTicketsPerUser,
            live: liveWindow(l),
          })),
          auctions: (d.Auctions || []).map((a) => ({
            auctionId: a.id,
            nft: a.Nft?.name,
            minimumPriceSage: a.minimumPrice,
            settled: a.settled,
            live: liveWindow(a),
          })),
        }))
      );
    } catch (e) {
      return fail(e);
    }
  }
);

server.tool(
  'sage_get_drop',
  'Full detail for one drop by id, including NFT descriptions and exact game timing.',
  { dropId: z.number().int().describe('drop id from sage_list_drops') },
  async ({ dropId }) => {
    try {
      return ok(await siteGet(`/api/drops?action=GetFullDrop&id=${dropId}`));
    } catch (e) {
      return fail(e);
    }
  }
);

// ---------------------------------------------------------- open edition mint
server.tool(
  'sage_mint_open_edition',
  'Buy (mint) copies of an open-edition NFT. Pays the SAGE cost on-chain; approve happens automatically.',
  {
    editionId: z.number().int().describe('on-chain editionId from sage_list_drops'),
    quantity: z.number().int().min(1).max(300).default(1),
  },
  async ({ editionId, quantity }) => {
    try {
      const wallet = requireWallet(marketplaceProvider);
      const oe = new ethers.Contract(config.marketplace.openEdition, ABIS.openEdition, wallet);
      const edition = await oe.getOpenEdition(editionId);
      if (Number(edition.id) === 0 && !edition.nftUri) throw new Error(`edition ${editionId} not found on-chain`);

      const now = Math.floor(Date.now() / 1000);
      if (now < edition.startTime) throw new Error(`mint opens at ${new Date(edition.startTime * 1000).toISOString()}`);
      if (now > edition.closeTime) throw new Error('this edition has closed');

      const totalCost = edition.costTokens.mul(quantity);
      const approveTx = await ensureSageAllowance(wallet, config.marketplace.openEdition, totalCost);
      const tx = await oe.batchMint(editionId, quantity);
      const receipt = await tx.wait(1);
      return ok({
        status: 'minted',
        editionId,
        quantity,
        paidSage: fmt(totalCost),
        approveTx: approveTx ?? 'allowance already sufficient',
        txHash: tx.hash,
        block: receipt.blockNumber,
      });
    } catch (e) {
      return fail(e);
    }
  }
);

// ------------------------------------------------------------ lottery tickets
server.tool(
  'sage_buy_lottery_tickets',
  'Buy tickets for a drop lottery (drawing). Pays the SAGE ticket cost on-chain; approve happens automatically.',
  {
    lotteryId: z.number().int().describe('lotteryId from sage_list_drops'),
    tickets: z.number().int().min(1).default(1),
  },
  async ({ lotteryId, tickets }) => {
    try {
      const wallet = requireWallet(marketplaceProvider);
      const lottery = new ethers.Contract(config.marketplace.lottery, ABIS.lottery, wallet);
      const info = await lottery.getLotteryInfo(lotteryId);
      const totalCost = info.ticketCostTokens.mul(tickets);
      const approveTx = await ensureSageAllowance(wallet, config.marketplace.lottery, totalCost);
      const tx = await lottery.buyTickets(lotteryId, tickets);
      const receipt = await tx.wait(1);
      return ok({
        status: 'tickets purchased',
        lotteryId,
        tickets,
        paidSage: fmt(totalCost),
        approveTx: approveTx ?? 'allowance already sufficient',
        txHash: tx.hash,
        block: receipt.blockNumber,
      });
    } catch (e) {
      return fail(e);
    }
  }
);

// ---------------------------------------------------------------- auction bid
server.tool(
  'sage_place_auction_bid',
  'Place a SAGE bid on an auction. Must be >= the minimum price / higher than the current highest bid. Approve happens automatically.',
  {
    auctionId: z.number().int().describe('auctionId from sage_list_drops'),
    bidSage: z.string().describe("bid amount in SAGE, e.g. '1500'"),
  },
  async ({ auctionId, bidSage }) => {
    try {
      const wallet = requireWallet(marketplaceProvider);
      const auction = new ethers.Contract(config.marketplace.auction, ABIS.auction, wallet);
      const state = await auction.getAuction(auctionId);
      if (state.settled) throw new Error('auction already settled');
      const amount = parse(bidSage);
      if (amount.lte(state.highestBid)) {
        throw new Error(`bid must exceed current highest bid of ${fmt(state.highestBid)} SAGE`);
      }
      const approveTx = await ensureSageAllowance(wallet, config.marketplace.auction, amount);
      const tx = await auction.bid(auctionId, amount);
      const receipt = await tx.wait(1);
      return ok({
        status: 'bid placed',
        auctionId,
        bidSage,
        previousHighestBid: fmt(state.highestBid),
        approveTx: approveTx ?? 'allowance already sufficient',
        txHash: tx.hash,
        block: receipt.blockNumber,
      });
    } catch (e) {
      return fail(e);
    }
  }
);

// -------------------------------------------------------------------- startup
const transport = new StdioServerTransport();
await server.connect(transport);
console.error(
  `sage-mcp ready — agent wallet: ${agentAddress() ?? 'NOT SET'} | site: ${config.siteUrl} | marketplace chain: ${config.marketplace.chainId}`
);
