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
| `member_group` | `TEXT` | One of: `active`, `pledge`, `eboard`, `chair`, `alumni` |
| `exec_title` | `TEXT` | Free-text eboard position ("President", "VP of Finance"). Display-only — not validated against `member_group`, though only ever shown for eboard |
| `is_test_account` | `BOOLEAN` | Hides the row from the public `/roster`, the member directory, **group chat member lists, and the DM conversation list**. Set manually; there's no UI for it |
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
| `content_id` | Loose `TEXT` reference, not a real FK — spans three different tables depending on `content_type`, so one FK column can't cover all of them. Integrity enforced in the application layer. `NULL` when `content_type = "user"`. All three referenced tables are `SERIAL`, so `createReport` requires a **positive integer** here and stores it as digits; the column stays `TEXT` because the three id spaces overlap and only `content_type` disambiguates them |
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
| `created_by` | → `users`. Needed because non-eboard users (committee chairs) can create events too, to check *which* committee they're allowed to scope one to |
| `requires_attendance` | Opt-in per event. Turning it on generates `attendance_token` the first time |
| `attendance_token` | Random, generated once and never regenerated. Never returned by the events endpoints — only by `GET /events/:id/attendance/code` |
| `attendance_finalized_at` | `TIMESTAMPTZ`. Null = the roster still re-syncs on every read; non-null = frozen. Set by the Finalize button, reversible. Returned on **every** event as `attendanceFinalizedAt` so the attendance rail can flag a past event nobody finalised |

:::warning Events and announcements scope to committees differently
`events.committee_ids` is an **array** — one event can belong to several committees. `announcements.committee_id` is a **single nullable ID**. They're not symmetrical; don't assume one shape when querying across both.
:::

**Permission logic** (`eventsController.checkEventPermission`): eboard can set any `audience`/`committeeIds` combination; a committee chair can only scope to committees they chair — every ID must be one of theirs — and can't set `audience`; anyone else is forbidden. `title`/`start_date`/`end_date` are validated server-side before touching the DB.

### `event_attendance` table

**The event's materialised roster**, not a log of marks: one row per *expected* attendee, written by `attendanceModel.syncRoster`, with `status` (`present` / `excused` / `absent`) left **null** until somebody accounts for that person. Also holds `checked_in_at`, `marked_by`, and the frozen `display_name` / `member_group`.

A **null `marked_by` means the member self-checked-in** by scanning the QR code; a populated one means an organizer set the status manually. Self check-in validates the rotating code and that the current time falls inside the check-in window, which opens 30 minutes before the event starts and closes 30 minutes after it ends.

:::warning `display_name` and `member_group` are frozen copies — don't "normalise" them away
They look like denormalised duplicates of `users`. They are the point of the table. **Pledges are initiated mid-semester**, so reading the group live would relabel — or silently drop — every pledge on every past event the day their class becomes active, rewriting history. `display_name` additionally keeps a record readable after the person deletes their account.

The migration's backfill left `member_group` **null** on pre-existing rows rather than stamping today's group: a wrong frozen group is worse than an admitted gap. Render those as "not recorded", not as a default.
:::

:::info Why the primary key is a surrogate `id`
`user_id` is `ON DELETE SET NULL`, so a deleted member's attendance survives under their frozen name — and a nullable column can't sit in a primary key. The old composite `(event_id, user_id)` PK became `id SERIAL` plus the unique index `event_attendance_event_user_idx`, which the upserts target and is therefore load-bearing rather than decorative. Postgres treats nulls as distinct in a unique index, so two deleted members on one event are two rows, not a conflict.
:::

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

## Input validation

There is **no validation library** — no zod, joi or express-validator, and that is a decision rather than an omission. The API is plain CommonJS with no TypeScript, so zod's main benefit (inferred static types) buys nothing, and the rules that have actually caught bugs here are domain rules a schema library would not have expressed any better. Columns are almost all bare `TEXT` with no `CHECK` constraints, so Postgres accepts anything too.

That is mostly fine for anything *rendered*, because React escapes a text node — a hostile string in someone's name or bio is inert. It is not fine for anything the database has to **parse**, which is where the shared primitives come in.

`services/validate.js` holds the pieces with no domain rule of their own. Each returns `{ value }` or `{ error }` and **never throws**, so a controller turns `error` straight into a 400.

| Helper | For |
|---|---|
| `intId` | A `SERIAL` primary key: digits only, 1 to int4's maximum |
| `uuid` | An `authentik_id`, canonical 8-4-4-4-12, lowercased |
| `boundedText` | Free text with a cap, rejecting or truncating per field |
| `enumValue` | Membership in a fixed set, compared exactly |
| `isoDate` | A timestamp, returned as a `Date` |
| `dateOnly` | A `DATE` column, returned as a **`YYYY-MM-DD` string** |
| `intIdArray`, `uuidArray` | Lists of the above, de-duplicated |

:::danger Ids are validated because of Postgres, not tidiness
A value that does not parse as its column's type does not become a bad row — it **aborts the statement**, and every controller here turns a thrown query into a `500`. Both codes were checked rather than assumed: `WHERE id = 'abc'` on an integer column is `22P02`, and `WHERE id = '2147483648'` is `22003`, so the range matters as much as the shape.

The shape test matches the literal text (`/^\d+$/`) **before** converting, because parse-then-inspect disagrees with Postgres: `Number("1e3")` is `1000` and `Number.isInteger` agrees it is an integer, but Postgres is handed the string and rejects it.

`intIdArray` and `uuidArray` **reject a bad entry rather than filtering it out.** They replaced a `.map(Number).filter(Number.isInteger)` idiom that silently dropped anything malformed, so a request naming five committees and one typo succeeded having applied four. That is the one failure mode a caller cannot detect for itself, because the response body describes what was saved rather than what was sent.

All five controller call sites now reject: `committee_ids` on group chat create and audience update and on meeting create, `interviewer_committee_ids` on interview schedule create and update, and `option_ids` on a poll vote. `test/idArrays.test.js` pins each one, including that a rejected request leaves the row untouched.

`visibility.js` was the sixth site. `parseAudience` is the **write-side** audience parser shared by album create, folder create and the three visibility-update routes, so one change covered five endpoints. It is the one where the old behaviour was actively unsafe rather than merely wrong: dropping an id from a **restriction** widens who can see the content, so restricting a folder to five committees and one typo returned `200` having restricted it to four. (The read side, `visibilityClause` and `canView`, was never involved.)

The uuid lists — `member_ids`, `invitee_ids`, `user_id`, `:userId` — failed the other way. Nothing was dropped; the value went through untouched into a `UUID` column, so a malformed id was `22P02` and a **`500`**, an input error reported as a server fault.
:::

### A 400 names the field it is about

The two profile routes (`PUT /users/me/profile` and `PUT /admin/users/:id/profile`, plus both username routes) return a **`field`** key alongside `message`:

```json
{ "message": "Phone number must have between 7 and 15 digits", "field": "phone" }
```

`normalizeProfileFields` always knew which rule failed and was discarding it, so the website could only show the message in a form-level banner. It now renders beside the input that caused it.

:::note Optional forever, not a contract
`field` is **absent** on anything that is not a single-field rejection — a 500, a fetch failure, a permission error. Both forms fall back to the banner when it is missing, because an error with nowhere to go must never be swallowed.

The addition is safe for existing clients: iOS decodes errors as `struct ErrorResponse { let message: String? }` and Swift's `JSONDecoder` ignores unknown keys, so no iOS change was needed. That was checked in the source rather than assumed.

The key is the **API's** field name, which is not always an input's name — `graduation_date` is one key but two inputs on the form. The website anchors its lookup on a `data-field` wrapper rather than an input `name`, so that case behaves like every other.
:::

### Text length caps

Every text column here is bare `TEXT`, so nothing failed loudly when titles and bodies went unbounded — which is why it went unnoticed. `services/textLimits.js` is the single table, mirrored on the website by `lib/text-limits.js`.

| Field | Cap |
|---|---|
| Titles, album names | 150 |
| Committee, folder and group chat names | 100 |
| Locations | 200 |
| Descriptions | 2000 |
| Announcement bodies | 5000 |
| Poll questions | 300 |
| Poll option labels / count | 150 / 20 |
| Document link names | 200 |
| Chat messages (DM and group) | 4000 |
| Reactions | 32 |

:::note These reject rather than truncate
The opposite of `about_me`, deliberately. Truncating is right when losing one field's tail beats discarding a whole multi-field save. It is wrong when the author is composing a single thing and looking at it, because nobody re-reads what they just published to check whether the last paragraph survived.

The reason to bound at all is mostly not security. An unbounded title is a wrecked layout on every card, list and push notification that renders the row, and it cannot be fixed from the UI that produced it. APNs caps the payload regardless, so the limit lands somewhere either way — better where the author is still on the page.

The website's `maxLength` attributes come from the mirrored table. That is a convenience and never the enforcement: `maxLength` is a DOM attribute a client can decline to send, so the API checks all of these itself.
:::

:::note Messages have their own number, and two rules the cap had to fit around
`MESSAGE` is 4000 rather than sharing `BODY` because the reasoning differs: this is the highest-volume write path, every message is re-sent through the sync envelope on each catch-up, and the first stretch of it becomes a push notification.

Two existing rules constrain where the check goes. A message may have **no body at all** if it carries an attachment, so the length rule is `required: false` and the either-or check remains the one that speaks. And the body is validated **before** `storeAttachment` runs, so a rejected message cannot leave an orphaned upload behind.

`REACTION` is 32 and is a **length** check, not an is-it-really-an-emoji check. `.length` counts UTF-16 code units and a ZWJ sequence like 👨‍👩‍👧‍👦 is already 11 of them before skin tone modifiers, so a tight cap would reject ordinary emoji. What had to stop was one member storing a novel per message, since reactions are aggregated into a JSON blob returned with **every** read of that conversation. Restricting the value to actual emoji is a separate decision about what a reaction is.
:::

:::warning `dateOnly` returns a string, and `isoDate` is the wrong tool for a `DATE` column
`users.dob` is the only one in the schema. node-pg serialises a `Date` with the server's local offset, so a date-only value written that way lands a day early anywhere west of UTC. Measured from a UTC-4 machine against Postgres 16, same column and same statement: `"2004-05-14"` stores `2004-05-14`, and `new Date("2004-05-14")` stores `2004-05-13`.

It is strict about spelling because the column is not: Postgres **accepts** `"20040514"`, `"5/14/2004"` (whose meaning depends on the server's `DateStyle`), `"2004-05-14T00:00:00Z"` and the year `99999`.

And the round trip through UTC is not decoration — **JavaScript rolls `2004-02-30` forward to March 1** rather than refusing it, so checking only `Number.isNaN(date.getTime())` accepts a date Postgres calls out of range and stores a different day than the one submitted.
:::

:::danger URLs are the exception, and `new URL()` is not a safety check
An `href` is a different trust context from a text node. `<a href={value}>` carrying `javascript:…` executes in the reader's session.

The trap: **`new URL("javascript:alert(1)")` parses perfectly happily**, because that is a syntactically valid URL. `documentsController.createLink` relied on exactly that — it wrapped `new URL()` in a try/catch and treated "it parsed" as "it's safe", so an eboard member could store a script URL that `PhotoFiles.jsx` then rendered as a clickable link for the whole chapter. Fixed 2026-08-05.

All user-supplied URLs now go through **`services/urls.js`**:

| Helper | Rule |
|---|---|
| `normalizeWebUrl(v)` | http(s) only, ≤300 chars, accepts scheme-less input |
| `normalizeLinkedinUrl(v)` | the above **plus** host must be `linkedin.com` or a real subdomain; a bare handle becomes `https://www.linkedin.com/in/<handle>` |

Two subtleties the tests pin down:

- **The scheme must be judged before parsing.** Prefixing an unknown scheme with `https://` and hoping the parse fails is not a check — `https://file:///etc/passwd` parses cleanly into host `file`, silently mangling the input into a valid-looking URL instead of rejecting it. Opaque schemes are caught by pattern first, hierarchical ones (`file://`, `ftp://`) by the protocol check after.
- **Host matching is exact-or-subdomain**, never a substring. `evil-linkedin.com` and `linkedin.com.evil.com` must both fail, and a `includes('linkedin.com')` waves both through.

Values are **canonicalised on write**, so what's in the database is already safe; the website's own `linkedinHref()` in `lib/portal-format.js` applies the same rule at render time as a backstop for rows written before this existed.

**If you add any field that becomes an `href`, route it through `services/urls.js`.**
:::

Three other conventions worth knowing:

- **`about_me` is truncated, not rejected** (600 chars) — losing the tail of a bio beats throwing away someone's whole profile save. `linkedin_url` is the opposite, rejected with a 400, because a mangled URL is a broken link rather than a shorter one. `boundedText` takes a `truncate` flag so this stays a per-field choice and never becomes a global rule.
- **Every other profile column rejects**, because each is something a person is found or addressed by, and half of one is the wrong answer rather than a shorter right one. Per-field rules: [`PUT /users/me/profile`](endpoints.md#put-usersmeprofile).
- **Audience/visibility values are allowlisted**, not denylisted — `parseAudience` rejects unknown groups rather than storing them.

Domain rules live beside the primitives rather than in them: `services/urls.js` (anything that becomes an `href`), `services/emails.js` (addresses and the UGA-domain rule), `services/usernames.js` (the one field that is also a login credential), and `services/profileFields.js`, which composes the lot into the **single normalizer shared by the member's own profile route and the eboard "edit anyone" route** — identical validation on two routes is exactly the kind of thing that drifts, and the hole would end up on the route with more authority.

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
