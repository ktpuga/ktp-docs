---
sidebar_position: 5
---

# LinkedIn Embed Bot

The Discord bot that puts LinkedIn posts on the public homepage. What it does and how it parses links is in [LinkedIn Spotlight](../website/linkedin-spotlight.md); this page is only about running it on Kronos.

## Why an LXC and not Dokploy

Dokploy deploys from a Git repo or a Docker image, and what it buys you is Traefik routing, TLS and domain management.

**This bot has no inbound ports.** It opens an outbound WebSocket to Discord and makes outbound HTTP calls to ktp-api. None of Dokploy's features apply to it, so putting it there would be paying the complexity for none of the benefit. One long-lived Node process that must restart on failure and start on boot is exactly what systemd is for.

## Container

| | |
|---|---|
| Purpose | LinkedIn embed bot only |
| Template | **Debian 12 (bookworm)** |
| RAM | 512 MB is plenty — one Node process holding a WebSocket |
| Disk | 4 GB (`node_modules` is ~40 MB) |
| Network | Same `10.0.0.0/24` as everything else |
| Needs | Node 20+, git |

See [Adding a VM / CT](./adding-vm-ct.md) for creating the container itself.

:::note Debian rather than Ubuntu
Proxmox is Debian-based, so the Debian template is the best-tested LXC target on this host. It is also meaningfully smaller, which matters on a node where LXC 119 has already hit "no space left on device" once, and it ships without `snapd` and the other pieces that are awkward inside a container.

Node installs identically on both through NodeSource, so Ubuntu buys nothing here and costs image size.
:::

:::note It needs no reverse-proxy entry
Do not add it to Traefik. Nothing connects **to** this bot — there is no port to route and no certificate to issue.
:::

## Install

```bash
# As root on the new LXC
apt update && apt install -y git curl
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# A service account with no login and no home directory to protect
adduser --system --group --no-create-home ktpbot

git clone <repo-url> /opt/linkedin-embed-bot
cd /opt/linkedin-embed-bot
npm ci --omit=dev
npm test          # 15 tests, no network or database needed
```

## Configure

```bash
cp .env.example .env
nano .env
chown ktpbot:ktpbot .env
chmod 600 .env    # it holds the Discord token AND the shared API secret
```

| Variable | Value |
|---|---|
| `DISCORD_TOKEN` | From the Discord Developer Portal |
| `LINKEDIN_CHANNEL_ID` | Right-click the channel with Developer Mode on |
| `API_URL` | `http://10.0.0.53:4000` — **the LAN address, never `api2.ugaktp.com`** |
| `LINKEDIN_BOT_SECRET` | Must match `LINKEDIN_BOT_SECRET` in `/opt/ktp-api/.env` on LXC 119 |
| `SCAN_EXISTING_MESSAGES` | `true` for the first run, then see below |

:::warning Use the internal address for `API_URL`
Pointing this at `https://api2.ugaktp.com` is the hairpin-NAT trap that has bitten this project repeatedly — an internal host resolving the public name reaches the router, not Traefik. Every other internal caller uses the `10.0.0.x` address for the same reason.
:::

:::warning `API_URL` and `LINKEDIN_BOT_SECRET` must be set together
Setting only one is a **startup error**, deliberately. Half-configured, the bot would look connected and silently save nothing.
:::

The bot must also have **Message Content Intent** enabled in the Discord Developer Portal, and *View Channel* + *Read Message History* on the channel. Without the intent every message arrives with empty content and the bot finds no links while reporting no error.

## Run it

```bash
cp deploy/linkedin-embed-bot.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now linkedin-embed-bot
systemctl status linkedin-embed-bot
journalctl -u linkedin-embed-bot -f
```

A healthy first start logs the bot's tag, the channel id, `API ingestion enabled: http://10.0.0.53:4000`, then one line per embed URL it finds, then `Finished scanning N existing messages.`

## Turn the history scan off after the first run

Set `SCAN_EXISTING_MESSAGES=false` in `.env` and restart once the first scan has completed successfully.

While it is `true`, **every restart re-reads the entire channel and re-POSTs every link it finds.** That is safe — the API upserts on `linkedin_urn`, so nothing duplicates and an unpublished post is *not* silently republished — but it is N HTTP requests per restart for no new information.

The unit file carries `StartLimitIntervalSec=300` / `StartLimitBurst=5` for exactly this reason: a boot loop with the scan enabled would otherwise replay the whole channel against ktp-api every ten seconds. After five failed starts in five minutes it stays down until somebody looks, which is the right outcome.

:::note Those two keys belong in `[Unit]`, not `[Service]`
They moved sections in systemd 230. Under `[Service]` they are silently ignored as unknown keys, so the brake would appear to be configured and do nothing.
:::

## Updating

```bash
cd /opt/linkedin-embed-bot
git pull
npm ci --omit=dev
systemctl restart linkedin-embed-bot
```

**Unlike `ktp-api` and the website, this does not auto-deploy on push.** Nothing watches the repo; a push changes nothing until somebody runs the above.

## When something is wrong

| Symptom | Cause |
|---|---|
| Exits immediately, "Missing environment variables" | `.env` absent or unreadable by `ktpbot` — check `chown` |
| "API_URL and LINKEDIN_BOT_SECRET must be configured together" | Exactly one of the two is set |
| Prints embed URLs but nothing reaches the site | `API ingestion disabled` in the startup log, i.e. no `API_URL` |
| `KTP API returned 401` | The secret does not match `/opt/ktp-api/.env` on LXC 119 |
| `KTP API returned 503` | `LINKEDIN_BOT_SECRET` is not set **on the API side** |
| Finds no links in a channel that has them | Message Content Intent is off in the Developer Portal |
| Deleting a Discord message leaves the post up | Check `Partials.Message` is in the client config — without it discord.js drops delete events for uncached messages |
| Nothing on the homepage even though posts ingested | Check the posts are published: Admin → Homepage Media → LinkedIn |

Logs are in the journal: `journalctl -u linkedin-embed-bot -n 200 --no-pager`.

## Secret rotation

The bot secret is shared between two files and nothing else reads it:

1. `LINKEDIN_BOT_SECRET` in `/opt/ktp-api/.env` on **LXC 119**
2. `LINKEDIN_BOT_SECRET` in `/opt/linkedin-embed-bot/.env` on **this container**

Generate with `openssl rand -hex 32`. Change both, then `docker compose up -d --force-recreate` on 119 and `systemctl restart linkedin-embed-bot` here — a plain `docker compose up -d` does not reliably re-read a changed `env_file`.
