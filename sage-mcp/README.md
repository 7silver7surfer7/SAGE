# sage-mcp

MCP (Model Context Protocol) server that lets AI agents — Claude, GPT-based
bots, or any MCP client — transact on the SAGE marketplace with their own
wallet, no human UI involved.

## What an agent can do

| Tool | What it does |
| --- | --- |
| `sage_market_info` | SAGE price (USD), liquidity, contract addresses, chains |
| `sage_balances` | Agent's ETH + SAGE on both chains, earned pixels |
| `sage_buy_sage` | Swap ETH → SAGE on Robinhood mainnet (Uniswap v2 pair). Held SAGE passively earns pixels (0.25/day per SAGE, capped at 100k SAGE) |
| `sage_list_drops` | Browse approved drops with purchasable games + prices |
| `sage_get_drop` | Full drop detail (NFT descriptions, timing) |
| `sage_mint_open_edition` | Mint open-edition NFTs — SAGE and/or pixel priced (auto-approves SAGE, auto-claims pixels) |
| `sage_buy_lottery_tickets` | Buy drawing tickets — SAGE and/or pixel priced (auto-approves SAGE, auto-claims pixels) |
| `sage_place_auction_bid` | Bid SAGE on an auction (auto-approves) |

The intended agent loop: buy SAGE → hold it to accrue pixels → spend
SAGE/pixels on mints, tickets, and bids.

## Driving many accounts (swarm)

`swarm.js` runs a set of wallets through a drop — each mints the given open
edition(s) and places a laddered bid on the auction. It launches the
single-account server once per key, so all transaction logic (pixel-claim
mints, SIWE sessions, bid recording) is reused verbatim.

```bash
SAGE_SWARM_KEYS=0xkey1,0xkey2,0xkey3 \
SAGE_SWARM_EDITIONS=18,19 \
SAGE_SWARM_AUCTION=5 \
SAGE_SITE_URL=https://sageart.xyz \
node swarm.js
```

Each wallet needs its own funds (testnet ETH for gas, SAGE, and — for
pixel-priced editions — pixels, which accrue from holding SAGE once the pixels
job has run). There is no way to derive a private key from an address, so every
account you want to drive must supply its `0x…` key (or a seed phrase to derive
them from).

## Setup

```bash
cd sage-mcp && npm install
```

Claude Code / Claude Desktop config:

```json
{
  "mcpServers": {
    "sage": {
      "command": "node",
      "args": ["/path/to/SAGE/sage-mcp/index.js"],
      "env": {
        "SAGE_AGENT_PRIVATE_KEY": "0x…",
        "SAGE_SITE_URL": "https://sageart.xyz"
      }
    }
  }
}
```

## Agent wallet

The agent transacts from its own wallet, set via `SAGE_AGENT_PRIVATE_KEY`. A
dedicated wallet was generated and its key stored in `sage-mcp/.env` (which is
gitignored — never commit it). The server auto-loads that `.env` on startup
regardless of the launch directory. Env vars set in the MCP client config take
precedence over the `.env` file.

Fund the agent address (printed in the startup banner) with:
- **ETH on Robinhood mainnet** (chainId 4663) → for `sage_buy_sage` swaps
- **testnet ETH on 46630** → for marketplace mints / tickets / bids

## Configuration (env vars)

| Var | Default | Purpose |
| --- | --- | --- |
| `SAGE_AGENT_PRIVATE_KEY` | — | Agent wallet. Required for transactions; read-only tools work without it |
| `SAGE_SITE_URL` |  `https://sageart.xyz` | SAGE web app (drops catalog + pixels API, via SIWE) |
| `SAGE_MARKETPLACE_RPC` / `_CHAIN_ID` | Robinhood testnet / 46630 | Chain with Auction/Lottery/OpenEdition contracts |
| `SAGE_TOKEN_ADDRESS` | testnet SAGE | Payment token on the marketplace chain |
| `SAGE_OPENEDITION_ADDRESS` `SAGE_LOTTERY_ADDRESS` `SAGE_AUCTION_ADDRESS` | testnet deployment | Marketplace contracts |
| `SAGE_MAINNET_RPC` / `_CHAIN_ID` | Robinhood mainnet / 4663 | Chain with the SAGE/WETH market |
| `SAGE_MAINNET_TOKEN` / `SAGE_WETH_ADDRESS` / `SAGE_PAIR_ADDRESS` | live deployment | Swap route for `sage_buy_sage` |

When the marketplace suite deploys to mainnet, point the `SAGE_MARKETPLACE_*`
vars at mainnet and everything moves over — no code changes.

## Security notes

- The agent signs transactions autonomously. **Fund its wallet only with what
  you're willing to let it spend.** Use a dedicated wallet, never a treasury
  or admin key.
- `sage_buy_sage` talks directly to the Uniswap v2 pair (no router is deployed
  on Robinhood Chain). Slippage tolerance is enforced on-chain via `minOut`;
  the SAGE token itself takes a 1% fee on AMM buys.
- The server signs a SIWE session against `SAGE_SITE_URL` to read the drops
  catalog and pixel balances — the same auth flow a human uses in the browser.

## Smoke test

With the site running locally and any funded/unfunded key:

```bash
SAGE_AGENT_PRIVATE_KEY=0x… node index.js
# then connect any MCP client over stdio
```
