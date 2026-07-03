---
sidebar_position: 1
---

# Overview

**Authentik** is the identity provider (IdP) for KTP Georgia. It handles all login, SSO, and user onboarding. No passwords or credentials are stored in the KTP API or website — everything goes through Authentik.

**URL:** [https://auth.ugaktp.com](https://auth.ugaktp.com)  
**Internal address:** `http://10.0.0.4:9000` (LXC 103)

---

## What Authentik Does

| Responsibility | Owner |
|---------------|-------|
| Usernames & passwords | Authentik |
| Group membership | Authentik |
| SSO / login session | Authentik |
| Profile data (name, major, etc.) | PostgreSQL (via ktp-api) |
| Portal access control | Website middleware (reads Authentik groups from JWT) |

---

## OIDC Application

The website and iOS app both authenticate via the **KTP OIDC application** in Authentik.

**Application slug:** `ktpapp`  
**Issuer URL:** `https://auth.ugaktp.com/application/o/ktpapp/`  
**JWKS URL (internal):** `http://10.0.0.4:9000/application/o/ktpapp/jwks/`

### Redirect URIs (strict)

- `https://ugaktp.com/api/auth/callback/authentik`
- `https://ktpgeorgia.com/api/auth/callback/authentik`

> Add the app's development URL (e.g. `http://localhost:3000/api/auth/callback/authentik`) when running locally.

### PKCE

PKCE is **disabled** on the website provider config (`checks: ["state"]` in `auth.ts`). PKCE cookies don't survive the Traefik reverse proxy round-trip, causing `InvalidCheck: pkceCodeVerifier` errors in production. State-only check is sufficient.

---

## Groups and Portal Routing

Authentik groups map directly to portals on the website:

| Authentik Group | Portal | Notes |
|----------------|--------|-------|
| `eboard` | `/admin` | Exec board members |
| `chair` | `/member` | Committee chairs |
| `active` | `/member` | Active members |
| `pledge` | `/pledge` | Current pledge class |
| `alumni` | `/alumni` | Alumni (page not yet built) |
| `admin` | — | System admins, no portal |

**Priority order** (when a user is in multiple groups): `eboard > chair > active > pledge > alumni`

The `member_group` stored in the database reflects the highest-priority group at login time.

---

## Property Mappings

A custom property mapping is required for the `authentik_pk` field to work:

| Name | Scope | Expression |
|------|-------|-----------|
| KTP User PK | openid | `return {"authentik_pk": request.user.pk}` |

This mapping must be added to the **KTP OIDC provider's selected Property Mappings**. Without it, `authentik_pk` stays `NULL` in the database and the webhook-based deletion cannot match rows.

---

## Webhook (User Deletion)

A notification transport is configured to call the API when a user is deleted in Authentik.

**Transport URL (internal):** `http://10.0.0.53:4000/webhooks/authentik`  
**Trigger:** Event Matcher Policy — Action: `Model Deleted`, Model: `authentik_core.user`, App field: blank

> **Known issue:** The `X-Authentik-Token` header is not being transmitted by the Authentik transport regardless of configuration format tried. Webhook auth verification is disabled for now. When a user is deleted in Authentik, also manually delete their row:
> ```sql
> DELETE FROM users WHERE username = 'username';
> ```

---

## User Deletion (Manual Process)

Until the webhook is fully working:

1. In Authentik: **Directory → Users → select user → Delete**
2. On LXC 118 (PostgreSQL):
   ```bash
   su - postgres
   psql -d ugaktp_db
   DELETE FROM users WHERE username = 'username';
   ```

---

## Password Reset for Existing Users

Forced password reset was removed from the authentication flow. To reset a specific user's password:

1. Authentik admin panel → **Directory → Users → select user**
2. Click **Recovery Link**
3. Email the link to the user

New users set their password through the enrollment invitation flow — they never need a separate reset step.
