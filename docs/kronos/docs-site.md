---
sidebar_position: 2
---

# Docs Site (This Site)

The chapter documentation uses Docusaurus, with Markdown and MDX source files. Node.js builds the static site, which runs in Docker on Kronos.

## Tech Stack

| Component | Tool |
|---|---|
| Site framework | Docusaurus |
| Content | Markdown and MDX |
| Build | Node.js |
| Hosting | Docker on Proxmox |

## Deployment {#deployment-}

The documented deployment schedule is a midnight cron job on the Proxmox host. It pulls the repository, builds the site in Docker, and recreates the running container.

Merged changes appear after a successful scheduled build. If the site is stale, check the cron job and build output.

## Access Control (SSO)

Authentik protects `docs.ugaktp.com` through Traefik forward authentication. Docusaurus serves static files; Traefik asks Authentik to authorize requests before forwarding them to the docs container.

The Authentik application policy admits active, chair, alumni, eboard, and pledge groups. Rush-only accounts are excluded.

### Authentik side

1. Create a Proxy Provider named `docs-proxy`.
   - Mode: Forward auth (single application).
   - External host: `https://docs.ugaktp.com`.
   - Authorization flow: the flow configured for `ktpapp`.
2. Create the KTP Docs application using that provider and bind the member-group access policy.
3. Assign `docs-proxy` to the embedded outpost.

The documented outpost address is `10.0.0.4:9000`, with routes under `/outpost.goauthentik.io/`.

### Traefik side

The docs site runs on the Dokploy VM at `10.0.0.7`. Dokploy regenerates `/etc/traefik/config/dokploy-domains.yml`, so manual edits to that file may be overwritten.

Use Dokploy's per-application middleware configuration if available. Otherwise, define the middleware and outpost route in a separate dynamic configuration file such as `/etc/traefik/config/ktp-docs-auth.yaml`:

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
    # Set this higher than the main docs router's priority.
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

Attach `authentik-forwardauth` to the main docs router. The outpost route must reach Authentik directly, without passing through the same authentication middleware.

The example priority of 10 must be adjusted if the main router has a higher priority. Confirm the effective priorities in the deployed configuration.

### Troubleshooting

| Symptom | Check |
|---|---|
| Login redirect loop | Outpost router exists, outranks the docs router, and forwards the outpost path directly to Authentik |
| 403 after login | KTP Docs policy bindings and the account's groups |
| Configuration changes disappear | The change was made through Dokploy or in a separate file, not its generated domain file |

## Contributing

Edit the Markdown or MDX, run the docs build, then commit and push. The nightly deployment picks up merged changes. See [Intro to KTP Docs](../intro.md).
