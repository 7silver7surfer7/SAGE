# syntax=docker/dockerfile:1
# SAGE settlement cron — Cloud Run Job image.
#
# Runs scripts/update_games.js on a schedule: requests lottery randomness,
# fulfills it via SageRNG (operator), computes winners + merkle proofs,
# records auction winners, and pays lottery refunds. All secrets (DEPLOYER_PK,
# DATABASE_CONNECTION_POOL_URL, ARWEAVE_JSON_JWK) come from Cloud Run env vars
# at runtime — no .env ships in the image (see .dockerignore).
# bullseye (not bookworm/slim-20): this repo pins Prisma 4.4, whose query
# engines link against OpenSSL 1.1 — present in Debian 11, gone in Debian 12.
FROM node:18-bullseye-slim

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates git && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY . .

# --legacy-peer-deps: same lockfile-era mismatch as the UI repo — modern npm's
# peer auto-install rejects the lock as out of sync
RUN npm ci --legacy-peer-deps

# generate the prisma client and compile contracts at build time so the job
# starts instantly; the runtime `hre.run("compile")` becomes a cached no-op
RUN npx prisma generate && npx hardhat compile

ENV HARDHAT_NETWORK=robinhoodTestnet
CMD ["node", "scripts/update_games.js"]
