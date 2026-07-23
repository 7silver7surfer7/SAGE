# On-chain security fixes — run book (2026-07-22 audit)

The **backend** fixes (H2/M3/M4 + pass-2) are already committed and **live on both
testnet.sageart.xyz and mainnet sageart.xyz**. This file covers the three items
that require **on-chain / privileged transactions**, which are yours to execute.

Everything below is scripted so nothing is fumbled. All privileged steps route
through the **multisig `0x3E099aF007CaB8233D44782D8E6fe80FECDC321e`** — the
deploy/impl steps are unprivileged (any funded key), and each script prints the
exact `{ to, data }` calldata for the Safe to execute.

Robinhood Chain rejects EIP-1559, so every script pins a legacy `gasPrice`
(`baseFee × 1.5`, `type: 0`). Networks: `robinhoodTestnet` (46630) / `robinhood`
(4663) — see `hardhat.config.js`.

---

## 1. H1 — SageStorage admin (role change, NOT a redeploy)

**Correction to the earlier plan:** H1 does **not** need a SageStorage redeploy.
SageStorage is the central role registry every contract points at; redeploying it
would mean re-wiring and re-granting everything. The real fix is a **role change**,
and the source-level constructor change only prevents the bug from returning on a
*fresh* deploy.

- **Mainnet: already done.** Verified on-chain: `DEFAULT_ADMIN_ROLE` → oracle
  `false`, multisig `true`. The hot key cannot self-grant roles or evict the
  multisig. Nothing to do.
- **Testnet: still exposed** — oracle holds all roles, multisig holds none. Fix
  with the guarded script (grants multisig root admin **first**, then revokes the
  oracle's — never leaves zero admins; refuses to run on any chain but 46630):

```bash
cd Sage-Solidity-main
# run with the ORACLE key (0x8994…, the only current testnet DEFAULT_ADMIN holder)
npx hardhat run scripts/fix_testnet_admin_roles.js --network robinhoodTestnet
```

After: testnet matches mainnet — multisig is sole `DEFAULT_ADMIN`; oracle keeps
`ADMIN_ROLE` + `MINTER_ROLE` so server-side mints still work.

---

## 2. M1 — Auction 100%-share fix (UUPS upgrade, clean & in-place)

`Auction` is UUPS-upgradeable, so this lands **in place** (same proxy address, no
state loss). `_authorizeUpgrade` is `onlyMultisig`.

```bash
cd Sage-Solidity-main
# deploys the new impl (unprivileged) + prints upgradeTo() calldata for the Safe
npx hardhat run scripts/prepare_auction_share_fix_upgrade.js --network robinhoodTestnet
npx hardhat run scripts/prepare_auction_share_fix_upgrade.js --network robinhood
```

Then the **multisig** executes the printed `multisigCall` (`upgradeTo(newImpl)`) —
paste `{to,data}` into the Safe, or reuse the
`deploy/upgrade-auction-lottery-audit-fix.html` multisig-page pattern.

**Verify:** `setAuctionArtistShare(id, x)` called by the NFT artist now reverts
`"Admin only"`; only a `role.admin` holder can set the share.

> If `prepareUpgrade` errors with an EIP-1559 / `maxFeePerGas` message on
> Robinhood, the OZ upgrades plugin picked 1559 fees. Same fix the deploy scripts
> use: pin a legacy `gasPrice` on the deploy override, or deploy the impl with a
> plain `Auction` factory `.deploy()` (legacy gasPrice) and hand its address to a
> manual `upgradeTo`.

---

## 3. M2 — SageCollection 100%-share fix (fresh deploy)

`SageCollection` is **not** upgradeable, so this is a fresh contract. Established
pattern (`redeploy_collection_new_token.js`, 2026-07-15): existing collections
stay on the old address and keep resolving (each is recorded per-row as
`CollectionMint.contractAddress`); only **new** collections use the new contract.

```bash
cd Sage-Solidity-main
# deploys the fixed contract + prints the multisig grantRole(MINTER) calldata
npx hardhat run scripts/redeploy_collection_share_fix.js --network robinhoodTestnet
npx hardhat run scripts/redeploy_collection_share_fix.js --network robinhood
```

Then, **in order**:
1. **Multisig** executes the printed `step_a_multisig_grantMinter` calldata
   (grants `MINTER_ROLE` to the new contract — the oracle can't, post-H1).
2. Update `COLLECTION_ADDRESS` for that chain in
   `Sage-UI-main/src/constants/config.ts`, then redeploy the UI
   (`deploy-staging.sh` → `deploy-prod.sh`).

Until both are done, new-collection mints on the new contract revert. Weigh it:
M2 is a MEDIUM and collections are infrequent — deferring until the next
collection drop is reasonable; the source is ready whenever you want it live.

---

## Suggested order

1. **Testnet H1** (§1) — quick, closes a live testnet hole.
2. **M1 Auction upgrade** (§2) on testnet → verify → mainnet. Clean UUPS, low risk.
3. **M2 SageCollection** (§3) — optional / next collection drop.

Still separate (not in this run book): the remaining **lows** and the
**SagePoints governance** items (move SagePoints ownership to the multisig, add a
`seedSettled` run-once guard) — see the audit report.
