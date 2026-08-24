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
| Photos & video | Immich — fully integrated |
| Documents | ktp-api's own disk (`uploads/documents/`), not Immich — arbitrary file types |

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
| `calendly_url` | `TEXT` | Personal Calendly link (1-on-1 booking, e.g. coffee chats) — separate from the event-level `calendly_url` below, which is for group booking |
| `member_group` | `TEXT` | One of: `active`, `pledge`, `eboard`, `chair`, `alumni` |
| `profile_complete` | `BOOLEAN DEFAULT FALSE` | |
| `created_at` | `TIMESTAMPTZ` | |
| `updated_at` | `TIMESTAMPTZ` | Auto-updated by trigger |

> **Why `username` is not UNIQUE:** Authentik reuses usernames after deletion, and the webhook-based cleanup isn't yet reliable. The `authentik_id` UUID is the true unique identifier.

### Photos & albums

Member-facing photos are always members-only — there is no public/private flag per row anymore. Public content lives entirely in a separate table (`homepage_photos`, below).

| Table | Purpose |
|-------|---------|
| `albums` | Eboard-created named albums (e.g. "Spring Retreat 2026"). `created_by` → `users`. |
| `photos` | `immich_asset_id`, `album_id` (nullable FK → `albums`; `NULL` = the general "Shared Album"), `title`, `caption`, `media_type` (`image`/`video`), `uploaded_by` → `users`. |

Any member in `active`/`chair`/`alumni`/`eboard`/`pledge` (the full list lives in `constants.js` as `SHARED_ALBUM_GROUPS`, reused across every member-facing feature below) can upload/view. The uploader can always delete their own photo; an eboard member can additionally delete any photo inside an album *they personally created* (moderation, not blanket access to every album).

### `homepage_photos` table

The **public** chapter gallery shown on the actual homepage — a completely separate system from the member photos above, different audience and permission model. No auth on reads. Writes are eboard-only. Deleting a row only unlists it from the gallery — it deliberately does not delete the underlying Immich asset, since a registered asset might be reused elsewhere.

| Column | Notes |
|--------|-------|
| `immich_asset_id`, `title`, `caption`, `media_type` | Same shape as `photos` |
| `display_order` | Controls gallery ordering (eboard can reorder) |
| `added_by` | FK → `users` |

### Documents (`document_folders` / `documents`)

An eboard-managed file library (bylaws, meeting minutes, course files, etc.) shown in the Files & Photos portal tab alongside photos. Deliberately **not** Immich — these are arbitrary file types, stored directly on ktp-api's own disk at `uploads/documents/` (bind-mounted in `docker-compose.yml` so uploads survive container rebuilds).

| Table | Purpose |
|-------|---------|
| `document_folders` | `name`, `parent_id` (self-referencing FK — folders nest to any depth; `NULL` = top level), `created_by` |
| `documents` | `folder_id` (nullable — `NULL` = top level), `filename` (original name shown to users), `storage_path` (actual disk path, never exposed to clients), `mime_type`, `file_size`, `uploaded_by` |

View: any shared-album-group member. Writes (folders and files alike): eboard only. Deleting a folder cascades its DB rows *and* walks a recursive query to delete every nested file from disk too — disk space on the API's LXC is limited, so orphaned files aren't left behind.

### `committees` / `committee_members` tables

DB-only membership — no Authentik group per committee (unlike the coarse, stable groups that drive portal routing, committees are fine-grained and change often: self-join/leave, dynamic chair reassignment).

| Table | Purpose |
|-------|---------|
| `committees` | `name`, `created_by` → `users`, `group_chat_id` → `group_chats` (every committee gets its own linked group chat, created alongside it). |
| `committee_members` | Composite PK (`committee_id`, `user_id`). `role` — `member` (self-service join/leave) or `chair` (eboard-only promote/demote). |

Anyone can self-join/leave a committee as `member`; only eboard can promote/demote someone to `chair`. Joining or leaving a committee automatically adds/removes you from its linked group chat too — no separate action needed. A chair can create events scoped to their own committee (see `events` below), but can't set an `audience` — a chair's event is implicitly scoped to their committee's members.

### Messaging (`announcements` / `direct_messages` / `group_chats` + friends)

Four distinct systems, not one generic "messages" table:

| Table | Purpose |
|-------|---------|
| `announcements` | Eboard-only, one-way broadcast. `audience` is a `TEXT[]` — `NULL`/empty means everyone in `SHARED_ALBUM_GROUPS`, otherwise any combination of groups (array-overlap match against the caller's groups). Can alternatively be scoped to one `committee_id` instead of `audience`. Eboard sees every announcement regardless of targeting (they're the ones doing the targeting and need to manage all of it); everyone else only sees what applies to them. |
| `direct_messages` | Any member ↔ any member. No separate "conversation" row — a thread is just every row where `(sender_id, recipient_id)` matches that pair in either direction. `read_at` tracks per-message read state. |
| `group_chats` | Named, with an assigned member list (`group_chat_members`, a plain junction table) — access is gated by actual DB membership rows, not a broad Authentik group. Three ways a chat gets created: eboard makes one directly (and can add/remove members any time), a committee gets one automatically (membership mirrors the committee), or the singleton **eboard chat** (`is_eboard_chat` flag) is lazily created on first eboard login and reconciled against the `eboard` Authentik group on every login — no "join eboard" action to hook, so it self-heals on login instead. |
| `group_chat_messages` | Messages within a `group_chats` thread. |
| `group_chat_reads` | Per-user "last read" marker per group chat — a single message can be read by many different members at different times, so (unlike `direct_messages`) read state can't live on the message row itself. |

### `events` table

Gained several columns beyond the original bare title/date/location shape:

| Column | Notes |
|--------|-------|
| `location` | Plain text |
| `audience` | `TEXT[]`, same shape/semantics as `announcements.audience` above — `NULL`/empty = public |
| `committee_id` | Scopes the event to one committee's members instead of (not combined with) `audience` |
| `calendly_url` | Optional group booking/RSVP link — distinct from a user's personal `calendly_url` on their profile |
| `created_by` | → `users`. Needed because non-eboard users (committee chairs) can create events too, to check *which* committee they're allowed to scope one to |

**Permission logic** (`eventsController.checkEventPermission`): eboard can set any `audience`/`committee_id` combination; a committee chair can only scope to a committee they chair, and can't set `audience`; anyone else is forbidden. `title`/`start_date`/`end_date` are validated server-side before touching the DB.

---

## Eboard: changing a member's group

`PUT /admin/users/:authentikId/group` (eboard only) lets eboard move a member between groups directly from the website's `/admin/users` page, instead of going into Authentik's own UI. Unlike the webhook above (which reacts to Authentik-side changes after the fact — and got stuck on group-change events not reliably carrying the affected user's pk), this endpoint **drives** Authentik: it already knows the exact user and target group from the request, so it calls Authentik's own REST API (`services/authentikAdmin.js`) to move the user between groups there first, then mirrors the result into `users.member_group` immediately — no waiting for the member's next login. Authentik stays the source of truth throughout.

Requires a dedicated Authentik service account (`ktp-api-service`) with a Role granting object-level `add_user_to_group`/`remove_user_from_group`/`view_group` permissions on each of the five role groups individually, plus a global `view_user` permission — see [Authentik: API Tokens / Service Accounts](../authentik/overview.md#api-tokens--service-accounts) for the full setup.

---

## Environment Variables

Set in `/opt/ktp-api/.env` on LXC 119:

```env
DATABASE_URL=postgresql://root:<pass>@10.0.0.54:5432/ugaktp_db
AUTHENTIK_ISSUER=https://auth.ugaktp.com/application/o/ktpapp/
AUTHENTIK_JWKS_URL=http://10.0.0.4:9000/application/o/ktpapp/jwks/
WEBHOOK_SECRET=<hex32>
AUTHENTIK_API_TOKEN=<service account token, see Authentik docs>
AUTHENTIK_API_URL=https://auth.ugaktp.com
IMMICH_URL=http://10.0.0.3:2283
IMMICH_API_KEY=<scoped to asset upload/read/delete only>
PORT=4000
NODE_ENV=production
```

> **Hairpin NAT:** The Docker container can't reach Authentik via the public domain. Use the internal IP (`http://10.0.0.4:9000`) for `AUTHENTIK_JWKS_URL`, and the same internal IP for `AUTHENTIK_API_URL` if the public hostname turns out to be unreachable from inside the LAN too.

---

## Deployment

```bash
# On LXC 119
cd /opt/ktp-api
./refresh.sh
```

`refresh.sh` handles the whole deploy in one step: stops the container, pulls latest, rebuilds and restarts, then runs pending schema migrations (`npm run migrate:up`, via [node-pg-migrate](https://github.com/salsita/node-pg-migrate) — safe to re-run any time, tracked in a `pgmigrations` table). It ends by printing a reminder that Postgres grants still need to be applied manually — that step has to happen on LXC 118, which the script (running on LXC 119) can't reach into.

**Adding a new schema change:** `npm run migrate:create -- <name>`, write idempotent SQL in the generated file's `-- Up Migration` section, then `npm run migrate:up`. There's no rollback path (`-- Down Migration` stays empty) — hasn't been needed.

### Granting `root` access to any newly-created tables

Whenever a migration adds new tables (which has happened a lot — albums, homepage_photos, documents, messages, announcements, group chats, committees), this has bitten almost every migration on this project, since whoever runs it may be connected as a different Postgres role than `root` (what `DATABASE_URL` connects as):

```sql
GRANT ALL PRIVILEGES ON TABLE <new_table> TO root;
GRANT ALL PRIVILEGES ON SEQUENCE <new_table>_id_seq TO root;  -- only for tables with a SERIAL id; skip for junction tables with composite PKs (e.g. group_chat_members)
```

Skipping this step produces `permission denied for table <name>` (Postgres error 42501) the first time anyone hits the new feature.

To access PostgreSQL directly (on LXC 118):

```bash
su - postgres
psql -d ugaktp_db
```
