---
sidebar_position: 2
---

# Docs Site (This Site)

This site is the official documentation hub for **Kappa Theta Pi – Phi Chapter (UGA)**.

We use **Docusaurus** to power the docs, which gives us:

- Markdown-first content
- Versioned documentation
- Fast static builds
- Clean routing and search
- Easy contributions via Git

## Tech Stack

- **Framework:** Docusaurus
- **Language:** Markdown (with MDX support)
- **Build:** Node.js
- **Deployment:** Docker on a Proxmox-hosted server

## Deployment 🥀

This site is **automatically rebuilt and redeployed every night at midnight** via a scheduled
[cron job](https://en.wikipedia.org/wiki/Cron) on the Proxmox host.

The job performs the following steps:

1. Pulls the latest changes from the Git repository
2. Rebuilds the Docusaurus static site inside Docker
3. Recreates the running container with the updated build

As a result, any merged changes to the repo will be reflected on **docs.ugaktp.com** without manual intervention.

(Previously, this process was fully manual — involving SSH, `git pull`, and a lot of `docker compose` commands. We do better now.)

## Contributing

If you’re contributing to this site:

- Write Markdown (or MDX)
- Commit and push your changes
- Wait for the nightly rebuild ✨

See [Intro to KTP Docs](../intro.md) for more information.
