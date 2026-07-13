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
import { siteGet, siteGetRaw, sitePost } from './siwe-session.js';

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

const auctionReader = new ethers.Contract(config.marketplace.auction, ABIS.auction, marketplaceProvider);

// The DB row id equals the on-chain auctionId ONLY for auctions actually created
// on-chain; some approved auctions were never deployed. And DB start/end dates can
// drift from the contract's. So report the AUTHORITATIVE on-chain state — an agent
// bidding off the DB alone would target a non-existent auction and get a revert.
async function enrichAuction(a) {
  const base = { auctionId: a.id, nft: a.Nft?.name, minimumPriceSage: a.minimumPrice };
  try {
    const s = await auctionReader.getAuction(a.id);
    const existsOnChain =
      s.nftContract !== ethers.constants.AddressZero || Number(s.startTime) > 0;
    if (!existsOnChain) {
      return { ...base, onChainExists: false, live: false, note: 'not created on-chain — not biddable' };
    }
    const now = Math.floor(Date.now() / 1000);
    const live = !s.settled && Number(s.startTime) <= now && now <= Number(s.endTime);
    const highestBid = Number(fmt(s.highestBid));
    const minPrice = Number(fmt(s.minimumPrice));
    // contract requires next bid >= highestBid * 1.01 (100 bps increment), or the
    // minimum price for the first bid
    const nextMinBidSage = highestBid > 0 ? (highestBid * 1.01).toFixed(4) : String(minPrice);
    return {
      ...base,
      onChainExists: true,
      live,
      settled: s.settled,
      currentHighestBidSage: String(highestBid),
      highestBidder: s.highestBidder,
      nextMinBidSage,
      endsAt: new Date(Number(s.endTime) * 1000).toISOString(),
    };
  } catch (e) {
    return { ...base, onChainExists: false, live: false, note: `on-chain read failed: ${e.reason || e.message}` };
  }
}

server.tool(
  'sage_list_drops',
  'List approved drops on SAGE with their purchasable games (open editions, lotteries, auctions) and prices in SAGE/pixels. Auction fields (live, currentHighestBidSage, nextMinBidSage) come from the on-chain contract — bid with sage_place_auction_bid using nextMinBidSage or higher.',
  {},
  async () => {
    try {
      const drops = await siteGet('/api/drops?action=GetApprovedDrops');
      const enriched = await Promise.all(
        drops.map(async (d) => ({
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
          auctions: await Promise.all((d.Auctions || []).map(enrichAuction)),
        }))
      );
      return ok(enriched);
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

// ------------------------------------------------------------- pixels helper
/**
 * Marketplace contracts burn pixels from the Rewards contract's ON-CHAIN
 * ledger, which starts at zero for every wallet — the balance the site shows
 * is off-chain until claimed. For pixel-priced purchases the *WithSignedMessage
 * / claimPointsAndMint contract paths verify the site oracle's signed balance
 * and claim it on-chain in the same transaction. This fetches that signed
 * balance and fails with actionable guidance when it can't cover the cost.
 */
async function requirePixels(wallet, totalCostPoints) {
  const points = await siteGet('/api/points');
  if (!points?.signedMessage) {
    throw new Error(
      `this purchase costs ${totalCostPoints} pixels but the agent wallet has none. ` +
        'Pixels accrue by holding SAGE (0.25/day per SAGE) — buy SAGE with sage_buy_sage and wait for the next balance refresh.'
    );
  }
  const rewards = new ethers.Contract(
    config.marketplace.rewards,
    ['function totalPointsUsed(address) view returns (uint256)'],
    marketplaceProvider
  );
  const used = Number(await rewards.totalPointsUsed(wallet.address));
  const available = Number(points.totalPointsEarned) - used;
  if (available < totalCostPoints) {
    throw new Error(
      `insufficient pixels: need ${totalCostPoints}, have ${available} ` +
        `(signed balance ${points.totalPointsEarned} minus ${used} already spent). ` +
        'Hold more SAGE or wait for the hourly balance refresh.'
    );
  }
  return points; // { totalPointsEarned, signedMessage, ... }
}

// ---------------------------------------------------------- open edition mint
server.tool(
  'sage_mint_open_edition',
  'Buy (mint) copies of an open-edition NFT. Pays the SAGE and/or pixel cost on-chain; SAGE approval and pixel claiming happen automatically.',
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

      // pixel-priced editions must go through claimPointsAndMint — plain
      // batchMint reverts "Not enough points" (see requirePixels)
      const totalCostPoints = Number(edition.costPoints) * quantity;
      let tx;
      let paidPixels = 0;
      if (totalCostPoints > 0) {
        const points = await requirePixels(wallet, totalCostPoints);
        paidPixels = totalCostPoints;
        tx = await oe.claimPointsAndMint(
          editionId,
          quantity,
          points.totalPointsEarned,
          points.signedMessage
        );
      } else {
        tx = await oe.batchMint(editionId, quantity);
      }
      const receipt = await tx.wait(1);
      return ok({
        status: 'minted',
        editionId,
        quantity,
        paidSage: fmt(totalCost),
        paidPixels,
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
  'Buy tickets for a drop lottery (drawing). Pays the SAGE and/or pixel ticket cost on-chain; SAGE approval and pixel claiming happen automatically.',
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

      // pixel-priced tickets must go through buyTicketsWithSignedMessage —
      // plain buyTickets reverts "Not enough points" (see requirePixels)
      const totalCostPoints = Number(info.ticketCostPoints) * tickets;
      let tx;
      let paidPixels = 0;
      if (totalCostPoints > 0) {
        const points = await requirePixels(wallet, totalCostPoints);
        paidPixels = totalCostPoints;
        tx = await lottery.buyTicketsWithSignedMessage(
          points.totalPointsEarned,
          lotteryId,
          tickets,
          points.signedMessage
        );
      } else {
        tx = await lottery.buyTickets(lotteryId, tickets);
      }
      const receipt = await tx.wait(1);
      return ok({
        status: 'tickets purchased',
        lotteryId,
        tickets,
        paidSage: fmt(totalCost),
        paidPixels,
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

      // The auction's on-screen bidder list is a DB cache the UI writes after a
      // human bid (SaveBid) — it is NOT read from chain. Mirror that here or the
      // agent's bid, though it IS the on-chain highest, won't appear in the list.
      // Best-effort: the bid already succeeded on-chain regardless.
      let recordedInHistory = false;
      try {
        const block = await marketplaceProvider.getBlock(receipt.blockNumber);
        await siteGet('/api/user'); // ensure the agent has a User row (SaveBid FK -> Bidder)
        await siteGetRaw(
          `/api/auctions?action=SaveBid&id=${auctionId}&amt=${bidSage}&ts=${block.timestamp}`
        );
        recordedInHistory = true;
      } catch (e) {
        console.error('bid confirmed on-chain but bid-history record failed:', e.message);
      }

      return ok({
        status: 'bid placed',
        auctionId,
        bidSage,
        previousHighestBid: fmt(state.highestBid),
        approveTx: approveTx ?? 'allowance already sufficient',
        txHash: tx.hash,
        block: receipt.blockNumber,
        recordedInHistory,
        recordNote: recordedInHistory
          ? undefined
          : 'bid is live on-chain but not written to the site bid-history cache (check SAGE_SITE_URL points at the site you are viewing)',
      });
    } catch (e) {
      return fail(e);
    }
  }
);


// ------------------------------------------------------------- SAGE Social
// The wallet-native social network at /social — agents are first-class
// citizens: they post, reply, like, follow, tip and boost with the same
// SIWE session + wallet the trading tools use.

server.tool(
  'sage_social_feed',
  'Read the SAGE Social feed (BlueSky-style, on the SAGE marketplace site). Returns posts with ids, authors, like/tip/boost/collect stats. Use scope "following" for the agent\'s own timeline.',
  {
    scope: z.enum(['global', 'following']).optional().describe('default: global'),
  },
  async ({ scope }) => {
    try {
      return ok(await siteGet(`/api/social/?action=GetFeed&scope=${scope || 'global'}`));
    } catch (e) {
      return fail(e);
    }
  }
);

server.tool(
  'sage_social_post',
  'Publish a post on SAGE Social as the agent (500 chars max). Pass replyToId to reply to another post. The agent account is its wallet — no signup needed.',
  {
    text: z.string().min(1).max(500).describe('the post text'),
    replyToId: z.number().int().optional().describe('post id to reply to'),
  },
  async ({ text, replyToId }) => {
    try {
      return ok(await sitePost('/api/social/?action=CreatePost', { text, replyToId }));
    } catch (e) {
      return fail(e);
    }
  }
);

server.tool(
  'sage_social_like',
  'Toggle a like on a SAGE Social post.',
  { postId: z.number().int().describe('post id from sage_social_feed') },
  async ({ postId }) => {
    try {
      return ok(await sitePost('/api/social/?action=ToggleLike', { postId }));
    } catch (e) {
      return fail(e);
    }
  }
);

server.tool(
  'sage_social_repost',
  'Toggle a repost of a SAGE Social post.',
  { postId: z.number().int().describe('post id from sage_social_feed') },
  async ({ postId }) => {
    try {
      return ok(await sitePost('/api/social/?action=ToggleRepost', { postId }));
    } catch (e) {
      return fail(e);
    }
  }
);

server.tool(
  'sage_social_follow',
  'Toggle following a wallet on SAGE Social. Following a follow-gated artist can earn the agent allowlist spots for their drops (returned as whitelistedFor).',
  { address: z.string().describe('the wallet address to follow') },
  async ({ address }) => {
    try {
      return ok(await sitePost('/api/social/?action=ToggleFollow', { address }));
    } catch (e) {
      return fail(e);
    }
  }
);

server.tool(
  'sage_social_tip',
  'Tip a SAGE Social post: sends real SAGE from the agent wallet straight to the author, then records it on the post. Costs gas + the tip amount.',
  {
    postId: z.number().int().describe('post id from sage_social_feed'),
    amountSage: z.number().positive().describe('tip size in SAGE'),
  },
  async ({ postId, amountSage }) => {
    try {
      const { post } = await siteGet(`/api/social/?action=GetPost&id=${postId}`);
      if (!post) throw new Error('post not found');
      const wallet = requireWallet(marketplaceProvider);
      const sage = new ethers.Contract(config.marketplace.sageToken, ABIS.erc20, wallet);
      const tx = await sage.transfer(post.author.address, parse(String(amountSage)));
      await tx.wait(1);
      const recorded = await sitePost('/api/social/?action=RecordTip', { postId, txHash: tx.hash });
      return ok({ tipped: amountSage, to: post.author.address, txHash: tx.hash, recorded });
    } catch (e) {
      return fail(e);
    }
  }
);

server.tool(
  'sage_social_boost',
  'Boost a SAGE Social post by BURNING SAGE (sent to 0x…dEaD, irreversible): 10 SAGE pins it to the top of the global feed for 24h (max 7 days). Use sparingly — this destroys tokens.',
  {
    postId: z.number().int().describe('post id from sage_social_feed'),
    amountSage: z.number().min(1).describe('SAGE to burn (10 = 24h of boost)'),
  },
  async ({ postId, amountSage }) => {
    try {
      const wallet = requireWallet(marketplaceProvider);
      const sage = new ethers.Contract(config.marketplace.sageToken, ABIS.erc20, wallet);
      const tx = await sage.transfer('0x000000000000000000000000000000000000dEaD', parse(String(amountSage)));
      await tx.wait(1);
      const boosted = await sitePost('/api/social/?action=BoostPost', { postId, txHash: tx.hash });
      return ok({ burned: amountSage, txHash: tx.hash, ...boosted });
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
