# SAGE Social activity drip

Keeps **testnet.sageart.xyz** feeling alive until the real launch: a cast of 50
bot accounts (HD-derived from a mnemonic in `~/.sage-social-drip.env`) joins
through the real invite tree and keeps a human-looking pulse — a few posts per
tick with likes/replies/reposts/follows/DMs clustered around them, plus an
occasional viral burst. Entirely **off-chain** (no gas). **Refuses to run
against production.**

## Install (always-on, survives reboots + Claude sessions)
```
cp deploy/social-drip/xyz.sageart.social-drip.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/xyz.sageart.social-drip.plist
```
Runs every 20 min. Logs: `deploy/social-drip/drip.log`.

## Stop (do this at launch)
```
launchctl unload ~/Library/LaunchAgents/xyz.sageart.social-drip.plist
```

## Run one tick by hand
```
source ~/.sage-social-drip.env && node Sage-UI-main/scripts/social-drip.mjs
```

## Tuning (env in ~/.sage-social-drip.env)
- `SOCIAL_DRIP_CAST` — cast size (default 50)
- `SOCIAL_DRIP_SITE` — target (default testnet; prod is hard-blocked)
- `SOCIAL_DRIP_NO_JITTER=1` — skip the 0–2 min startup jitter (for manual runs)
