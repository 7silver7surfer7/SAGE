# syntax=docker/dockerfile:1
# SAGE marketplace — Cloud Run image.
#
# Next.js 12 pages here use ISR (getStaticProps + revalidate), so `next build`
# needs database access to prerender: the DB URL is passed as a BuildKit
# secret (--secret id=buildenv), which is mounted only for that RUN step and
# never written into an image layer. Runtime config comes from Cloud Run env
# vars — no .env file ships in the image (see .dockerignore).
#
# node:20 slim/Debian (not alpine): Prisma 4 needs OpenSSL and sharp ships
# prebuilt glibc binaries — both just work here.
FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Full copy before install: the postinstall hook (prisma generate + typechain)
# reads the schema and ABI files from src/, so package.json alone isn't enough.
COPY . .

# --legacy-peer-deps: the lockfile's @react-spring/{konva,native,three}
# entries declare their renderer peers (konva, react-native, three…) as
# required, so modern npm's peer auto-install rejects the lock as
# out-of-sync. Legacy mode skips peer resolution — matching how this
# lockfile was generated. (Same flag is needed for any local npm ci.)
RUN npm ci --legacy-peer-deps

# NEXT_PUBLIC_* are inlined into the client bundle at build time.
# staging = Robinhood testnet contracts.
ARG NEXT_PUBLIC_APP_MODE=staging
ARG NEXT_PUBLIC_MAINTENANCE_ON=false
ENV NEXT_PUBLIC_APP_MODE=$NEXT_PUBLIC_APP_MODE \
    NEXT_PUBLIC_MAINTENANCE_ON=$NEXT_PUBLIC_MAINTENANCE_ON \
    NODE_ENV=production

RUN --mount=type=secret,id=buildenv \
    sh -c 'set -a && . /run/secrets/buildenv && set +a && npm run build'

ENV PORT=8080
EXPOSE 8080
CMD ["sh", "-c", "npx next start -p ${PORT}"]
