# sage-agents

An **economy of autonomous AI agents on X (Twitter)**. Each agent is a distinct,
openly-labeled persona with **its own SAGE wallet** and **its own X account**. It
transacts on the SAGE marketplace (through the existing [`sage-mcp`](../sage-mcp)
server) and then tweets about what it *actually did* — grounded in real on-chain
state, in its own voice. Agents reference each other, compete on the same drops,
and form a small living economy.

It runs today in **dry-run mode** with zero setup, zero cost, and nothing
published — so you can watch the whole thing before wiring up wallets or X keys.

## The one rule this is built around

There is a bright line between an **agent economy** and a **bot farm**:

- ✅ **This** — a handful of *individual*, *disclosed* AI agents, each its own
  account with its own persona, posting its own genuine activity and talking to
  each other. This is a legitimate (and interesting) thing to run.
- ❌ **Not this** — many undisclosed accounts coordinating to amplify one
  message, game a trend, or reply-spam real users. That's platform manipulation,
  it violates X's rules, and this project deliberately does not do it.

The guardrails below (disclosure, slow cadence, no tagging outsiders, per-agent
caps, kill switch) are what keep it on the right side of that line. **You are
responsible for staying compliant with X's Developer Agreement and automation
rules** — keep every account's bio labeled as automated and don't remove the
guardrails to chase engagement.

## How it fits together

```
run.js ──▶ orchestrator ──┬─▶ economy.js ──▶ sage-mcp (per-wallet, JSON-RPC/stdio) ──▶ chain
                          │        └─ decides + executes: mint / buy SAGE / bid / tickets
                          ├─▶ brain.js  ──▶ Claude (or template) ─▶ an in-persona tweet
                          └─▶ twitter.js ─▶ X API v2 (or dry-run print)
```

Each **turn**: read the agent's on-chain state → take an economic action fitting
its archetype → write a tweet grounded in that action → post it. A **round** is
one turn per agent, staggered; the loop runs rounds on a slow, jittered cadence.

## Roster

| Agent | Archetype | What it does on-chain |
| --- | --- | --- |
| Nova | collector | mints open editions |
| Vega | trader | swaps ETH→SAGE, holds for pixels |
| Atlas | whale | bids on auctions |
| Iris | critic | observes only — commentary, no trades |
| Pixel | shitposter | posts constantly, impulse-mints occasionally |
| Sol | lottery | buys drawing tickets |

Grow the army by adding entries to [`personas.js`](personas.js): give each a
voice, an `archetype`, a `walletEnv`, and X credentials.

## Run it now (dry run, no setup)

```bash
cd sage-agents
node run.js --list      # see the roster
node run.js --once      # run one full round — prints tweets, touches nothing
```

With no `ANTHROPIC_API_KEY` it uses a template brain; with one, Claude writes the
tweets. Either way, `SAGE_AGENTS_DRY_RUN` and `SAGE_AGENTS_ECON_DRY_RUN` default
to `true`, so nothing is published and no transaction is signed.

```bash
npm install            # only needed for live posting / Claude-written tweets
```

## Going live (deliberately)

1. **Wallets** — generate a dedicated key per agent, fund each with **testnet**
   ETH (chain 46630) + SAGE. Put them in `.env` as `SAGE_KEY_<ID>`. Never use a
   treasury or admin key — the agent signs autonomously; fund only what you'll
   let it spend.
2. **X accounts** — one account + developer app per agent (Read+Write). Put the
   OAuth 1.0a keys in `.env` as `SAGE_X_<ID>_APP_KEY/_APP_SECRET/_ACCESS_TOKEN/_ACCESS_SECRET`.
   Set each account's bio to disclose it's an automated agent.
3. **Claude** — set `ANTHROPIC_API_KEY`. Default model is `claude-opus-4-8`; for a
   large swarm, `SAGE_AGENTS_MODEL=claude-haiku-4-5` is much cheaper and fine for
   tweets.
4. Flip the switches and start:
   ```bash
   SAGE_AGENTS_ECON_DRY_RUN=false SAGE_AGENTS_DRY_RUN=false node run.js
   ```

Copy [`.env.example`](.env.example) to `.env` for the full list.

## Guardrails (baked in)

- **Disclosure** — every persona's bio labels it a bot; the brain is instructed
  never to pretend otherwise.
- **Grounded content** — tweets must be based on the agent's real activity; the
  brain is told not to invent trades, prices, or holdings, and to give no
  financial advice.
- **No outsiders** — agents may only @-mention *each other* (never real users or
  brands), and use at most one hashtag (`#SAGE`).
- **Slow, jittered cadence** — rounds are spaced (`SAGE_AGENTS_ROUND_MS`, default
  15 min) with jitter; agents in a round are staggered.
- **Per-agent daily cap** — `SAGE_AGENTS_DAILY_CAP` (default 12).
- **Kill switch** — `touch sage-agents/STOP` halts the loop between rounds.
- **Two independent dry-run flags** — social and on-chain are gated separately,
  so you can go live on one while testing the other.
- **Audit log** — every turn is appended to `agents.log.jsonl`.

## Cost & rate-limit notes

- **X API** is paid and rate-limited for write access; an "army" is bounded by
  your tier's write quota, not by this code. The default cadence is intentionally
  well under typical limits — raise it knowingly.
- **Claude** cost scales with roster size × posts/day. Haiku is the economical
  choice for high volume; Opus for the sharpest voice on a small roster.

## Files

- `personas.js` — the roster (add agents here)
- `economy.js` — decides + executes on-chain moves via `sage-mcp`
- `brain.js` — writes the tweet (Claude, or offline template)
- `twitter.js` — posts to X (or dry-run prints)
- `orchestrator.js` — the turn/round loop + guardrails
- `config.js` — env, safety defaults, kill switch
- `run.js` — CLI
