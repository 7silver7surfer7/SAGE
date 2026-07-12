# SAGE on a Raspberry Pi 5 (8GB, arm64)

Full self-hosted marketplace: app + Postgres + settlement crons on one device.
Cloud Run stays the live deployment until this is proven — nothing here
changes prod.

## Why the stack fits an 8GB Pi

The heavy paths were already memory-disciplined (serialized ffmpeg, streamed
zip bundling) and the remaining ceilings are now tunable:

- **Media cache** (`MEDIA_CACHE_DIR`, `MEDIA_CACHE_LIMIT_MB`) — on Cloud Run
  `/tmp` is RAM; on the Pi it's disk. The compose file points it at a named
  volume (put Docker's data-root on NVMe, not the SD card) with a 4GB cap.
- **Collection bundling** (`COLLECTION_BUNDLE_TARGET_MB=50`) — peak RAM during
  a bundle flush is ~3× the target; 50MB keeps it ~150MB.
- **Postgres** — `shared_buffers=512MB, work_mem=8MB, max_connections=40`, and
  Prisma capped at `connection_limit=5` per client.
- **ffmpeg** — already gated to one transcode at a time; prewarm videos at
  drop-approval time (the deploy flow does this) so viewers never trigger one.

## 1. Build the images OFF the Pi (never `next build` on-device)

On the Mac (Docker Desktop does arm64 cross-builds transparently):

```sh
# marketplace app (standalone output, multi-stage)
cd Sage-UI-main
docker build --platform linux/arm64 -f ../deploy/pi/Dockerfile.pi \
  --secret id=buildenv,src=.env.deploy -t sage-ui:pi .

# settlement cron (bullseye base: Prisma 4's engine needs OpenSSL 1.1, which
# Raspberry Pi OS Bookworm no longer ships — hence a container, not bare metal)
cd ../Sage-Solidity-main
docker build --platform linux/arm64 -t sage-cron:pi .

docker save sage-ui:pi sage-cron:pi | gzip > sage-pi-images.tar.gz
scp sage-pi-images.tar.gz pi@<pi-host>:
```

## 2. First boot on the Pi

```sh
sudo mkdir -p /opt/sage && cd /opt/sage
# copy deploy/pi/* here, then:
docker load < ~/sage-pi-images.tar.gz
cp .env.pi.example .env    # fill in secrets
docker compose up -d postgres
# create the schema (uses the app image's traced prisma client)
docker compose run --rm --entrypoint sh app -c \
  'npx prisma db push --schema=./src/prisma/schema.prisma' \
  || echo "if the schema isn't in the image, run db push from the dev box against the Pi's postgres"
docker compose up -d app
```

Smoke-test: `curl -s http://<pi-host>:3000/api/health || curl -sI http://<pi-host>:3000/`
and verify the pixels cron runs end-to-end once:
`docker compose run --rm pixels-cron`.

## 3. Crons (replaces Cloud Scheduler)

```sh
sudo cp systemd/sage-update-*.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now sage-update-games.timer sage-update-pixels.timer
systemctl list-timers 'sage-*'
```

## 4. Public ingress (sageart.xyz)

Use a Cloudflare Tunnel — no port-forwarding, and the existing CF cache rules
(posters + `/_next/image` cached, videos bypassed) keep working unchanged:

1. Cloudflare dashboard → Zero Trust → Tunnels → create one, copy the token
   into `.env` as `TUNNEL_TOKEN`.
2. Point the tunnel's public hostname (sageart.xyz) at `http://app:3000`.
3. `docker compose --profile public up -d cloudflared`.
4. After cutover, run `Sage-UI-main/scripts/warm-media.sh` as usual.

## Gotchas

- **SD card wear**: keep Docker's data-root (and with it the pgdata +
  media-cache volumes) on NVMe. SD-only Pis should mount a tmpfs at the media
  cache path and drop `MEDIA_CACHE_LIMIT_MB` back to ~512.
- **Prisma + OpenSSL**: the games cron MUST stay in its bullseye container on
  Bookworm hosts (engine links libssl 1.1). The app image (node:20-slim =
  bookworm-era Debian with OpenSSL 3) is fine because the UI repo's Prisma
  version ships an OpenSSL-3 engine.
- **Hardhat compile**: the cron image pre-compiles contracts at build time so
  `hre.run("compile")` stays a no-op at runtime — don't strip `artifacts/`.
- **Verify the standalone trace once**: `docker compose run --rm pixels-cron`
  must find `@prisma/client` + `ethers` inside the app image. If Next's file
  tracing ever misses the prisma engine binary, add it to the Dockerfile.pi
  runner stage explicitly.
