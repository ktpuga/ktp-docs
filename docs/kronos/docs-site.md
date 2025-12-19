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

Right now ts is MANUALLY being rebuilt every time there is a commit. I (Ryan) go in and pull the changes in the console from the proxmox web interface (container 104) titled **docs**.

Then I have to like, docker compose down and then docker build and stuff, then i gotta do the classic:

```bash
docker compose up -d
```

But like, I am going to make a [cron job](https://en.wikipedia.org/wiki/Cron) so this happens automagically, trust!

See [Intro to KTP Docs](../intro.md) for more info!
