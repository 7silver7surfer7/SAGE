#!/usr/bin/env bash
# One-command production deploy for sageart.xyz — build, push, deploy, WARM.
#
# Exists because the steps are individually easy to fumble and the last one is
# easy to forget: every deploy starts a Cloud Run instance with an EMPTY tmpfs
# media cache, and an unwarmed cache is exactly how "The media could not be
# loaded" reappeared on 2026-07-11 (deploy went out, warm-media.sh didn't).
#
# Notes baked in from past incidents:
#  - run from Sage-UI-main (needs .env.deploy for the build secret)
#  - deploy by DIGEST, not tag: a failed build otherwise silently re-deploys
#    whatever the local tag still points at (also happened 2026-07-11)
#  - NEVER pass --env-vars-file here — it REPLACES all runtime env vars
#    (the NEXTAUTH_URL outage). Surgical changes only, via --update-env-vars.
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE=us-west1-docker.pkg.dev/sage-testnet-market/sage/sage-ui:testnet

echo "==> building (linux/amd64, MAINNET production mode)…"
# NEXT_PUBLIC_APP_MODE is inlined into the client bundle at BUILD time
# (Dockerfile ARG, default staging = testnet config). Since the 2026-07-12
# mainnet launch, sageart.xyz IS mainnet: bake production, and mirror the
# same value into the runtime env below so server-side code (which reads
# process.env at runtime) selects the same config block as the client.
#
# Build from a CLEAN EXPORT of HEAD, never the working tree: this script
# once shipped a whole in-progress feature to mainnet because a parallel
# session's uncommitted files were sitting in the shared checkout when an
# unrelated deploy ran (the 2026-07-21 chain-wide-DEX leak, reverted in
# 420bc27). git archive contains exactly what is committed — uncommitted
# work physically cannot ride along. Secrets stay OUT of the archive
# (gitignored), so .env.deploy mounts from the real checkout by absolute
# path.
BUILD_DIR=$(mktemp -d /tmp/sage-prod-build.XXXXXX)
trap 'rm -rf "$BUILD_DIR"' EXIT
git archive HEAD | tar -x -C "$BUILD_DIR"
docker build --platform linux/amd64 --provenance=false --sbom=false \
  --secret id=buildenv,src="$(pwd)/.env.deploy" \
  --build-arg NEXT_PUBLIC_APP_MODE=production \
  --build-arg NEXT_PUBLIC_DEX_ENABLED="${NEXT_PUBLIC_DEX_ENABLED:-}" -t "$IMAGE" "$BUILD_DIR"

echo "==> pushing…"
docker push "$IMAGE"

DIGEST=$(docker inspect --format='{{index .RepoDigests 0}}' "$IMAGE")
echo "==> deploying $DIGEST"
gcloud run deploy sage-testnet --region us-west1 --image "$DIGEST" --timeout 3600 \
  --update-env-vars NEXT_PUBLIC_APP_MODE=production

echo "==> warming media cache (fresh instance = cold cache)…"
bash scripts/warm-media.sh

echo "==> smoke checks…"
curl -s https://sageart.xyz/api/auth/providers/ | grep -q 'sageart.xyz' \
  && echo "auth URLs OK" || { echo "AUTH URLS BROKEN — check NEXTAUTH_URL"; exit 1; }
curl -s -o /dev/null -w "homepage: %{http_code}\n" https://sageart.xyz/
echo "done."
