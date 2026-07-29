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
| `exec_title` | `TEXT` | Free-text eboard position ("President", "VP of Finance"). Display-only — not validated against `member_group`, though only ever shown for eboard |
| `is_test_account` | `BOOLEAN` | Excludes the row from the public `/roster`. Set manually; there's no UI for it |
| `profile_complete` | `BOOLEAN DEFAULT FALSE` | |
| `deleted_at` | `TIMESTAMPTZ` | Set by self-service `DELETE /users/me` (anonymize, not hard-delete — see below). `NULL` for every active member |
| `created_at` | `TIMESTAMPTZ` | |
| `updated_at` | `TIMESTAMPTZ` | Auto-updated by trigger |

**Self-service account deletion (`DELETE /users/me`) anonymizes in place** rather than removing the row: every PII field gets nulled out, `member_group` is cleared, `profile_complete` resets to `false`, and `deleted_at` is stamped. Their messages, photos, and committee history stay attached to the (now-anonymized) row so other members' conversations and albums aren't broken by a deleted user disappearing mid-thread. This is deliberately distinct from the Authentik deletion webhook above — that one still hard-deletes the row when eboard removes someone from Authentik entirely. Self-service deletion never touches Authentik itself; that stays an eboard-owned action.

### `user_blocks` table

One-directional: `blocker_id` has blocked `blocked_id`. Composite PK, both columns FK → `users`. Checked both directions when starting a new DM (either party having blocked the other is enough to stop it) but only the blocker's own direction is used to filter what they see in their own message/conversation views.

### `reports` table

| Column | Notes |
|--------|-------|
| `reporter_id`, `reported_user_id` | FK → `users` |
| `content_type` | `user` \| `message` \| `group_message` \| `photo` |
| `content_id` | Loose `TEXT` reference, not a real FK — spans three different tables depending on `content_type`, so one FK column can't cover all of them. Integrity enforced in the application layer. `NULL` when `content_type = "user"` |
| `reason`, `explanation` | |
| `status` | `open` \| `resolved` \| `dismissed` |
| `moderator_response`, `resolved_by`, `resolved_at` | Set together whenever status moves away from `open` |

> **Why `username` is not UNIQUE:** Authentik reuses usernames after deletion, and the webhook-based cleanup isn't yet reliable. The `authentik_id` UUID is the true unique identifier.

### Photos & albums

Member-facing photos are always members-only — there is no public/private flag per row anymore. Public content lives entirely in a separate table (`homepage_photos`, below).

| Table | Purpose |
|-------|---------|
| `albums` | Eboard-created named albums (e.g. "Spring Retreat 2026"). `created_by` → `users`. |
| `photos` | `immich_asset_id`, `album_id` (nullable FK → `albums`; `NULL` = the general "Shared Album"), `title`, `caption`, `media_type` (`image`/`video`), `uploaded_by` → `users`. |

Any member in `active`/`chair`/`alumni`/`eboard`/`pledge` (the full list lives in `constants.js` as `SHARED_ALBUM_GROUPS`, reused across every member-facing feature below) can upload/view. The uploader can always delete their own photo; **eboard can delete any photo in any album**, including the general Shared Album — a real moderation power (this was previously scoped to only albums an eboard member personally created; broadened so a reported photo can actually be removed by whoever reviews it).

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
| `documents` | `folder_id` (nullable — `NULL` = top level), `filename` (original name shown to users), `kind` (`file` \| `link`), `storage_path`/`mime_type`/`file_size` (only for `kind = "file"`, never exposed to clients as a raw path), `url` (only for `kind = "link"`), `uploaded_by` |

A "document" can now be an external hyperlink (Google Docs/Slides/Sheets, or any URL) instead of an uploaded file — same folder tree, same eboard-write permissions, just no file on disk. `storage_path` is nullable to allow for this. View: any shared-album-group member. Writes (folders, files, and links alike): eboard only. Deleting a folder cascades its DB rows *and* walks a recursive query to delete every nested file from disk too (link rows have nothing on disk to clean up) — disk space on the API's LXC is limited, so orphaned files aren't left behind.

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

**Safety layer on both `direct_messages` and `group_chat_messages` sends:** a basic content filter (`services/contentFilter.js`, wraps the npm package `bad-words` — **pinned to `^3.0.4`**, v4 ships broken CJS/ESM packaging that fails `require()` in this project, confirmed while wiring this up) rejects flagged message bodies with `400`. An in-memory fixed-window rate limiter (`middleware/rateLimit.js`, no Redis — single process is fine at this chapter's scale) caps sends at 20/minute/user, returning `429` over the limit. See `user_blocks` above for how blocking additionally filters what a caller sees.

### `events` table

Gained several columns beyond the original bare title/date/location shape:

| Column | Notes |
|--------|-------|
| `location` | Plain text |
| `audience` | `TEXT[]`, same shape/semantics as `announcements.audience` above — `NULL`/empty = public |
| `committee_ids` | `INTEGER[]` — scopes the event to one *or more* committees' members instead of (not combined with) `audience` |
| `calendly_url` | Optional group booking/RSVP link — distinct from a user's personal `calendly_url` on their profile |
| `created_by` | → `users`. Needed because non-eboard users (committee chairs) can create events too, to check *which* committee they're allowed to scope one to |
| `requires_attendance` | Opt-in per event. Turning it on generates `attendance_token` the first time |
| `attendance_token` | Random, generated once and never regenerated. Never returned by the events endpoints — only by `GET /events/:id/attendance/code` |

:::warning Events and announcements scope to committees differently
`events.committee_ids` is an **array** — one event can belong to several committees. `announcements.committee_id` is a **single nullable ID**. They're not symmetrical; don't assume one shape when querying across both.
:::

**Permission logic** (`eventsController.checkEventPermission`): eboard can set any `audience`/`committeeIds` combination; a committee chair can only scope to committees they chair — every ID must be one of theirs — and can't set `audience`; anyone else is forbidden. `title`/`start_date`/`end_date` are validated server-side before touching the DB.

### `event_attendance` table

One row per member per event they have an attendance record for, holding `status` (`present` / `excused` / `absent`), `checked_in_at`, and `marked_by`.

A **null `marked_by` means the member self-checked-in** by scanning the QR code; a populated one means an organizer set the status manually. Self check-in validates the token and that the current time falls inside the event window plus a 30-minute grace period.

### `push_devices` / `notification_preferences` / `notification_delivery_log`

Backs iOS push notifications. `push_devices` holds APNs tokens per user (private to their owner, never returned by any list endpoint); `notification_preferences` holds the two per-user booleans (`direct_messages_enabled`, `events_enabled`, both defaulting true); `notification_delivery_log` records send attempts.

APNs credentials come from environment variables only — the API never reads a `.p8` file from disk. Delivery failures are logged and never fail the underlying message or event write.

### `ios_homepage_slides` table

The in-app slideshow, separate from `homepage_photos` (which is the website's public gallery). Carries title/alt text/subtitle, an optional HTTPS link and label, `is_active`, and optional `starts_at`/`ends_at` for scheduling. A slide is visible only when active and inside its window; max 10 active at once.

### `polls` / `poll_options` / `poll_votes` tables

Same targeting shape as `events`/`announcements` (`audience TEXT[]` + `committee_id`, mutually exclusive).

| Table | Purpose |
|-------|---------|
| `polls` | `question`, `description`, `audience`, `committee_id`, `multi_select` (single- vs multi-choice), `is_closed` (manual toggle), `expires_at` (optional scheduled close), `created_by` |
| `poll_options` | `poll_id`, `label`, `display_order` |
| `poll_votes` | Composite PK (`poll_id`, `option_id`, `user_id`) — one row per selected option. Voting again `DELETE`s the caller's prior rows for that poll first, then inserts the new selection — handles "change my vote" and single-vs-multi-select enforcement (the controller limits how many ids get passed) with the same code path. |

**`expires_at` is resolved at read time, not by a cron job**: `pollModel.toPollJSON` computes the "effective" `is_closed` as `is_closed OR (expires_at IS NOT NULL AND expires_at <= NOW())` on every request. No background worker needed, and it can't drift out of sync with the real clock — the tradeoff is every read re-checks the current time rather than trusting a stored flag.

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

`refresh.sh` handles the whole deploy in one step: stops the container, pulls latest, rebuilds and restarts, then runs pending schema migrations (`npm run migrate:up`, via [node-pg-migrate](https://github.com/salsita/node-pg-migrate) — safe to re-run any time, tracked in a `pgmigrations` table). Earlier versions of this doc had the script ending with a reminder to apply Postgres grants manually — that's no longer necessary (see below), so ignore that reminder if an older `refresh.sh` still prints it.

**Adding a new schema change:** `npm run migrate:create -- <name>`, write idempotent SQL in the generated file's `-- Up Migration` section, then `npm run migrate:up`. There's no rollback path (`-- Down Migration` stays empty) — hasn't been needed.

### Postgres grants — no longer needed (fixed 2026-07-10)

New tables used to need a manual `GRANT ALL PRIVILEGES ON TABLE <table> TO root;` (plus the sequence, for `SERIAL` ids) after almost every migration, since whoever ran it might be connected as a different Postgres role than `root` (what `DATABASE_URL` connects as) — skipping it produced `permission denied for table <name>` (error 42501) the first time anyone hit the new feature. `root` now has permissions on new tables regardless of which role creates them, so this manual step is gone. If a 42501 ever shows up again, treat it as a new problem worth investigating, not this old known issue.

To access PostgreSQL directly (on LXC 118), if ever needed for something else:

```bash
su - postgres
psql -d ugaktp_db
```
