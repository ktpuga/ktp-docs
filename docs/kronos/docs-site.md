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

## Access Control (SSO)

This site is gated behind **Authentik SSO** — anyone visiting `docs.ugaktp.com` must log in with a KTP account before seeing any page. This was added once the docs started including infrastructure detail (internal IPs, deployment procedures, database commands) that shouldn't be public.

It works via **Authentik's forward-auth pattern**, since Docusaurus has no auth of its own — Traefik intercepts every request to `docs.ugaktp.com` and asks Authentik's embedded outpost "is this person logged in?" before ever proxying to the actual docs container.

### Authentik side

1. **Applications → Providers → Create → Proxy Provider**, named `docs-proxy`
   - Mode: **Forward auth (single application)**
   - External host: `https://docs.ugaktp.com`
   - Authorization flow: same one `ktpapp` uses
2. **Applications → Applications → Create**, named `KTP Docs`, provider `docs-proxy`
   - Access restricted to actual member groups (active/chair/alumni/eboard/pledge) via a policy binding, not open to any Authentik account
3. **Applications → Outposts** → edit the embedded outpost → add `docs-proxy` to its assigned providers. The embedded outpost runs as part of Authentik itself, reachable at `10.0.0.4:9000` under the `/outpost.goauthentik.io/` path prefix — no separate container needed.

### Traefik side

`docs.ugaktp.com` is deployed on the **Dokploy VM** (10.0.0.7), which auto-regenerates its own Traefik domain config (`/etc/traefik/config/dokploy-domains.yml`) — hand-editing that file directly gets silently reverted (the same trap already known from the Dokploy-domains gotcha elsewhere in these docs). So:

- **Check Dokploy's own UI first** for a per-app "Advanced"/"Labels" section to attach custom Traefik middleware — that's the correct place if it exists, since it won't conflict with what Dokploy regenerates.
- **If not available**, add a separate dynamic config file outside Dokploy's managed file (e.g. `/etc/traefik/config/ktp-docs-auth.yaml`):

```yaml
http:
  middlewares:
    authentik-forwardauth:
      forwardAuth:
        address: "http://10.0.0.4:9000/outpost.goauthentik.io/auth/traefik"
        trustForwardHeader: true
        authResponseHeaders:
          - X-authentik-username
          - X-authentik-groups
          - X-authentik-email

  routers:
    # Must have higher priority than the docs router — handles the actual
    # login redirect/callback, which needs to reach Authentik directly,
    # not the docs backend. Missing this router is the most common way
    # this setup breaks (login redirect loops).
    docs-outpost-auth:
      rule: "Host(`docs.ugaktp.com`) && PathPrefix(`/outpost.goauthentik.io/`)"
      service: authentik-outpost
      priority: 10

  services:
    authentik-outpost:
      loadBalancer:
        servers:
          - url: "http://10.0.0.4:9000"
```

Then attach the `authentik-forwardauth` middleware to whichever router already serves `docs.ugaktp.com` (Dokploy likely already created this router — you're adding a middleware reference to it, not recreating it, to minimize conflict with what Dokploy manages).

### Troubleshooting

**Login redirect loops instead of reaching the docs:** almost always means the `docs-outpost-auth` router (or Dokploy-UI equivalent) is missing or has lower priority than the main docs router — the callback needs to hit Authentik directly at `/outpost.goauthentik.io/...`, not bounce through the docs container.

**"403 Forbidden" after logging in successfully:** check the `KTP Docs` application's policy bindings in Authentik — the logged-in account's group isn't included.

## Contributing

If you’re contributing to this site:

- Write Markdown (or MDX)
- Commit and push your changes
- Wait for the nightly rebuild ✨

See [Intro to KTP Docs](../intro.md) for more information.
