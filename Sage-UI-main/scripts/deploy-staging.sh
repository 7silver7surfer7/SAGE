#!/usr/bin/env bash
# One-command STAGING deploy for testnet.sageart.xyz — build, push, deploy.
#
# Staging = Robinhood TESTNET (chain 46630, staging config block in
# config.ts) + the `staging` schema of the shared Supabase Postgres. It
# exists so changes can be exercised end-to-end before deploy-prod.sh sends
# them to mainnet sageart.xyz (2026-07-12 launch-day lesson).
#
# Needs (both gitignored, created 2026-07-12):
#  - .env.staging-deploy  build secret: prod DB URL + `schema=staging`
#  - .env.staging.yaml    runtime env: NEXTAUTH_URL=testnet.sageart.xyz,
#                         APP_MODE=staging, staging-schema DB URL
#
# Same incident notes as deploy-prod.sh: deploy by DIGEST; staging is a
# separate service so --env-vars-file is safe HERE (it's the whole point);
# never point this at the sage-testnet (prod) service.
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE=us-west1-docker.pkg.dev/sage-testnet-market/sage/sage-ui:staging
SERVICE=sage-staging

echo "==> building (linux/amd64, staging mode)…"
# --provenance=false --sbom=false: without these, buildx (containerd image
# store) pushes an OCI index with attestation manifests, which Cloud Run
# rejects with "does not provide any platform". Force a single-platform image.
# Clean-export build, same rationale as deploy-prod.sh: only COMMITTED state
# ships; a parallel session's uncommitted work can never ride along.
BUILD_DIR=$(mktemp -d /tmp/sage-staging-build.XXXXXX)
trap 'rm -rf "$BUILD_DIR"' EXIT
git archive HEAD | tar -x -C "$BUILD_DIR"
docker build --platform linux/amd64 --provenance=false --sbom=false \
  --secret id=buildenv,src="$(pwd)/.env.staging-deploy" \
  --build-arg NEXT_PUBLIC_APP_MODE=staging \
  --build-arg NEXT_PUBLIC_DEX_ENABLED="${NEXT_PUBLIC_DEX_ENABLED:-}" -t "$IMAGE" "$BUILD_DIR"

echo "==> pushing…"
docker push "$IMAGE"

DIGEST=$(docker inspect --format='{{index .RepoDigests 0}}' "$IMAGE")
echo "==> deploying $DIGEST to $SERVICE"
gcloud run deploy "$SERVICE" --region us-west1 --image "$DIGEST" \
  --timeout 3600 --allow-unauthenticated \
  --env-vars-file .env.staging.yaml

echo "==> smoke checks…"
URL=$(gcloud run services describe "$SERVICE" --region us-west1 --format='value(status.url)')
curl -s -o /dev/null -w "service URL homepage: %{http_code}\n" "$URL/"
curl -s -o /dev/null -w "testnet.sageart.xyz homepage: %{http_code}\n" https://testnet.sageart.xyz/ || true
echo "done."
