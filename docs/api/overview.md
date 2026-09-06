---
sidebar_position: 1
---

# Overview

The KTP API (`ktp-api`) serves the chapter website and iOS app. It is a Node.js/Express REST API for profiles, events, attendance, messaging, media, and other chapter records. See [API Endpoints](./endpoints.md) for request and response details.

## Architecture

| Layer | Technology |
| --- | --- |
| Runtime | Node.js and Express |
| Database | PostgreSQL, queried through `pg` without an ORM |
| Authentication | Authentik OIDC bearer tokens, verified against JWKS |
| Photos and video | Immich |
| Documents | Files on the API server under `uploads/documents/` |

Documented deployment addresses:

- Internal API: `http://10.0.0.53:4000` on LXC 119.
- Public API: `https://api2.ugaktp.com`, routed through Traefik on LXC 100.
- Website: LXC 116, configured to call the internal API.
- iOS: calls the public API.

## Authentication

Protected routes require an Authentik access token:

```text
Authorization: Bearer <access_token>
```

`middleware/auth.js` uses `jose` to verify the signature, issuer, and applicable token time claims. It supports separate website and iOS providers through `AUTHENTIK_ISSUER` / `AUTHENTIK_JWKS_URL` and `AUTHENTIK_IOS_ISSUER` / `AUTHENTIK_IOS_JWKS_URL`.

For the website provider, the documented internal JWKS URL is:

```text
http://10.0.0.4:9000/application/o/ktpapp/jwks/
```

After verification, the middleware builds `req.user`:

```ts
{
  authentik_id: string;
  username: string;
  groups: string[];
  group_defaulted: boolean;
  authentik_pk: number | null;
  email: string | null;
}
```

`authentik_id` comes from `sub`. The username falls back to `sub` when `preferred_username` is absent. The email is a token claim, not proof that the address has been verified.

Eboard and chair membership imply `active` in the request's group list. If no recognized role group is present, the middleware adds `rush` and sets `group_defaulted: true`. User synchronization checks this flag so a fallback does not overwrite a known stored role.

Route middleware checks broad group access. Controllers and models also check ownership, committee membership, and content visibility where needed. Committee membership comes from Postgres, not the token.

## Database Schema

The application database is `ugaktp_db` on LXC 118 at `10.0.0.54:5432`. The tables below describe the main records; migrations define the complete schema.

### `users` table

| Column | Type | Notes |
| --- | --- | --- |
| `authentik_id` | `UUID PRIMARY KEY` | Authentik JWT `sub` |
| `username` | `TEXT NOT NULL` | Not unique in this database |
| `authentik_pk` | `INTEGER` | Authentik's integer ID, used by the deletion webhook |
| `first_name`, `last_name`, `preferred_name` | `TEXT` | Profile names |
| `dob` | `DATE` | Date of birth |
| `major` | `TEXT` | |
| `graduation_date` | `TEXT` | Season and year, such as `Spring 2026` |
| `phone` | `TEXT` | |
| `email` | `TEXT UNIQUE` | |
| `linkedin_url` | `TEXT` | |
| `pledge_class` | `TEXT` | For example, `Alpha` |
| `profile_picture_asset_id` | `TEXT` | Immich asset reference |
| `member_group` | `TEXT` | `eboard`, `chair`, `active`, `alumni`, `pledge`, or `rush` |
| `exec_role_id` | `INTEGER REFERENCES exec_roles(id) ON DELETE SET NULL` | Assigned eboard position |
| `exec_title` | `TEXT` | Display label copied from the role, or legacy unmatched text |
| `is_test_account` | `BOOLEAN` | Excludes QA accounts from public/member listings and messaging participant lists; managed without a UI |
| `profile_complete` | `BOOLEAN DEFAULT FALSE` | |
| `deleted_at` | `TIMESTAMPTZ` | Set by self-service account deletion |
| `created_at` | `TIMESTAMPTZ` | |
| `updated_at` | `TIMESTAMPTZ` | Updated by a trigger |

Use `authentik_id` for identity. Authentik can reuse a username after deleting an account, so username uniqueness is not enforced here.

`DELETE /users/me` anonymizes the account in place, clears profile data and `member_group`, resets `profile_complete`, and records `deleted_at`. Messages, photos, and committee references remain attached to the row. This operation does not delete the Authentik account. Deleting the account in Authentik instead triggers a webhook that removes the application user row.

### `user_blocks` table

`blocker_id` and `blocked_id` form a composite primary key and both reference `users`.

Message sends check both directions: either party's block prevents a direct message. Read filtering uses the caller's own blocks to hide the blocked person's messages and conversations.

### `reports` table

| Column | Notes |
| --- | --- |
| `reporter_id`, `reported_user_id` | References to `users`; anonymous reports leave `reporter_id` null |
| `content_type` | `user`, `message`, `group_message`, or `photo` |
| `content_id` | Text reference interpreted alongside `content_type`; not a foreign key |
| `reason`, `explanation` | Report details |
| `status` | `open`, `resolved`, or `dismissed` |
| `moderator_response`, `resolved_by`, `resolved_at` | Moderation outcome |

For content reports, `createReport` requires a positive int4-range ID and stores its digits in `content_id`. User reports omit that field and identify the subject through `reported_user_id`. Shape validation does not establish that the reported content exists or belongs to the supplied user.

Eboard and members of the committee with `slug = 'judicial'` can review and update reports. The chair group alone does not grant access. See [Reports & Moderation](./endpoints.md#reports--moderation).

### Photos & albums

Member photos and the public gallery use separate tables.

| Table | Purpose |
| --- | --- |
| `albums` | Named albums with `created_by` and visibility settings |
| `photos` | `immich_asset_id`, optional `album_id`, `title`, `caption`, `media_type`, and `uploaded_by` |

A null `album_id` places a photo in the general Shared Album. `SHARED_ALBUM_GROUPS` allows `active`, `chair`, `alumni`, `eboard`, and `pledge` to use the member photo routes, subject to album visibility. Uploaders can delete their photos; eboard can delete any photo.

### `homepage_photos` table

The public chapter gallery allows unauthenticated reads and eboard-only writes. Removing a row unlists the photo without deleting its Immich asset, which may be used elsewhere.

| Column | Notes |
| --- | --- |
| `immich_asset_id`, `title`, `caption`, `media_type` | Media and display fields |
| `display_order` | Gallery order |
| `added_by` | Reference to `users` |

### Documents (`document_folders` / `documents`)

The Files & Photos library stores uploaded files under `uploads/documents/` on the API server. The Docker volume preserves them across container rebuilds. Link entries use the same folder structure without a disk file.

| Table | Purpose |
| --- | --- |
| `document_folders` | `name`, optional self-referencing `parent_id`, `created_by`, and visibility settings |
| `documents` | Optional `folder_id`, `filename`, `kind` (`file` or `link`), `uploaded_by`, and visibility settings |
| File-specific fields | `storage_path`, `mime_type`, `file_size` |
| Link-specific field | `url` |

Null folder or parent IDs mean the top level. Raw storage paths are not exposed to clients.

Shared-album-group members can read accessible documents. Eboard, chairs, active members, and alumni can upload, add links, create unrestricted folders, and manage their own documents. Chairs and eboard can move items and rename other members' documents. Only eboard can set visibility, delete folders, or delete other members' documents.

Folder deletion removes the database subtree and nested files from disk. Document access may inherit folder visibility or use an explicit document override; see [Documents](./endpoints.md#documents) for the direct-download rules.

### `exec_roles` table

Migration `1790300000000` introduced stored eboard positions.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `SERIAL PRIMARY KEY` | Referenced by `users.exec_role_id` |
| `slug` | `TEXT NOT NULL UNIQUE` | Derived at creation and retained on rename |
| `label` | `TEXT NOT NULL` | Editable display name |
| `sort_order` | `INTEGER NOT NULL DEFAULT 0` | Picker order |
| `is_active` | `BOOLEAN NOT NULL DEFAULT TRUE` | Retired roles remain assigned but leave the default picker |

Use a stable slug when code needs to identify a position. Labels can change without changing that identity.

Role assignment writes both `users.exec_role_id` and its display copy, `users.exec_title`. Renaming through `execRoleModel.update` updates holders' copied titles too. The legacy `exec-title` endpoint can still edit unmatched free text; use `exec-role` for new assignments.

Deleting an assigned role returns `409`. Set `is_active = false` to retire it while preserving assignments. The migration retains unmatched `exec_title` values so eboard can resolve them later.

### `committees` / `committee_members` tables

Committee membership lives in Postgres and is independent of Authentik role groups.

| Table | Purpose |
| --- | --- |
| `committees` | Committee name, stable slug where assigned, and creator |
| `committee_members` | Composite primary key (`committee_id`, `user_id`) and `role` (`member` or `chair`) |

Eligible members can request to join or leave a committee. Join requests require approval by eboard or that committee's chair before membership is added. Eboard assigns chairs.

Committees do not own automatically created chats. A group chat can name committees in `committee_ids` and derive membership from them when read. See [Committees](./endpoints.md#committees) for join and approval behavior.

### Messaging (`announcements` / `direct_messages` / `group_chats` + friends)

| Table | Purpose |
| --- | --- |
| `announcements` | One-way posts with `audience TEXT[]` and an optional `committee_id` |
| `direct_messages` | Two-person threads identified by sender/recipient pairs; `read_at` tracks read state |
| `group_chats` | Official or member-created chats, with explicit or audience/committee-derived membership |
| `group_chat_members` | Explicit chat membership |
| `group_chat_messages` | Messages within a chat |
| `group_chat_reads` | Per-user read marker for a chat |

Eboard and chairs can create announcements, subject to targeting permissions. Eboard sees all announcements; other callers see posts matching their access. Untargeted posts are for member groups, not rushees.

Direct messages do not need a separate conversation row. Rushee conversations have an additional leadership restriction through `RUSH_DM_GROUPS`. Group chat access depends on membership in that chat.

Official chats are administered by eboard. Member-created chats are administered by their creator, but creation is currently disabled. The former automatically synced Eboard chat has been removed.

Direct and group sends use an in-memory limit of 20 messages per minute per user and return `429` above it. Blocks also affect sends and reads as described above. See [Messaging endpoints](./endpoints.md#messages-direct-messages).

### `events` table

| Column | Notes |
| --- | --- |
| `location` | Plain text |
| `audience` | `TEXT[]` of target groups |
| `committee_ids` | `INTEGER[]` of target committees |
| `created_by` | Reference to the creator in `users` |
| `requires_attendance` | Enables attendance tracking |
| `attendance_token` | Stored HMAC secret used to derive rotating check-in codes; never returned to clients |
| `attendance_finalized_at` | Null while the roster can sync; timestamp when finalized, returned as `attendanceFinalizedAt` |

An event without audience or committee targeting is visible to member groups, not the unauthenticated public or rushees. Targeted reads match group or committee membership. Events accept multiple committee IDs; announcements use one nullable `committee_id`.

`checkEventCreate` permits eboard and chairs to create events. Chairs may create chapter-wide or audience-targeted events, but any named committees must be ones they chair. `checkEventMutate` permits eboard, the creator, or a chair of an owning committee to edit or delete. Updates check the stored event and the requested targeting. Title and start/end dates are validated before database writes.

`GET /events/:id/attendance/code` returns a derived code, its expiry, and the rotation period. It does not return `attendance_token`. Codes rotate every 10 seconds, and check-in accepts the current or previous bucket.

### `event_attendance` table

The event roster stores expected attendees and can also record self-check-ins from outside the target audience. Rows have a nullable `status` (`present`, `excused`, or `absent`), `checked_in_at`, `marked_by`, and saved `display_name` and `member_group` values.

A recorded self-check-in has no `marked_by` organizer; manual marks identify the organizer. A null `marked_by` alone does not establish attendance because unmarked roster rows can also be null.

Self-check-in requires a valid rotating code and an open window, from 30 minutes before the event starts to 30 minutes after it ends.

Saved names and groups preserve the event's history when a member changes group or deletes their account. Historical rows whose group was not captured retain null; display that as "not recorded."

The primary key is `id SERIAL`. `user_id` uses `ON DELETE SET NULL`, and `event_attendance_event_user_idx` enforces uniqueness for an event/user pair and supports upserts. Multiple deleted users can remain as separate rows because null values do not conflict in that index.

### `push_devices` / `notification_preferences` / `notification_delivery_log`

`push_devices` stores private APNs tokens, and `notification_delivery_log` records delivery attempts. Preferences default to true for seven fields:

`direct_messages_enabled`, `announcements_enabled`, `polls_enabled`, `meetings_enabled`, `events_enabled`, `event_reminders_enabled`, and `email_enabled`.

APNs credentials come from environment variables. Delivery failures are logged without failing the underlying message or event write. See [Notifications](./endpoints.md#notifications) for email, reminders, and website badge counts.

### `contact_sheet_rows` table

CSV import replaces the chapter contact sheet in full. `row_index` preserves spreadsheet order. Imported data fields are text so values such as `May 2027` or `Graduated/Working` can be retained.

The former account-matching table, `contact_sheet_links`, was removed by migration `1790500000000`. Use new migrations for changes to an already deployed schema; editing an applied migration does not cause it to run again.

### `ios_homepage_slides` table

The authenticated iOS slideshow is separate from the public gallery. Rows include title, alt text, subtitle, optional HTTPS link and label, `is_active`, and optional start/end times. A slide must be active and within its schedule to appear. At most 10 slides can be active.

### `polls` / `poll_options` / `poll_votes` tables

| Table | Purpose |
| --- | --- |
| `polls` | Question, description, audience, optional single `committee_id`, `multi_select`, `is_closed`, `expires_at`, and creator |
| `poll_options` | `poll_id`, label, and display order |
| `poll_votes` | Composite primary key (`poll_id`, `option_id`, `user_id`); one row per selected option |

A new vote replaces the caller's previous selections for that poll. The controller enforces single- or multiple-choice limits.

`pollModel.toPollJSON` calculates closure from the stored `is_closed` flag or an elapsed `expires_at`. Scheduled closure is evaluated on reads and does not require a background job.

## Input validation

The API uses shared validation functions in CommonJS modules. Controllers validate requests before sending values to Postgres, including fields stored in permissive `TEXT` columns.

`services/validate.js` returns `{ value }` or `{ error }` for invalid input so controllers can return `400` without relying on database exceptions.

| Helper | Purpose |
| --- | --- |
| `intId` | Digits-only integer ID from 1 through the int4 maximum |
| `uuid` | Canonical 8-4-4-4-12 UUID, lowercased |
| `boundedText` | Text length checks with per-field rejection or truncation |
| `enumValue` | Exact match against an allowed set |
| `isoDate` | Timestamp returned as a `Date` |
| `dateOnly` | Calendar date returned as a `YYYY-MM-DD` string |
| `intIdArray`, `uuidArray` | Validated, deduplicated ID arrays |

Validate ID text before numeric conversion. `Number("1e3")` accepts a spelling that is not valid integer input for these endpoints. Invalid integer syntax can produce Postgres `22P02`; an out-of-range integer can produce `22003`.

Array validators reject the entire list if any entry is invalid. Filtering out bad entries would apply a different selection from the one requested. Audience and visibility parsers also reject unknown groups and malformed committee IDs. `test/idArrays.test.js` covers rejection and preservation of existing data.

### Field-specific errors {#a-400-names-the-field-it-is-about}

Profile and username validation can return a `field` alongside `message`:

```json
{ "message": "Phone number must have between 7 and 15 digits", "field": "phone" }
```

Clients can show these errors next to the corresponding field. Errors without a field, such as permission or server failures, still need a form-level message.

The field name is the API key. The website uses a `data-field` wrapper so one key, such as `graduation_date`, can identify a group of inputs.

### Text length caps

`services/textLimits.js` defines API limits, mirrored in the website's `lib/text-limits.js`.

| Field | Cap |
| --- | --- |
| Titles and album names | 150 |
| Committee, folder, and group chat names | 100 |
| Locations | 200 |
| Descriptions | 2000 |
| Announcement bodies | 5000 |
| Poll questions | 300 |
| Poll option labels / number of options | 150 / 20 |
| Document link names | 200 |
| Direct and group messages | 4000 |
| Reactions | 32 |

These limits reject oversized input. `about_me` is a separate rule that truncates to 600 characters. Website `maxLength` attributes help users enter valid text, but the API enforces the limits.

Messages may omit a body when they have an attachment. Body validation runs before attachment storage so a rejected message does not leave a newly stored attachment. Reaction length is measured in UTF-16 code units; the check limits length without requiring the value to be an emoji.

### Dates

Use `dateOnly` for `users.dob`. It returns a string to avoid timezone conversion when writing a Postgres `DATE`. For example, serializing `new Date("2004-05-14")` with a UTC-4 local offset can store the previous day.

The validator requires the exact date format and checks that the date exists. A parse-success check alone is insufficient because JavaScript can roll an invalid date such as February 30 into March.

### URLs

URL parsing alone does not establish an allowed protocol: `new URL("javascript:alert(1)")` is valid syntax. Fields used as links must also reject disallowed schemes.

| Helper in `services/urls.js` | Rule |
| --- | --- |
| `normalizeWebUrl(v)` | HTTP or HTTPS only, up to 300 characters; accepts input without a scheme |
| `normalizeLinkedinUrl(v)` | Same rules, restricted to `linkedin.com` or its subdomains; converts a bare handle to a profile URL |

Check explicit schemes before adding HTTPS to input. Match LinkedIn hosts exactly or as subdomains; `evil-linkedin.com` and `linkedin.com.evil.com` must fail.

Values are normalized on write. The website's `linkedinHref()` in `lib/portal-format.js` also checks stored values when rendering older records. New link fields should use the shared URL validators.

Domain-specific rules live in `services/urls.js`, `services/emails.js`, and `services/usernames.js`. `services/profileFields.js` combines profile validation for the member and admin routes. Their write semantics differ: see [Member profile updates](./endpoints.md#put-usersmeprofile) and [Admin profile updates](./endpoints.md#put-adminusersauthentikidprofile).

## Eboard: changing a member's group

`PUT /admin/users/:authentikId/group` changes roles from the website's `/admin/users` page. It calls Authentik through `services/authentikAdmin.js` first, then updates `users.member_group`. Authentik remains the role source; existing access tokens can retain older group claims until replaced.

The documented service account is `ktp-api-service`. It needs permissions to view users and view, add users to, and remove users from the managed role groups. See [API Tokens / Service Accounts](../authentik/overview.md#api-tokens--service-accounts) for setup.

## Environment Variables

The documented deployment keeps environment settings in `/opt/ktp-api/.env` on LXC 119. Core settings:

```env
DATABASE_URL=postgresql://root:<pass>@10.0.0.54:5432/ugaktp_db
AUTHENTIK_ISSUER=https://auth.ugaktp.com/application/o/ktpapp/
AUTHENTIK_JWKS_URL=http://10.0.0.4:9000/application/o/ktpapp/jwks/
WEBHOOK_SECRET=<hex32>
AUTHENTIK_API_TOKEN=<service account token>
AUTHENTIK_API_URL=http://10.0.0.4:9000
IMMICH_URL=http://10.0.0.3:2283
IMMICH_API_KEY=<scoped asset API key>
PORT=4000
NODE_ENV=production
```

The iOS provider uses `AUTHENTIK_IOS_ISSUER` and `AUTHENTIK_IOS_JWKS_URL`. Notification and other optional features have additional variables documented with their endpoints.

Use internal service addresses for server-to-server calls when the public address fails from the LAN because of hairpin NAT. Keep the issuer equal to the token's issuer URL even when JWKS is fetched through an internal address.

## Deployment

The documented server-side deployment command is:

```bash
# On LXC 119
cd /opt/ktp-api
./refresh.sh
```

`refresh.sh` is not present in this repository. The recorded workflow stops the container, pulls changes, rebuilds and restarts, then applies migrations. Inspect the deployed script when troubleshooting or changing that sequence.

The repository provides these migration commands:

```bash
npm run migrate:create -- <name>
npm run migrate:up
```

Write schema changes in a new migration's `-- Up Migration` section. Applied migrations are tracked in `pgmigrations`. Do not rewrite an applied file to change a deployed schema. Check each migration's down section before assuming a rollback is available.

### Postgres grants {#postgres-grants--no-longer-needed-fixed-2026-07-10}

The deployment notes record that recurring manual grants were resolved on July 10, 2026. That is server configuration, not a guarantee made by the repository.

If a query fails with `42501`, inspect the connected role, object ownership, table and sequence privileges, and default privileges for the role creating new objects. Diagnose the current permission failure before applying grants.

For database administration on LXC 118:

```bash
su - postgres
psql -d ugaktp_db
```
