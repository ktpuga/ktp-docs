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

## API Tokens / Service Accounts

Used when ktp-api needs to call Authentik's own REST API directly, rather than just verifying tokens Authentik issued — currently only for the eboard "change member group" admin action (`services/authentikAdmin.js`, see [API: Eboard — changing a member's group](../api/overview.md#eboard-changing-a-members-group)).

Authentik tokens are always bound to a single Identity (a User) — there's no way to create a token "for a group" directly. The pattern used here:

1. **Directory → Users → Create Service Account** — creates a dedicated non-person user (`ktp-api-service`) and generates an API token in the same flow (shown once, copy it immediately). Using a dedicated service account rather than binding the token to a real person's account means it doesn't break if that person is demoted or leaves.
2. **Directory → Groups → Create** a group (e.g. also named `ktp-api-service`) and add the service account user to it as a member.
3. **Directory → Roles → Create** a Role (e.g. `ktp-api-group-manager`), then assign it to that group.
4. Grant the Role permissions:
   - **Object-level**, on each of the five role groups individually (`eboard`/`chair`/`active`/`alumni`/`pledge` — go to each group's own Permissions tab → "Assign object permissions to role"): `Add user to group`, `Remove user from group`, `Can view Group`. Scoping this per-object (not globally) means the token can only ever touch these five specific groups, not every group in the instance.
   - **Global**, on the Role's own "Assigned global permissions" tab (not "Initial Permissions" — that's a different feature, for auto-granting permissions on objects the role's members *create*, not applicable here): `Can view User`. This one has to be global since ktp-api needs to look up any member, including ones who join later — a per-object grant wouldn't cover future users.
5. Generate the token: **Directory → Tokens and App passwords → Create**, Identity = the service account, **Intent = API Token** (this field matters — other intents get rejected as `Token invalid/expired` even though the token exists and looks otherwise correct).
6. Copy the token into `AUTHENTIK_API_TOKEN` in ktp-api's `.env`. `docker compose restart` does **not** re-read `.env` — use `docker compose up -d` (recreate) after changing it.

---

## Webhook (User Deletion)

A notification transport calls the API when a user is deleted in Authentik. **Working and confirmed in production** — deleting a user in Authentik correctly removes their row from `users` with no manual step.

**Transport URL (internal):** `http://10.0.0.53:4000/webhooks/authentik`  
**Trigger:** Event Matcher Policy — Action: `Model Deleted`, Model: `authentik_core.user`, App field: **blank** (see below for why)

This took a while to get right — two independent, non-obvious Authentik-side misconfigurations, neither on the ktp-api side:

1. **The Notification Rule needs a Group or "Send notification to event user" set**, or the whole Rule silently no-ops regardless of how correctly the Policy/Transport are configured. There's no error shown anywhere for this — it just never fires.
2. **The Event Matcher Policy's "App" field compares against `event.app`** (the Event object's own originating-subsystem field), **not** `event.context.model.app` (the app of the model that actually changed) — confirmed by reading Authentik's source (`authentik/policies/event_matcher/models.py`). A real user-deletion event never satisfies `event.app == "authentik_core"`, so a Policy with App set here always silently fails to match even when Action and Model are both correct. Fix: leave App blank.

**If this breaks again:** check `docker logs worker` on the Authentik host (the *worker* container specifically, not `server` — confirm the exact container name with `docker ps`, it's changed before). Structured JSON logs include a `policy_execution` entry per policy per event with a per-criterion pass/fail, which is the fastest way to see exactly which criterion is failing.

---

## Password Reset for Existing Users

Forced password reset was removed from the authentication flow. To reset a specific user's password:

1. Authentik admin panel → **Directory → Users → select user**
2. Click **Recovery Link**
3. Email the link to the user

New users set their password through the enrollment invitation flow — they never need a separate reset step.
