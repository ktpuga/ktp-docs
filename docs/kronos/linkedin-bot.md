---
sidebar_position: 5
---

# LinkedIn Embed Bot

The bot reads LinkedIn links from Discord and sends them to the API for the public homepage. See [LinkedIn Spotlight](../website/linkedin-spotlight.md) for ingestion and display behavior. This page covers deployment.

## Why an LXC and not Dokploy

The bot opens outbound connections to Discord and ktp-api. It has no inbound service to expose through Traefik. The documented deployment uses a Node.js process managed by systemd.

## Container

| Setting | Documented configuration |
|---|---|
| Purpose | LinkedIn embed bot |
| Template | Debian 12 |
| RAM | 512 MB |
| Disk | 4 GB |
| Network | `10.0.0.0/24` |
| Dependencies | Node 20+, git |

See [Adding a VM / CT](./adding-vm-ct.md). The bot requires no reverse-proxy route or TLS certificate.

## Install

Run inside the bot's LXC as root:

```bash
apt update && apt install -y git curl
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

adduser --system --group --no-create-home ktpbot

git clone <repo-url> /opt/linkedin-embed-bot
cd /opt/linkedin-embed-bot
npm ci --omit=dev
npm test
```

The service expects the checkout at `/opt/linkedin-embed-bot`. Check the repository's runtime requirements before changing Node versions.

## Configure

```bash
cp .env.example .env
nano .env
chown ktpbot:ktpbot .env
chmod 600 .env
```

| Variable | Value |
|---|---|
| `DISCORD_TOKEN` | Token from the Discord Developer Portal |
| `LINKEDIN_CHANNEL_ID` | Channel ID, available with Discord Developer Mode |
| `API_URL` | `http://10.0.0.53:4000` for the documented LAN deployment |
| `LINKEDIN_BOT_SECRET` | Same value as the API's environment on LXC 119 |
| `SCAN_EXISTING_MESSAGES` | `true` for the initial import, then `false` |

Use the internal API address on Kronos to avoid the public hostname's hairpin-NAT issue.

`API_URL` and `LINKEDIN_BOT_SECRET` must be configured together. If both are absent, the bot can print links without ingesting them. If only one is set, startup fails.

Enable Message Content Intent in the Discord Developer Portal and grant View Channel and Read Message History permissions on the source channel.

## Run it

```bash
cp deploy/linkedin-embed-bot.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now linkedin-embed-bot
systemctl status linkedin-embed-bot
journalctl -u linkedin-embed-bot -f
```

The startup log identifies the bot, channel, and API ingestion mode. With scanning enabled, it logs discovered URLs and a completion count.

## Turn the history scan off after the first run

After a successful import, set `SCAN_EXISTING_MESSAGES=false` and restart.

When enabled, every restart rereads the channel and posts discovered links again. The API upserts by `linkedin_urn`, preserving existing publication state, but the repeated requests are unnecessary after the import.

The unit limits starts using `StartLimitIntervalSec=300` and `StartLimitBurst=5` in its `[Unit]` section. If the limit is reached, investigate the failure before resetting it.

## Updating

```bash
cd /opt/linkedin-embed-bot
git pull
npm ci --omit=dev
systemctl restart linkedin-embed-bot
```

The documented bot deployment does not automatically update on a push.

## When something is wrong

| Symptom | Check |
|---|---|
| `status=200/CHDIR` | Checkout path and service-user access |
| Missing `dotenv` | Dependencies were installed in the checkout |
| Unexpected Node version | `node --version`, executable path, and package source |
| Start limit reached | Journal output; fix the cause, then `systemctl reset-failed linkedin-embed-bot` and restart |
| Missing environment variables | `.env` exists and is readable by `ktpbot` |
| API configuration error | Both API URL and shared secret are set |
| URLs printed but no ingestion | Startup log says API ingestion is enabled |
| API returns 401 | Bot and API secrets match |
| API returns 503 | API has `LINKEDIN_BOT_SECRET` configured |
| No links found | Message Content Intent and channel permissions |
| Discord deletion leaves the post published | Client enables `Partials.Message` for uncached delete events |
| Ingested post absent from homepage | Publication state in Admin → Homepage Media → LinkedIn |
| LinkedIn embed shows a sign-in or unavailable page | Run Check against LinkedIn and inspect API availability-worker logs |

Read recent logs with:

```bash
journalctl -u linkedin-embed-bot -n 200 --no-pager
```

The service uses `ProtectHome=true`. A checkout under `/root` is inaccessible to it, even if `WorkingDirectory` points there. Keep the checkout under `/opt` and preserve restrictive permissions on `.env`.

The bot handles ingestion and Discord deletions. The API on LXC 119 checks whether stored posts are still available on LinkedIn. See [the availability check](../website/linkedin-spotlight.md#a-scheduled-check-that-posts-still-exist).

## Secret rotation

Generate a replacement with `openssl rand -hex 32`. Set the same `LINKEDIN_BOT_SECRET` in:

1. `/opt/ktp-api/.env` on LXC 119.
2. `/opt/linkedin-embed-bot/.env` on the bot container.

Recreate the API service with the updated environment using `docker compose up -d --force-recreate` from its deployment directory, then restart `linkedin-embed-bot`. Check ingestion afterward.
