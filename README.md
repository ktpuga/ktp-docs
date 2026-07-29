# ktp-docs

Source for **[docs.ugaktp.com](https://docs.ugaktp.com)** — internal documentation for KTP Phi Chapter's infrastructure, API, website, Authentik setup, and exec board roles. Built with [Docusaurus](https://docusaurus.io/) 3.

The site is **behind Authentik SSO**. It carries internal IPs, deployment procedures, and database commands, so it is not public — you need a KTP account in a real member group to read it.

## Local development

Requires Node 20+.

```bash
npm install
npm start          # dev server with live reload
npm run build      # static build into build/
npm run serve      # serve an existing build
```

Content lives in `docs/` as Markdown. Sidebar structure is in `sidebars.ts`; site config (nav, footer, theme) is in `docusaurus.config.ts`.

## Structure

| Section | Covers |
|---|---|
| `docs/intro.md` | Landing page |
| `docs/api/` | ktp-api overview and endpoint reference |
| `docs/website/` | The Next.js site — portals, messaging, photos/documents, profiles |
| `docs/authentik/` | SSO setup, enrollment, invitations, group management |
| `docs/kronos/` | Server/infrastructure — Proxmox, containers, Dokploy, this docs site |
| `docs/operations/` | Day-to-day runbooks, e.g. member management |
| `docs/exec-board/` | Exec board role responsibilities |

## Deployment

**Do not run `npm run deploy`.** That's Docusaurus's built-in GitHub Pages command and it does not apply here — this site is not on GitHub Pages.

The site runs in Docker on the **Dokploy VM (10.0.0.7)** and is **rebuilt and redeployed automatically every night at midnight** by a scheduled job. Merging to `main` is enough; changes appear after the next nightly run. See [`docs/kronos/docs-site.md`](docs/kronos/docs-site.md) for the deployment and SSO details, including the Traefik forward-auth configuration that fronts the site.

One gotcha documented there and worth repeating: Dokploy regenerates `/etc/traefik/config/dokploy-domains.yml` itself, so hand-edits to that file get silently reverted. Custom Traefik middleware belongs either in Dokploy's own per-app config UI or in a separate dynamic config file it doesn't manage.
