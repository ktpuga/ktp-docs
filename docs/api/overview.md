---
sidebar_position: 1
---

# Overview

The **KTP API** (`ktp-api`) is the backend for the KTP Georgia web platform. It's a Node.js/Express REST API that manages member profiles, events, photos, and provides protected data to the website and iOS app.

---

## Architecture

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js + Express |
| Database | PostgreSQL (raw SQL via `pg`, no ORM) |
| Auth | Authentik OIDC — JWT Bearer tokens (verified via JWKS) |
| Photos | Immich (deferred — `POST /photos` returns 501) |

**Internal address:** `http://10.0.0.53:4000` (LXC 119)  
**Public address:** `https://api2.ugaktp.com` (routed through Traefik on LXC 100)

The website (LXC 116) always hits the API via the internal address. The iOS app hits `https://api2.ugaktp.com`.

---

## Authentication

All protected routes require a valid **Authentik JWT** as a Bearer token in the `Authorization` header:

```
Authorization: Bearer <access_token>
```

The middleware (`middleware/auth.js`) validates the token by fetching the JWKS from Authentik:

```
AUTHENTIK_JWKS_URL=http://10.0.0.4:9000/application/o/ktpapp/jwks/
```

After verification, `req.user` is set to:

```js
{
  authentik_id: string,   // UUID — primary key in the DB
  username: string,
  groups: string[],       // e.g. ["active", "eboard"]
  authentik_pk: number    // Authentik's internal integer PK
}
```

Group-based access control (e.g., eboard-only routes) is enforced by additional middleware that checks `req.user.groups`.

---

## Database Schema

PostgreSQL database: `ugaktp_db` on LXC 118 (`10.0.0.54:5432`)

### `users` table

| Column | Type | Notes |
|--------|------|-------|
| `authentik_id` | `UUID PRIMARY KEY` | From Authentik JWT `sub` claim |
| `username` | `TEXT NOT NULL` | From Authentik — NOT UNIQUE |
| `authentik_pk` | `INTEGER` | Authentik's internal integer PK (for webhook deletion) |
| `first_name` | `TEXT` | |
| `last_name` | `TEXT` | |
| `preferred_name` | `TEXT` | |
| `dob` | `DATE` | |
| `major` | `TEXT` | |
| `graduation_date` | `TEXT` | Format: "Spring 2026" or "Fall 2026" |
| `phone` | `TEXT` | |
| `email` | `TEXT UNIQUE` | |
| `linkedin_url` | `TEXT` | |
| `pledge_class` | `TEXT` | e.g. "Alpha", "Beta" |
| `profile_picture_asset_id` | `TEXT` | Immich asset ID |
| `member_group` | `TEXT` | One of: `active`, `pledge`, `eboard`, `chair`, `alumni` |
| `profile_complete` | `BOOLEAN DEFAULT FALSE` | |
| `created_at` | `TIMESTAMPTZ` | |
| `updated_at` | `TIMESTAMPTZ` | Auto-updated by trigger |

> **Why `username` is not UNIQUE:** Authentik reuses usernames after deletion, and the webhook-based cleanup isn't yet reliable. The `authentik_id` UUID is the true unique identifier.

### `photos` table

| Column | Type | Notes |
|--------|------|-------|
| `immich_asset_id` | `TEXT NOT NULL` | |
| `title` | `TEXT` | Optional |
| `caption` | `TEXT` | Optional |
| `uploaded_by` | `UUID` | FK → `users(authentik_id)` ON DELETE SET NULL |

### `events` table

Standalone — no user FK. Full CRUD, no auth required.

---

## Environment Variables

Set in `/opt/ktp-api/.env` on LXC 119:

```env
DATABASE_URL=postgresql://root:<pass>@10.0.0.54:5432/ugaktp_db
AUTHENTIK_ISSUER=https://auth.ugaktp.com/application/o/ktpapp/
AUTHENTIK_JWKS_URL=http://10.0.0.4:9000/application/o/ktpapp/jwks/
WEBHOOK_SECRET=<hex32>
PORT=4000
NODE_ENV=production
```

> **Hairpin NAT:** The Docker container can't reach Authentik via the public domain. Use the internal IP (`http://10.0.0.4:9000`) for `AUTHENTIK_JWKS_URL`.

---

## Deployment

```bash
# On LXC 119
cd /opt/ktp-api
git pull
docker compose up --build -d
```

To initialize the database schema (first run only):

```bash
docker exec ktp-api node scripts/init-db.js
```

To access PostgreSQL directly (on LXC 118):

```bash
su - postgres
psql -d ugaktp_db
```
