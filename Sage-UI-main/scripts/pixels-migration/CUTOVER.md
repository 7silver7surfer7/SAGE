# Pixels DB-ledger cutover run-list

Phase 0 (done): shadow tables live, snapshot + compare tooling proven,
`PIXELS_SOURCE` seam deployed inert (default `chain`), `SyncPixelBank`
endpoint live as a chain-mode no-op.

Execute IN ORDER — the whole point of the ordering is that the chain state
must stop moving before the final copy of it is taken (the hourly reconcile
corrected 6 wallets mid-snapshot during prep and proved this the hard way):

1. **Freeze the chain keepers.** Disable BOTH workflows (UI: Actions →
   disable, or `gh workflow disable points-keeper.yml`). Verify no run is
   in progress before proceeding.
2. **Final snapshot.** `node scripts/pixels-migration/snapshot.mjs` with
   prod `DATABASE_CONNECTION_POOL_URL`.
3. **Gate.** `node scripts/pixels-migration/compare.mjs` must print
   "cutover gate PASSES" (exit 0). If wallets mismatch, they traded during
   step 2 — re-run 2 then 3 until clean (converges in one pass when the
   keepers are frozen; only same-minute traders can drift).
4. **Flip the flag.**
   `gcloud run services update sage-testnet --region us-west1 --update-env-vars PIXELS_SOURCE=db`
   (creates a new revision; reads AND writes switch to the DB atomically
   per-instance).
5. **Repoint the cron.** Replace `.github/workflows/points-keeper.yml` with
   `points-keeper.cutover.yml` from this directory (curl poke, no node, no
   keys), re-enable the workflow, dispatch once, confirm the run logs show
   `{"mode":"db", ...}`.
6. **Verify end-to-end.** Leaderboard + a profile balance render; one pixels
   collect goes through (journal rows appear); `SyncPixelBank` banks a
   drifted wallet after a live trade.
7. **Decommission.** The oracle wallet stops needing gas for points (mints
   still draw from it until the voucher flow ships). Leave the SagePoints
   contract frozen as the historical record — do NOT setEconomics/seed it
   again; the DB is authoritative from step 4 forward.

Rollback (any time before step 7 feels final): unset the env var
(`--remove-env-vars PIXELS_SOURCE`), restore the old workflow file, and run
one keeper dispatch — the contract state was never touched, so chain mode
resumes exactly where it left off, minus any pixels spent in DB mode (replay
those from PixelJournal `spend|credit` rows via seedSettled if it matters).
