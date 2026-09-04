---
sidebar_position: 2
---

# API Endpoints

Base URL (production): `https://api2.ugaktp.com`  
Base URL (internal): `http://10.0.0.53:4000`

All protected routes require `Authorization: Bearer <access_token>`.

---

## Users

### `POST /users/sync`

**Auth required.** Called automatically on every login by the website (`auth.ts`). Creates or updates the user's row in the database and returns their `profile_complete` status.

**Request body:**
```json
{
  "authentik_id": "uuid",
  "username": "jsmith",
  "member_group": "active"
}
```

**Response:**
```json
{
  "authentik_id": "uuid",
  "profile_complete": false
}
```

The `member_group` is determined by group priority: `eboard > chair > active > pledge > alumni`.

---

### `GET /users/me`

**Auth required.** Returns the full profile row for the authenticated user.

**Response:**
```json
{
  "authentik_id": "uuid",
  "username": "jsmith",
  "first_name": "John",
  "last_name": "Smith",
  "preferred_name": "John",
  "dob": "2003-01-15",
  "major": "Computer Science",
  "graduation_date": "Spring 2026",
  "phone": "4045550000",
  "email": "jsmith@uga.edu",
  "linkedin_url": "https://linkedin.com/in/jsmith",
  "pledge_class": "Alpha",
  "member_group": "active",
  "profile_complete": true,
  "created_at": "...",
  "updated_at": "..."
}
```

---

### `PUT /users/me/profile`

**Auth required.** Saves profile fields and sets `profile_complete = true`. JSON body — this route has no file upload, so it is **not** multipart; only `/users/me/profile-picture` below is.

**Body fields** — `first_name` and `last_name` are required, the rest optional:

| Field | Rule |
|---|---|
| `first_name`, `last_name` | Required, 100 characters or fewer. **Trimmed before the required check**, so `"   "` is not a name |
| `preferred_name` | ≤100 |
| `dob` | `YYYY-MM-DD`, a real calendar date, between `1900-01-01` and today |
| `major` | ≤120 |
| `graduation_date` | A **semester and a year**, like `"Spring 2026"` — `Spring`, `Summer`, `Fall` or `Winter` plus four digits in 1900–2100. The form combines a dropdown and a year box before sending |
| `phone` | Digits and `+ ( ) - . space`, **7 to 15 digits**. Stored exactly as typed |
| `email` (the UGA address), `personal_email` | **`email` is ignored for alumni.** The profile form doesn't render a UGA Email input for them, and this route is a whole-row upsert where every absent key becomes `NULL`, so the API preserves the stored value instead of taking it from the payload. That guard is at the write, not in the form, so a hand-written `PUT` carrying `email` won't set one either. See `GET /members` above for why alumni have no UGA address |
| `linkedin_url` | Validated and canonicalised on write; a bad value is a `400` |
| `pledge_class` | ≤50 |
| `about_me` | Free text, **truncated** to 600 rather than rejected |
| `doing_now` | ≤150. What a member is doing after graduation. Only the alumni form renders it, but the rule applies to every caller — a check gated by group as well as by form disappears the moment somebody calls this route directly |
| `pronouns` | ≤40. Member-set pronouns. Free text, and deliberately **not** validated against the preset list the clients show — those presets are a convenience, and the Custom option beside them only means anything if an unlisted value is accepted. Rejects rather than truncates |
| `links` | Up to **5** entries of `{ label, url }`. Label required, ≤40. URL validated as an href, ≤300, stored canonicalised. See below |
| `minors` | ≤200. Minors and certificates, as one free-text line. Rush interest form |
| `gpa` | A number with **at most two decimal places**, `0` to `5`. Rush interest form. See the warning below |
| `heard_from` | ≤300. "How did you hear about KTP?", free text by decision rather than by omission — a fixed option list was considered and turned down. Rush interest form |

Everything except `about_me` **rejects with a `400` naming the field** rather than being shortened or coerced: each of these is something a person is found or addressed by, so half of one is the wrong answer rather than a shorter right one. A blank string clears its column instead of being stored as `''`.

:::warning A key you omit is left alone. A key you send as `null` is cleared.
These are different, and the difference used to be **data loss**. This route is an upsert that wrote every column on every call, so a client sending a subset of the fields nulled the rest.

The iOS app sends five profile keys. Everyone except alumni was protected **by accident** — it sends no `email`, and a non-alumnus must have a UGA address, so the request `400`s before the write. Alumni don't need that address, so their save succeeded and erased their bio, phone, personal email, LinkedIn, pledge class, date of birth, "doing now" and links in a single tap.

Since 2026-08-11 the API tracks which keys were actually present in the body and writes only those. `first_name` and `last_name` remain required.

**If you are writing a client, this means you can safely send a partial profile** — but you must send an explicit `null` for anything you intend to clear. The website always sends every key, which is why its behaviour is unchanged.
:::

:::warning `links` refuses rather than repairing, in three separate ways
Each rule is aimed at a specific way this could have failed quietly.

**A non-array is rejected, not coerced.** Interviews shipped the opposite and it was the worst bug in that feature: a non-array fell into the same branch as an empty list, so sending `"3"` instead of `[3]` returned `200` having silently closed the round. The same silence here would be a member's links vanishing on save.

**One bad entry rejects the whole list.** Storing four of five returns `200` to somebody who is never told which one didn't make it. The message names the offending row by its label — the API cannot know which input on the form that row became, so it says `"Portfolio: Links must start with http:// or https://"`.

**An absent key means `[]`, not null.** The column is `NOT NULL`, and this route is a whole-row upsert, so absent has to resolve to something storable.

A scheme-less host like `example.com/me` is accepted and canonicalised to `https://example.com/me`, because that is what people paste. `javascript:`, `data:` and every other non-http(s) scheme are refused — these become `<a href>` on a directory card, and `new URL()` is not a check, since it parses `javascript:alert(1)` happily.
:::

:::info `dob` is the only real `DATE` column, and it is the only one whose bad values used to be `500`s
An empty string is `22007` and `2004-02-30` is `22008` — both abort the statement rather than storing a bad row, and the controller turns a thrown query into a `500`. The API now answers `400` instead.

The value also stays a **string** all the way to Postgres. A JavaScript `Date` is serialised with the server's local offset, so a date-only value written that way lands a day early anywhere west of UTC: from a UTC-4 machine, `"2004-05-14"` stores `2004-05-14` and `new Date("2004-05-14")` stores `2004-05-13`.
:::

:::warning `gpa` is the only `NUMERIC` column here, and it is a **string** in JSON both ways
`users.gpa` is `NUMERIC(3,2)`. **node-postgres returns `NUMERIC` as a string**, because a JS double cannot round-trip every `NUMERIC` — so this field arrives in every response as `"3.75"`, not `3.75`. The validator returns a string on the way in too, so the write and the read agree. Do not `parseFloat` it in a client: the export wants the exact stored digits.

It is matched as **literal text** before being converted, the same way `validate.intId` works. `Number("3.5e0")`, `Number("+3.5")` and `Number(" 3.5 ")` all produce a number, so parsing first and inspecting afterwards would accept spellings nobody typed. A third decimal place is rejected rather than rounded — Postgres silently stores `3.756` as `3.76`, and a GPA that reads back differently from how it was entered is the kind of thing somebody notices on decision night.

**The ceiling is 5, not 4.** A first-semester rushee has no college GPA and answers with a weighted secondary-school one. Refusing a true answer is a worse failure than a generous range.
:::

:::info The three rush fields are **rushee-only on the form, validated for everyone here**
`minors`, `gpa` and `heard_from` are columns on every `users` row and only the *form* is gated — the same arrangement as `about_me` and `doing_now`. A column gated to one group would need migrating the day somebody changes group, which at this chapter happens every spring when a rushee becomes a pledge.

The website's `buildProfilePayload` **omits all three keys** when the inputs are not rendered, rather than sending `null`. That is load-bearing and depends on the partial-write behaviour described above: without it, the first profile save a new pledge makes would write three nulls over the answers the pledge committee selected them on. The admin route cannot use the same trick — see [`PUT /admin/users/:authentikId/profile`](#put-adminusersauthentikidprofile).
:::

**Response:** the saved profile row.

After a successful response, the website calls `update({ profile_complete: true })` to update the NextAuth session without a round-trip.

:::note `username` is not in this list
It is not a field of this endpoint, and `updateProfile` deliberately does not write it — the caller supplies the access token's value, which keeps the *old* name for the rest of the session after a rename. Renames go through `PUT /users/me/username` below.
:::

---

### `PUT /users/me/username`

**Auth required.** Self-service rename. JSON body `{ "username": "newname" }`.

Writes **Authentik first**, then mirrors into Postgres — Authentik owns login identifiers, so a name rejected as taken leaves both systems untouched, whereas writing ours first would leave the portal showing a username the member cannot log in with.

| Status | Meaning |
|---|---|
| `200` | `{ username }` — the stored value |
| `400` | Fails validation: 3–32 characters of `[a-zA-Z0-9._-]` |
| `409` | Already taken in Authentik — the member picks another |
| `502` | We could not complete the write. **Not the member's fault** — most often the service account lacking `Can change User` |

:::warning Needs an Authentik permission that is not granted by default
See [Authentik: API Tokens / Service Accounts](../authentik/overview.md#api-tokens--service-accounts). Without `Can change User` every rename returns `502`, and that is exactly why the first attempt at this feature was reverted — it reported the resulting 403 as "that username is taken", so the real cause never surfaced.
:::

Full behaviour, including why it is a separate endpoint from the profile save: [Profiles & Directory → Usernames](../website/profiles-and-directory.md#usernames).

---

### `PUT /users/me/profile-picture`

**Auth required.** Multipart upload, field name `file`. Images only — no video, unlike the general photo uploader — with a **25MB limit**.

Accepted input: **JPEG, PNG, WebP, HEIC/HEIF, AVIF, GIF, TIFF**. Not accepted: SVG (can carry scripts, and would be served from a same-origin media route) or BMP (the libvips build `sharp` ships can't decode it).

Whatever comes in, **a JPEG goes out**. `services/profilePictureImage.js` decodes the upload, applies EXIF rotation, resizes to fit within 1024×1024 (never enlarging), flattens transparency onto white, and re-encodes as a progressive JPEG before anything reaches Immich.

:::info Why convert instead of storing the original
[`GET /users/:id/profile-picture/media`](#get-usersidprofile-picturemedia) streams the **original** asset back with its original content-type. If a HEIC were stored as-is, the avatar would render in Safari and appear broken in Chrome, Firefox, and Edge. Converting on upload decouples what members may upload from what browsers must render.

Three useful side effects: EXIF is dropped (including **GPS coordinates**, which shouldn't follow a member photo into a chapter-wide directory), sideways phone photos are corrected, and a 20MB original becomes a few hundred KB on every page that renders a grid of avatars.
:::

Animated GIF/WebP uploads keep their first frame rather than being rejected.

**Error responses:** `413` `upload_too_large` if over 25MB, `415` `unsupported_media_type` if the file isn't a decodable image. Note that the mimetype the client claims is only an early filter — content is validated by actually decoding it, so a non-image renamed to `.jpg` is still rejected.

:::caution HEIC depends on the platform's libvips build
HEVC-compressed HEIC — the iPhone camera default — needs libvips built with `libde265`. `sharp` reports HEIF input support either way, so this can't be detected in advance. An undecodable file fails cleanly with `415` rather than storing something unviewable, but if members report HEIC uploads being rejected, this is the cause. AVIF and AV1-in-HEIF decode everywhere.
:::

---

### `GET /users/:id/profile-picture/media`

**Auth required.** Streams a member's profile picture from Immich (forwards `Range` headers). Generalized to **any** user id, not just "me" — needed so the directory, admin panel, and message threads can show other members' pictures too. 404s if the member has no picture set (the frontend's `AvatarImage` falls back to initials on a 404, no special-casing needed).

---

### `DELETE /users/me`

**Auth required.** Self-service account deletion. **Anonymizes, does not hard-delete** — clears every PII field (name, email, phone, major, etc.), sets `profile_complete = false`, and stamps `deleted_at`, but leaves the row (and their messages/photos/committee history) in place so other members' conversations and albums aren't broken. Excluded from `/members` and `/admin/users` afterward. Best-effort deletes their Immich profile-picture asset first.

Never touches Authentik — revoking real chapter/SSO access is a separate, eboard-owned action (deleting them in Authentik directly, which the webhook below still hard-deletes for). The website signs the user out immediately after this succeeds; any client calling this should do the same.

### `GET /users/blocked`

**Auth required.** The caller's own block list — people they've blocked, not people who've blocked them. Each entry is `{ id, username, first_name, last_name, preferred_name, profile_picture_asset_id }`.

`profile_picture_asset_id` is there so the client can version the avatar URL; see [`GET /roster`](#get-roster) below for why every projection that carries a member id needs to carry it too.

### `PUT /admin/users/:authentikId/traits`

**Eboard only.** Body `{ "traits": ["Pledge Chair", "Fintech"] }` → `{ traits }`. Up to **6**, each ≤80 characters. Sending `[]` clears them; there is no separate delete.

Each trait is one **plain string**, not a `{ label, value }` pair. They render as pills beside the member's group badge, the same treatment a chair's committee caption gets, and "Pledge Chair" is one string rather than a label and a value. Migration `1788200000000` changed the shape and converted existing rows by joining the halves as `"label: value"` — dropping either half would have destroyed chapter-authored text on a public page. A `{ label, value }` entry is now **rejected with a 400** rather than stringified, because storing it would print the literal text `[object Object]` on the public roster.

Traits appear on the member's directory card and on the **public** roster, under their role. They generalise the exec title, which stays as it is — a trait is additive, a role is not. (The exec title itself is now a row in [`exec_roles`](./overview.md#exec_roles-table); traits were left as free text on purpose.)

:::info "Eboard-only" here means no other route can write them
`traits` is deliberately **not** in `PROFILE_FIELDS`. That list is shared by `PUT /users/me/profile` and `PUT /admin/users/:id/profile`, so a key added there is settable by the member as well as by eboard — and these land on a page with no authentication. Making the boundary "which routes exist" rather than "which routes check" is what stops a future edit to a shared list quietly turning them self-service.
:::

Rejects rather than repairs, exactly like `links`: a non-array is refused rather than coerced, one bad entry rejects the whole list, and both halves of a pair are required. The message names the offending row by its label.

### `PUT /users/me/roster-visibility`

**Auth required.** Body `{ "visible": true | false }` → `{ show_on_public_roster }`. Controls whether the caller appears on the **public** roster at `/members-list`.

Self-service only, by design: there is no eboard equivalent. `is_test_account` already covers accounts that should never be listed, and a member's own answer to "may my name and face be on the open internet" should not be overridable from an admin form.

:::info Why this isn't a field on `PUT /users/me/profile`
That route is a **whole-row upsert** — every absent key becomes `NULL`. This column is `NOT NULL`, so a client that doesn't know about it would either fail the save outright or flip somebody's answer. The iOS app sends five profile keys. Username and profile picture are separate endpoints for the same class of reason.

The boolean is **type-checked, not coerced**. `Boolean(req.body.visible)` on a missing key is `false`, which would quietly remove a member from a public page because a client sent the wrong field name. A wrong type is a `400` naming the field.
:::

Turning it off removes the member from the list **and** stops `/roster/:id/media` serving their photo. Both are needed: the media route re-checks eligibility rather than merely resolving the id, and filtering only the list would leave every opted-out photo fetchable one id at a time.

### `POST /users/:id/block`

**Auth required.** Blocks a member. Prevents new direct messages starting in either direction and hides the blocked user's messages from the caller's own DM and group chat views. One-directional and idempotent.

### `DELETE /users/:id/block`

**Auth required.** Unblocks.

---

## Members

### `GET /members`

**Auth required.** Returns a list of members. Supports optional `?group=` query param to filter by `member_group`.

**Query params:**
- `group` — one of `active`, `pledge`, `eboard`, `chair`, `alumni`, `rush`

`rush` is the odd one. Rushees are **never** in the unfiltered response — asking for them by group is the only way to get them, and even then only if the caller's own group permits it (otherwise the list comes back empty, not 403). The website's directory makes exactly this second call to fill its Rushees tab. See [Rushees in the member directory](../website/rush-portal.md#rushees-in-the-member-directory).

**Response:**
```json
[
  {
    "authentik_id": "uuid",
    "first_name": "John",
    "last_name": "Smith",
    "member_group": "active",
    "graduation_date": "Spring 2026",
    "birthday": "03-14",
    ...
  }
]
```

:::warning `birthday` is MONTH AND DAY ONLY, and the raw `dob` is never returned
The field is formatted in SQL as `TO_CHAR(dob, 'MM-DD')`, so the **birth year never leaves Postgres** and no consumer of this endpoint can recover it. A full date of birth shown to the chapter would also publish everyone's age, which is a different disclosure from a birthday.

It is `null` for the many members who never entered one. The **public** roster (`GET /roster`) returns neither field, the same way it omits `pronouns`.

Formatting happens in the query rather than in a client for a second reason: `dob` is a `DATE`, and parsing `"1998-03-14"` with `new Date()` treats it as UTC midnight, which renders as the previous day in any negative-offset timezone. `TO_CHAR` cannot shift a day.
:::

---

### `GET /members/:id`

**Auth required.** Returns a single member by `authentik_id`. Same field set and the same alumni rule as `GET /members`.

:::caution `email` is always `null` for alumni
A UGA address stops working at graduation, so alumni have no UGA email anywhere in the product. `users` carries two columns — `email` (the UGA address) and `personal_email` — and for anyone whose resolved `member_group` is `alumni`, `email` is nulled by the SQL itself in both `findAll` and `findById`.

This is a correctness rule rather than a privacy one. Both the web directory and the iOS card build their mailto as "`email`, else `personal_email`", so a stale UGA address in the payload would silently point the Email button at a dead inbox. Nulling it server-side makes that fallback pick the personal address on its own, and covers the iOS app, which never runs the web components.

**If you are writing a new client:** don't read `email` alone. Fall back to `personal_email`, or an alumnus will render with no contact address at all.

The rule keys off the resolved `member_group`, never the JWT's raw `groups` array — Authentik doesn't drop someone's old group when they graduate. The column keeps its value; this is a read-time mask, not a delete. See the [ktp-api README](https://github.com/ktpuga/ktp-api#alumni-and-the-uga-email) for the matching write-side guard.
:::

---

## Roster (public)

Backs the public "meet the chapter" page at `/members-list`. **No auth at all** — which is exactly why the field set is deliberately narrower than `/members` above: no email, phone, major, DOB, or pledge class.

### `GET /roster`

Returns `{ eboard: [...], chair: [...], active: [...], alumni: [...] }`. Each entry is `{ id, firstName, lastName, preferredName, execTitle, chairedCommittees, profilePictureAssetId, doingNow }`.

`doingNow` is the member's own free text about what they're doing after graduation, rendered on the public card between their role and their LinkedIn icon. Only alumni are asked for it, so it is `null` for nearly everyone else. **It was deliberately withheld from this endpoint when the column shipped and that decision was reversed on 2026-08-11** — an alumnus saying "SWE at Google" is the point of a public alumni page. `links` was *not* part of that reversal and stays members-only: a list of arbitrary member-supplied URLs rendered as live hrefs is a different exposure from one line of text about yourself.

Excluded from the results:
- **Pledges** — the public page shows initiated members only
- **Incomplete profiles**
- **Test accounts** (`is_test_account`)
- **Anyone without a profile picture** — a deliberate incentive to upload one

`execTitle` is only ever populated for eboard. `chairedCommittees` is an array, since one person can chair more than one committee.

:::info Why the asset id is in a public response
`profilePictureAssetId` is not a second copy of the photo. It is the cache key for it. `/roster/:id/media` is keyed on the member id alone, so its URL is byte-identical before and after somebody replaces their picture, and the proxy forwards no `Cache-Control` — the browser keeps serving the old one until a hard refresh. Immich issues a **new** asset per upload, so the id is the one value that changes exactly when the picture does, and the client appends it as `?v=`.

Publishing it costs nothing here: it is an opaque Immich uuid, and the media route ignores it entirely, so it grants no access the already-public endpoint didn't. Anything that hands out a member id for drawing an avatar should hand out this alongside it — a projection that omits it doesn't error, it just pins that surface to a stale photo forever. `ktp-api/test/avatarAssetIds.test.js` pins this endpoint and `GET /users/blocked` against exactly that.
:::

### `GET /roster/:id/media`

Streams that member's profile picture. 404s if they have none.

This re-validates the *same* eligibility rules as the list endpoint rather than just checking that the ID exists — otherwise a guessed ID could pull a photo for a pledge or test account who was never listed.

---

## Events

Reads (`GET /events`, `GET /events/:id`) use `optionalAuth` — a valid token personalizes the results (targeted events included), but a missing/invalid token falls back to public-only results rather than rejecting (needed so the mobile app's calendar, which fetches anonymously, keeps working). Writes require `requireAuth` + membership in `SHARED_ALBUM_GROUPS`.

### `GET /events`

Returns events visible to the caller: public ones (no `audience`/`committee_id` set) always; plus, if authenticated, ones where `audience` overlaps the caller's Authentik groups, or the caller is a member of the event's `committee_id`. Eboard gets every event unfiltered. Chair and eboard members count as `active` for this overlap even though Authentik keeps the three groups mutually exclusive — targeting `audience: ["active"]` still reaches them (Announcements and Polls, targeted the same way as Events, inherit this too).

### `GET /events/:id`

A single event, filtered by **the same audience predicate as the list** — `VISIBLE_TO_VIEWER_SQL`, one shared constant in `eventModel` rather than two similar queries. Eboard is unfiltered, matching `GET /events`.

An event the caller may not see returns **404, not 403**: restricted content is hidden entirely here, the same way restricted albums, folders and documents are. A 403 would confirm the event exists.

:::note This was a real hole, fixed 2026-08-16
This route previously called `findById` and returned the row with no audience check at all, so any caller holding an id could read any event, eboard-only ones included — and ids are sequential. It had no consumers (iOS fetches only the list; the website uses `PUT`/`DELETE` and the attendance subroutes), so closing it broke nothing. The predicate is shared with the list specifically so a future edit cannot leave a weaker copy behind.
:::

### `POST /events`

**Request body:**
```json
{
  "title": "General Meeting",
  "description": "Weekly chapter meeting",
  "startDate": "2026-02-01T18:00:00Z",
  "endDate": "2026-02-01T19:30:00Z",
  "location": "Boyd GSRC",
  "audience": ["active", "chair"],
  "committeeIds": [],
  "requiresAttendance": false,
  "requiresRsvp": false
}
```

Permission depends on who's asking:
- **Eboard**: can set any `audience` array and/or any `committeeIds`.
- **Committee chair**: can only scope to committee(s) they chair — every ID in `committeeIds` must be one of theirs, and no `audience` (implicitly scoped to those committees' members).
- **Anyone else**: 403.

`title`/`startDate`/`endDate`/`location` are validated before touching the DB.

:::note Events take an array, announcements take a single ID
`events.committee_ids` and `polls.committee_ids` are `INTEGER[]` — one item can belong to several committees. **`announcements.committee_id` is still a single nullable ID** and is now the only one left. Don't assume they are symmetrical when writing a query across both.
:::

Setting `requiresAttendance: true` generates a random `attendance_token` server-side the first time. It's never regenerated, and as of 2026-08-25 it is **never returned by any endpoint at all**.

:::danger `attendance_token` is a secret key, not a check-in code
It is the HMAC key that short-lived rotating codes are derived from (`services/attendanceCode.js`). Sending it to a browser would let whoever received it mint valid codes indefinitely, which is the exact hole rotation closes.
:::

### `PUT /events/:id`

Same permission logic as `POST /events`.

### `DELETE /events/:id`

Eboard can delete any event; a non-eboard creator can delete their own. Deleting cascades the event's RSVP rows.

---

## RSVP

"Are you coming?", asked *before* the event, for events that opted in via `requiresRsvp`. **Independent of attendance in both directions** — an event can ask for one, both or neither.

:::danger RSVP and attendance must never share storage
`event_rsvps` is a separate table from `event_attendance` on purpose. Attendance records who actually turned up: it is materialised by `syncRoster`, written by QR check-in, and frozen by `attendanceFinalizedAt` because it becomes chapter history. An RSVP is a changeable statement of intent. Folded together, a "going" RSVP would be indistinguishable from a check-in, which is precisely the number nobody may get wrong.
:::

### Every event gains two fields

`GET /events` and `GET /events/:id` now return:

```json
{
  "requiresRsvp": true,
  "myRsvp": "going"
}
```

`myRsvp` is `"going"`, `"not_going"`, or `null` when the caller has not answered (or is anonymous). It is always about the **caller only** — a member never learns anyone else's answer from these routes.

A third field, `canRsvp`, says whether the API will actually **accept** an RSVP from this caller:

```json
{ "requiresRsvp": true, "myRsvp": null, "canRsvp": false }
```

:::danger Do not draw the RSVP control from `requiresRsvp` alone
Seeing an event and being *sent* one are different questions with different answers. The calendar read tests the caller's Authentik token groups; RSVP eligibility tests `users.member_group` against the event's audience — and **there is no creator clause in it.** An eboard member who targets an event at `["pledge"]` can see that event (eboard sees everything) and is **not** a recipient of it.

The portal originally gated its buttons on `requiresRsvp` alone, so organisers were shown a control that answered `403`. `canRsvp` exists so the client never has to infer this. Gate the buttons, the "RSVP needed" badge, and any pending-RSVP count on it.
:::

Creating an event does not put you in its audience — that is deliberate, not an oversight. An organiser inside the audience (an untargeted all-chapter event, say) gets `canRsvp: true` and may answer normally; there is no special case for creators in either direction.

Both `canRsvp` and the `PUT` guard evaluate the **same** SQL predicate (`RECIPIENT_PREDICATE_SQL` in `eventModel`), so the flag cannot promise something the write then refuses. The list route resolves it for every event in **one** batched query rather than one per row.

`GET /events/:id` additionally returns `rsvpSummary`, **for eboard or the event's creator only**. It is absent (not zeroed) for everyone else:

```json
{
  "rsvpSummary": { "going": 12, "notGoing": 3, "pending": 7, "total": 22 }
}
```

`rsvpSummary` is deliberately **not** on `GET /events`. Each summary needs a `users` scan to compute `total`, and that list can be the whole calendar, so putting it there would mean one scan per event on every calendar load.

### Where members actually answer

Answering lives in the **Upcoming events** list beside the calendar, not only on the event card inside the day panel. The panel version sits one click behind a date nobody clicks unless they already know something is there, so RSVPs went unanswered simply because nothing asked. An unanswered row is outlined in amber and carries an "RSVP needed" badge; answered rows return to the normal border, so the list keeps reading as a to-do.

The list row is itself a `<button>` that opens the day, so the RSVP buttons sit in a **sibling footer**, not inside it — a button nested in a button is invalid HTML and browsers recover by dropping the inner one.

See [Tab badges](../website/notifications.md#calendar-is-different-too-unanswered-rsvps-outrank-new) for why the sidebar count persists until answered rather than clearing on visit.

### `PUT /events/:id/rsvp`

Any authenticated member, answering for themselves. There is no route for answering on anyone else's behalf, which is why this needs no shared secret the way QR attendance does.

```json
{ "status": "going" }
```

`status` must be `"going"` or `"not_going"`. Responses:

| Status | When |
|---|---|
| `200` | `{ eventId, status, createdAt, updatedAt }` — upserted, so changing your mind updates the one row |
| `400` | Bad `status`, bad id, or the event is not asking for RSVPs |
| `403` | `{ "message": "This event was not sent to you" }` — caller is outside the event's recipient set |
| `404` | No such event |
| `409` | `{ "message": "This event has already ended" }` |

The cut-off is **`endDate`, not `startDate`**: someone stuck in traffic changing "going" to "can't make it" during the event is exactly the update the organiser most wants. 409 rather than 400 because the request is well formed and the client should *hide the control*, not report a validation error.

### `DELETE /events/:id/rsvp`

Withdraws the caller's own answer, putting them back to never-answered. Added because the portal used to make an RSVP one-way: once you answered you could switch between "going" and "can't make it", but there was no way back to having said nothing.

| Status | When |
|---|---|
| `200` | `{ eventId, status: null, removed }` |
| `400` | Bad id, or the event is not asking for RSVPs |
| `403` | `{ "message": "This event was not sent to you" }` |
| `404` | No such event |
| `409` | `{ "message": "This event has already ended" }` |

**The guard ladder is identical to the `PUT`, deliberately.** A withdrawal writes the same row, so anything that refuses setting must refuse clearing — otherwise `DELETE` becomes a way to mutate a row the setter has already frozen. In particular it still 409s after `endDate` and still 403s for a non-recipient.

**Removing an answer you never gave is a `200` with `removed: false`, not a `404`.** The caller asked to end up with no RSVP and they have no RSVP; reporting a failure would describe the row rather than the outcome, and a double tap in the portal would surface an error for a state that is already correct.

**It deletes the row rather than storing a third status.** `summary.pending` is derived by subtracting the stored answers from the recipient list, so a withdrawn RSVP has to return to the exact shape a never-answered member has — a third state would make `pending` wrong and would need handling in every read. A member who withdraws drops out of `going`/`not_going` and back into `pending`; `total` does not move, because they are still in the audience.

It is a separate verb rather than `PUT { "status": null }` so the setter's validator stays strict (`status` required, enum-checked) and there is no sometimes-null field for a Swift `Codable` to model. A withdrawal also reads as a delete in the activity log.

### `GET /events/:id/rsvps`

**Eboard or the event's creator only.** Note this is a *narrower* set than attendance, which also allows any chair — response rows name individuals.

```json
{
  "eventId": "42",
  "requiresRsvp": true,
  "summary": { "going": 2, "notGoing": 1, "pending": 5, "total": 8 },
  "responses": [
    {
      "userId": "uuid",
      "displayName": "Sam Rivera",
      "username": "srivera",
      "memberGroup": "active",
      "profilePictureAssetId": "immich-uuid-or-null",
      "status": "going",
      "respondedAt": "2026-08-16T14:02:11.000Z"
    }
  ]
}
```

`responses` contains only people who have actually answered; `pending` is the difference between `total` and those answers, since people who have not responded have no row to return.

:::caution `findRecipientIds` is the audience authority for RSVP, not `findAllForUser`
`eventModel` has two audience implementations and they deliberately disagree. `findAllForUser` (the calendar query) tests the caller's **Authentik token groups**, so a rushee promoted to pledge keeps their old access. `findRecipientIds` tests the scalar **`users.member_group`** column, excludes soft-deleted accounts, and expands `audience: ["active"]` to include `chair` and `eboard`.

RSVP uses `findRecipientIds` for the write guard **and** for `total`, because it is the set that was actually told about the event — the same set push notifications and email go to. Mixing the two would let a chair be counted in `total` while being refused the RSVP, so `pending` could never reach zero on any event targeted at `active`.
:::

:::caution Editing an event's audience silently rewrites its RSVP counts
Nothing is snapshotted. Eligibility is re-derived on every read and intersected with the stored answers, so narrowing an audience **immediately** stops counting the people it excluded, in both `summary` and `responses`, with no write and no cleanup job.

The rows survive rather than being deleted, so re-widening the audience restores the earlier answers instead of discarding work members already did. Do not add a cached recipient list or an `rsvp_eligible` column — it would go stale the moment the event was edited, and the creator would be reading a total that no longer described anybody.
:::

Turning `requiresRsvp` back off does **not** delete the answers, matching how disabling attendance leaves its roster alone.

---

## Attendance

QR-code check-in for events that opted in via `requiresAttendance`. Managing attendance is **eboard, cabinet (chairs), or the event's own creator** — `MAY_MANAGE_ATTENDANCE` in `attendanceController`. Checking yourself in is self-service for any member.

:::note Cabinet has full access, unlike event creation
This used to be deliberately broader than the event-creation rule, which restricted a chair to committee-scoped events. Since 2026-09-04 `checkEventCreate` lets cabinet create anything, so the two now agree on creation and differ only on *editing somebody else's* event. Attendance is about **running the room**: a chair is usually the person standing at the front, and requiring the creator made the feature unusable whenever an eboard member had made the event on their behalf.
:::

### `GET /events/:id/attendance/code`

**Eboard, cabinet or event creator.** Returns `{ eventId, code, expiresAt, periodMs }` — encode as a QR pointing at `<site>/checkin/:eventId/:code`.

**The code rotates every 10 seconds.** Callers must re-fetch just after `expiresAt`; `AttendancePage.jsx` reschedules itself from that field and only polls while the QR overlay is actually open. Read the interval from `expiresAt` (or `periodMs`) rather than hardcoding it — the period has already changed once, and a client with 30 seconds baked in would sit on a dead code for 20 of them.

400s if attendance isn't enabled for the event.

### `GET /events/:id/attendance`

**Eboard, cabinet or event creator.** Returns `{ finalizedAt, records }` — the event's **materialised roster**, one record per expected attendee. Each record carries `user_id`, the frozen `display_name` and `member_group`, `status`, `checked_in_at`, `marked_by`, plus `username` and `profile_picture_asset_id` joined live from `users` for the avatar. A null `marked_by` means they self-checked-in via QR rather than being marked manually.

:::info Records are grouped by status, then by last name
The order is **present, excused, not marked, absent**, and alphabetical within each group. Absent sits last rather than beside "not marked" deliberately: absent is a decision somebody made, unmarked is a decision nobody has made yet, so the rows still needing a human stay above the settled ones.

Ordered in SQL rather than in the client, because the iOS app reads this same endpoint and the portal treats the list as server-ordered — it uses the array index as a key tiebreaker for deleted accounts, which have no `user_id` to key on.

A consequence to expect rather than to fix: the portal re-polls every few seconds, so during QR check-in rows **move as people scan themselves in**.
:::

:::warning The response is an object, not an array
It was a bare array until 2026-08-09. A client doing `Array.isArray(data) ? data : []` on the new shape gets `false` and renders an **empty roster with no error** — which is exactly what happened to the portal. Unwrap `data.records`.
:::

`user_id` is **null for a deleted account**: the row survives under its frozen name (`ON DELETE SET NULL`), so an event keeps the attendee it really had. There is no id left to address `PUT /events/:id/attendance/:userId` at, so those rows are read-only — the portal disables their status control.

:::info `status: null` is a fourth state, and it is not `absent`
Someone who never scanned and was never marked comes back with `status`, `checked_in_at` and `marked_by` all null — **"nobody has accounted for this person yet."** Rendering that as absent would make an event nobody took attendance for read as though the entire chapter skipped it, so the portal shows it as *Not marked* and `PUT` only accepts the three real statuses. There is no route back to null once someone is marked.

This changed in 2026-08. It used to return **only rows that already existed in `event_attendance`**, so anyone who didn't show up was absent from the response entirely — you could not see who was missing, which is what made the roster UI necessary.
:::

:::info The roster is frozen into the table, not recomputed on read
`attendanceModel.syncRoster` writes one row per expected attendee into `event_attendance` with `status` NULL, freezing `display_name` and `member_group` onto it. `findRosterForEvent` then does a pure read — no audience logic, no live group lookup.

That is not an optimisation. **Pledges are initiated mid-semester**, and a roster inverted from the audience on every read is correct only until somebody changes group: the day a pledge class becomes active, every past `audience: ["pledge"]` event silently loses its roster and every past `audience: ["active"]` event gains a dozen people who were never invited. Freezing is what keeps the history true.

The controller re-syncs before each read **only while `attendanceFinalizedAt` is null**, so an unfinalized roster still picks up someone who joined the committee yesterday.
:::

**Who lands on the roster** is the inverse of the calendar's visibility rule (`eventModel.findAllForUser`): an untargeted event addresses every member group, an `audience` array matches member groups, and `committee_ids` matches committee membership. Test, incomplete-profile and soft-deleted accounts are excluded.

:::warning Chairs and eboard are implicitly `active`, and the roster has to say so
`middleware/auth.js` `expandImpliedGroups()` treats chair and eboard as active, so a chair really does see an `audience: ["active"]` event. But the roster query only has `users.member_group` — a single resolved value where a chair is `'chair'` and nothing else. The obvious predicate:

```sql
u.member_group = ANY(ev.audience)   -- WRONG
```

**silently drops every chair and eboard member from an actives event's roster.** It looks correct and passes review. `attendanceModel.syncRoster` re-applies the implication with a `CASE`; `test/attendanceRoster.test.js` covers it, and that test was confirmed to fail against the naive version. If `expandImpliedGroups` changes, this changes with it.
:::

One rule beyond the audience: **anyone with an existing `event_attendance` row stays on the roster regardless of targeting.** Audiences get edited after people have scanned, and an eboard member may check in to an event they were never targeted by — gating purely on the audience would hide a check-in the database already holds.

#### `still_eligible` — on the roster, but no longer in the group

Every roster row carries a live boolean saying whether that person is **still** one of the people this event is for. It is `false` once they change group, leave the committee the event was aimed at, or delete their account.

**It is a display flag, never a filter.** Nothing is ever removed from a roster: `syncRoster` only ever `INSERT`s, and that is deliberate — the row records who was *expected when the event was made*, which is history. What changed is that the client now **greys those rows and labels them** (*"no longer in this group"*, or *"account deleted"*) instead of showing them indistinguishable from everybody else.

:::danger Why the flag had to exist
Without it, an officer working down the list marks somebody **absent** for a meeting they were uninvited from — and that absence then reads as fact. Hiding the row instead would be worse: it quietly rewrites who the event was for.
:::

The officer's status dropdown **stays usable** on a greyed row. Somebody who changed group last week may well still have walked through the door, and the officer standing in the room is the one who can see that. Only self check-in is refused.

`still_eligible` is computed from `AUDIENCE_MATCH_SQL` in `attendanceModel` — **the same string `syncRoster` uses**, deliberately shared rather than re-written. If the two ever drifted, the roster would materialise somebody and then immediately grey them out, which reads as the feature being broken rather than as a rule being applied.

:::warning The client must not grey a FINALIZED roster
A finalized roster is history. Pledges are initiated mid-semester, so a live eligibility test applied to a past `audience: ['pledge']` event would grey out the entire pledge class the day they became active. `AttendancePage` gates on `finalizedAt`; the API returns the flag either way, because a model that answers a different question depending on a flag is how two callers end up disagreeing.
:::

`attendanceModel.findForEvent` still exists for the older "only what was recorded" shape; nothing calls it from the portal.

### `PUT /events/:id/attendance/:userId`

**Eboard, cabinet or event creator.** Body `{ "status": "present" | "excused" | "absent" }`. Upserts, so it works for someone with no existing record.

:::danger …unless the roster is FINALIZED, and then it only updates
The portal tells the officer, in as many words: *"It is frozen, and nobody new is added. Marks can still be changed."* Until 2026-09-03 only the first clause was enforced anywhere, and only against self check-in. Because this route upserts, a `userId` naming somebody who was never on the roster **materialised a fresh row on a closed event** — measured going 0 → 1 rows.

On a finalized event the model now runs a plain `UPDATE` (`allowInsert: false`), so:

| Target | Result |
|---|---|
| Already on the roster | `200` — marks stay editable, which is the whole reason officers finalize at all |
| Not on the roster | `403` *"…nobody new can be added. Reopen it to add them."* |

The 403 is deliberately a **different sentence** from the `404` for a member who no longer exists. One is fixed by reopening the roster and the other never is; telling an officer "that member no longer exists" about somebody standing in front of them sends them after the wrong problem.

**The web UI could never reach this** — it renders only rows the roster already holds. iOS builds the URL itself, which is why the rule had to live at the API.
:::

### `PUT /events/:id/attendance-finalized`

**Eboard, cabinet or event creator.** Body `{ "finalized": true | false }` → `{ finalizedAt }` (null when re-opened). 400s if attendance isn't enabled for the event, or if `finalized` isn't a boolean.

Finalising freezes the roster: syncing stops, so nobody is added or removed afterwards no matter how the chapter's groups change. It is deliberately **an explicit button rather than something that happens at the event's end** — and it is reversible, because a mis-click on the wrong event should not need SQL to undo. Un-finalising only re-opens syncing; it never deletes a row, so no recorded mark is lost either way.

:::warning Finalising syncs first, on purpose
`setAttendanceFinalized` calls `syncRoster` before freezing. Without it, finalising an event whose roster was never opened would freeze an **empty** roster — recording that nobody was expected at a meeting the whole chapter was invited to.
:::

The accepted cost of a manual finalise is that an event nobody finalises keeps drifting, so the portal marks past events that were never finalised.

### `POST /checkin/:eventId/:token`

**Any member.** Self check-in, hit after scanning the QR while signed in.

The path param is a **rotating code**, not the stored token. It must match the current 10-second period or the one immediately before it (so it is valid for between 10 and 20 seconds, the grace covering the gap between the board rendering it and the scan reaching us). The current time must also fall inside the check-in window: from **30 minutes before the event's start** to **30 minutes after its end**.

403s outside that window, on a stale code, or on the raw `attendance_token`. **404s on an event id that isn't a positive integer** — this id comes off a URL people point a phone camera at, and a torn poster or a half-decoded QR used to reach Postgres as `WHERE id = 'not-a-number'`, surfacing as a `500` with a stack trace in the logs and "Failed to check in" on the phone.

:::danger The event's audience is now checked at the door
Until 2026-09-03 this route asked only for a valid code and an open window, so **anybody holding a live code could join any roster** — a rushee who scanned an actives-only event was recorded as present on it, a row `syncRoster` would never have built.

Eligibility is now `attendanceModel.isEligibleForEvent`, evaluated against the same `AUDIENCE_MATCH_SQL` the roster uses. A refusal is `403` with *"This event isn't open to your group."*

It is also what makes the roster's grey-out honest: somebody who changed group since the event was created stays on the roster as a record of who was expected, and this is what stops them scanning back in underneath that.

**Two cases fail OPEN, on purpose:**

| Case | Answer | Why |
|---|---|---|
| `users.member_group IS NULL` | eligible | The account exists but no group has resolved — a brand-new member mid-signup, or an Authentik enrollment that assigned none. Turning away a real member standing at the board costs far more than admitting somebody an officer can unmark. |
| No `users` row at all | eligible | This is the exact case self check-in **heals** from the caller's verified token, and it is the first thing a new member does at their first event. Refusing here would break the path this feature was fixed for. |

A rushee is unaffected by either: their group *is* known, and `rush` matches no member audience.

**And a third fallback, which is what stops this becoming a new "log out and log back in".** `isEligibleForEvent` reads `users.member_group`, and `/users/sync` writes that **only on first sign-in**. The `groups` claim on the bearer token comes from Authentik and refreshes with the token, so it is the *fresher* of the two. A rushee who has just been accepted as a pledge carries `pledge` in their token while the row still says `rush` — and would have been turned away at their first pledge event until they signed out and back in.

So when the stored group says no, the call falls back to `eventModel.findByIdForUser` — the existing audience authority for "can this viewer see this event". Anything on their own calendar is something they may scan into. Reusing that rather than writing a fourth audience predicate is deliberate; this codebase has already been bitten by two that drifted. It only runs when the first check fails, so an ordinary scan is still one query.
:::

:::danger A re-scan never overturns an officer
`event_attendance.marked_by` is non-null **only** when somebody set the row by hand from the roster, so it is the record of a human decision. Check-in's `ON CONFLICT` therefore leaves both `status` and `marked_by` alone whenever `marked_by` is already set: someone an officer marked **excused** stays excused, and someone marked **absent** stays absent until an officer changes it.

Until 2026-09-02 the upsert was `SET status = 'present', checked_in_at = NOW(), marked_by = NULL`, so a second scan did not merely reverse the officer's decision — it erased the attribution, leaving nothing for anyone to notice. A member told "I'll mark you excused" who then scanned out of habit silently undid it.

**The guard is `marked_by IS NOT NULL` OR `status IN ('excused','absent')`, and the second half is not redundant.** `marked_by` is `REFERENCES users(authentik_id) ON DELETE SET NULL`, so deleting an officer's account NULLs it on **every row they ever marked** — silently turning their decisions back into "a self-scan" and making them overwritable again. That was measured, not theorised: with only the `marked_by` test, deleting the officer let a re-scan flip an excused member to present. Self check-in writes **only** `'present'`, so an `excused` or `absent` row can only have come from a person, whatever became of their account.

`checked_in_at` is `COALESCE`d for the same reason `setStatus` does it: the **first** scan is when they actually arrived, and re-scanning because the page was slow must not relabel that as ten minutes later.

The trade goes both ways and is deliberate: somebody marked absent who then turns up and scans **stays absent** until an officer changes it. The officer is the one who can see the room.

**The request still succeeds.** The rule is written as a SQL `CASE`, not a `WHERE` on the `DO UPDATE`, so the statement always `RETURN`s its row — `selfCheckIn` reads an empty result as "nothing was recorded" and answers `500`, so a guarded update would show "you are already marked excused" as "we could not record your check-in". Clients must read `record.status` rather than assuming `"present"`; the portal's confirmation screen says *"You're marked excused"* rather than *"You're checked in!"* when it differs.
:::

:::info Why this changed
The QR previously encoded the raw `attendance_token`, which never rotates. Photographing the board therefore produced a credential that worked **from anywhere** until 30 minutes after the event ended, so a member could text it to somebody at home and have them check in. Attendance carries real chapter consequences, so that was worth closing.

Note what was never broken: check-in requires auth, so a scanner is always recorded as **themselves**. Nobody could ever check in *as* another member. The flaw was purely in relaying proof-of-presence.

**No client clock is involved** — the same server derives and validates the code, so there is no skew to tolerate.

**The URL shape is unchanged**, so the iOS scanner needed no update. It parses the scanned URL and posts immediately, and has no retry queue that a 60-second lifetime could strand.
:::

**What this does not solve:** a member checking in and then leaving. That needs a check-out step, not a better code.

Regular members get no attendance **management** UI — only chairs and eboard see the Attendance surface in the portal — but since 2026-09-02 they can see **their own** recorded status on the calendar.

### `myAttendance` on `GET /events`

`"present"`, `"excused"`, `"absent"`, or `null`. Attached by `eventsController.getEvents` in **one** batched query for the whole page (`attendanceModel.findMyStatusesForEvents`), on the same seam as `myRsvp` and `canRsvp`.

It is deliberately **not** set in `eventModel.toCalendarEventJSON`, which has no idea who is asking. So `GET /events/:id` and the ICS feed do not carry the key at all, rather than carrying a copy that could only ever be null — and a field that is always null is indistinguishable from "nothing was recorded", which is the exact confusion this exists to end.

:::warning A `NULL` status is reported as `null`, not as attendance
`syncRoster` materialises a row for **everybody an event is for**, with `status NULL` meaning "expected, nobody has accounted for them yet". The query filters those out with `status IS NOT NULL`. Dropping that filter would put a tick on every event a member was merely *invited* to — which is worse than no tick, because it is precisely the reassurance somebody goes looking for after a scan that did not land.
:::

`EventsCalendar.jsx` renders it in the slot the "Attendance" badge already occupied, so a card gains no fourth badge: *Checked in* (emerald), *Excused* (amber), *Marked absent* (rose), or the plain *Attendance* badge when nothing is recorded. Those strings are first-person and intentionally differ from `AttendancePage`'s roster labels (*Present* / *Absent*) — one is a member looking at themselves, the other an officer looking at other people. **Do not merge the two maps.**

This is the only surface where a member can confirm a scan landed. Check-in reports success on a page they close immediately and the roster is officer-only, so throughout the window where check-in was silently recording nothing (fixed 2026-09-02) there was nowhere that would have shown it.

### The portal screen

`components/portal/AttendancePage.jsx`, mounted at `/member/attendance` and `/admin/attendance`. **Upcoming / Past tabs** over a scrollable **event rail** on the left, and the **roster** on the right.

Live events sit under *Upcoming* with their own "Happening now" heading and a pulsing Live pill, rather than in a tab of their own: a meeting that started ten minutes ago is the one you're taking attendance at, so it has to be on the tab the page opens on. The tab itself defaults to whichever side has events, so a chapter with nothing coming up lands on *Past* instead of an empty pane. Selection follows the visible tab, and only moves when the chosen event isn't in it — a refresh never yanks the pane away from a deliberate pick.

**Show QR code** opens a fullscreen overlay that hides the roster behind it, closed with the button or `Esc`. That separation is the point: the QR goes on a projector in a room full of people, and the roster beside it is chapter-wide attendance.

**Finalize roster / Reopen roster** sits beside it and calls `PUT /events/:id/attendance-finalized`. A finalised event says so in the header with the date; an event that is over and *not* finalised gets an amber **"Not finalized"** pill in the rail, a matching dot on the Past tab, and a line in the header explaining that the roster still changes as people move between groups. That is the one state where a roster silently keeps drifting, so it is the one state the UI insists on showing.

On screens below `lg` the rail collapses to a labelled dropdown above the roster rather than stacking a full-height event list on top of it.

Four things worth not undoing:

- **The QR renders on a literal white background** (`bg-white`, not `bg-card`). A QR on a dark surface does not scan.
- **Row busy state is per person, not per roster.** Taking attendance means marking people in quick succession; a single shared flag disabled all ~80 dropdowns for each round trip, so the next person you reached for was always greyed out.
- **Names come from the frozen `display_name`, not from the live user fields.** `memberDisplayName()` reads `preferred_name`/`first_name`/`last_name`, which roster records don't have — a `rosterPerson()` shim maps the frozen name onto that shape. Reading the live fields would defeat the freezing.
- **A record whose `member_group` is null says "Group not recorded"**, never "Member". The migration deliberately left the group null on rows that predate freezing rather than stamping today's value, and `formatMemberGroup(null)` returns `'Member'` — which would assert exactly the wrong thing.

---

## Committees

DB-only membership (no Authentik group per committee) — same shape as Group Chats below.

**A committee has no group chat of its own** (changed 2026-08-24). A chat records which committees it belongs to in `committee_ids`, and `membershipPredicate` derives its members from that at READ time — so it follows people joining and leaving with nothing to reconcile.

The old mechanism is fully gone: no auto-created chat, no `committees.group_chat_id` (dropped in `1789200000000`), no `syncGroupChatMembership`, and deleting a committee no longer deletes a chat. It was the same materialise-one-row-at-a-time shape as the Eboard chat automation removed in `1788800000000`, and it was replaced for the same reason.

### `GET /committees`

**Auth required.** All committees, with member count and whether the caller is a member/chair of each.

### `GET /committees/activity`

**Auth required.** Per-committee "what is new for me", backing both the Committees page markers and the sidebar badge:

```json
[{ "committee_id": "3", "new_count": 2, "pending_count": 0 }]
```

- `new_count` — **events and announcements** targeted at that committee, created since the caller last opened it, excluding their own posts. Deliberately **only the caller's own committees**; eboard is *not* `seesEverything` here, or their badge would never be zero.
- `pending_count` — join requests the caller can actually action (eboard anywhere, or chair of that committee), never including their own request. Present for committees eboard is not a member of, since they are the people most likely to clear the queue.

The two are returned separately and only the sidebar adds them: one is news to read, the other people waiting on you.

:::warning Registered above every `/:id` route, and must stay there
Express matches `/:id` against a single segment, so a later `GET /committees/:id` would answer `/activity` with the committee handler and look up a committee whose id is the string `"activity"`. There is no `GET /:id` today — which is exactly why this is worth stating, since the trap only springs when someone adds one. Same failure the homepage-photos `/collections` route hit.
:::

**Both signals already badge other tabs** — a committee event also counts toward Calendar, a committee announcement toward Announcements. That overlap is intended and was chosen explicitly; it is not a double-counting bug to fix.

### `POST /committees/:id/seen`

**Auth required.** Marks one committee read, called when a member opens its detail view — *not* when they open the Committees page. `204` on success, `404` if the committee does not exist.

No membership check, deliberately: the cursor is private to the caller and grants nothing, a row for a committee they are not in is never selected by the activity query, and requiring membership would `403` the legitimate case of eboard opening a committee they do not belong to.

### `POST /committees`

**Eboard only.** `{ "name": "..." }`

### `DELETE /committees/:id`

**Eboard only.** Also deletes the linked group chat.

### `POST /committees/:id/join`

Self-service — adds the caller as `role: "member"` (no-op if already a member).

### `DELETE /committees/:id/leave`

Self-service — removes the caller (and from the linked group chat).

### `GET /committees/:id/members`

Any current member can view.

### `PUT /committees/:id/members/:userId/role`

**Eboard only.** `{ "role": "chair" | "member" }` — auto-adds the target user as a committee member first if they aren't already one.

### Committee slugs

A **slug** is a committee's stable machine name. It is how a feature says "the committee that does X" without hardcoding a committee id or matching on a name eboard can rename. At most **one** committee carries any given slug, enforced by the partial unique index `committees_slug_key` (migration `1789000000000`).

The registry lives in **`services/committeeSlugs.js`** and is the extension point:

| Slug | Grants |
|---|---|
| `pledge` | The [rushee interest form data](#rushee-interest-form-data), the per-rushee profile, the decision-night deck and write-up, and interview signup. |
| `judicial` | The [member report queue](#reports--moderation), including resolving and dismissing reports. |

:::tip Adding a committee-specific feature later is one entry and one migration
Add a key to `COMMITTEE_SLUGS` and gate the new feature on it. Everything else is already generic and reads the registry: `committeeModel.isSlugMember` / `isSlugChair` take the slug as an argument, `GET /committees/slugs` publishes it, and the committees page renders a "no *X* is set" notice for any slug no committee holds — with no website change at all.

The full cost of a third slug is that entry, the permission check in whatever it gates, and a **data migration pointing the slug at a committee**. No column, no new route.
:::

Because the index is unique on the **value**, `pledge` and `judicial` sit on two different committees quite happily. A committee still holds at most one slug, because `slug` is a single column — claiming a second one on the same committee replaces the first.

### `GET /committees/slugs`

**Eboard only.** The registry as `[{ slug, label, description }]`.

It reports which grants **exist** and what each one hands over. It deliberately does **not** report who holds them: `slug` already rides on every committee shape from `GET /committees`, so the website joins the two client-side rather than this becoming a second, staler answer to the same question.

Its one consumer is the committees page, which renders an amber "no *pledge committee* is set" notice for every registry entry no committee holds. That is what makes the "one entry" promise true on the **website** side too — before it existed the page hardcoded `slug === 'pledge'`, so the judicial slug shipped with no notice at all: an unassigned grant that nothing anywhere mentioned.

:::danger There is NO route that writes `committees.slug`, and that is the design
A slug decides who reads every rushee's GPA and the chapter's entire conduct record. It was briefly settable from a switch on the committee detail page. That switch, its `PUT /committees/:id/slug` route, the `PUT /committees/:id/pledge` alias and `committeeModel.setSlug` were **all removed** — if you are reading an older copy of this page describing them, that copy is wrong.

One stray click moved the conduct record to another committee, and nothing downstream could tell that from an intentional change. No confirmation dialog fixes it: the API cannot know which clicks were meant.

The binding changes at **deploy time**, which makes it an act with an author, a diff and a reviewer:

```sql
BEGIN;
UPDATE committees SET slug = NULL       WHERE slug = 'judicial';
UPDATE committees SET slug = 'judicial' WHERE id = <the committee>;
COMMIT;
```

Both statements, in that order, in one transaction. `committees_slug_key` is a **partial** unique index, so moving a slug must clear before it sets: a single `UPDATE` with a `CASE` can fail on a duplicate that only ever existed mid-statement, and a partial unique **cannot be made `DEFERRABLE`** — that applies to constraints, and a partial unique can only be an index. Use one checked-out connection, never `query()` per statement, or `BEGIN` and `COMMIT` land on different pooled sessions and quietly do nothing.

`test/rushInterestData.test.js` and `test/judicialReports.test.js` both assert the write path stays gone. If you are here because you want it back, read `services/committeeSlugs.js` first.
:::

:::warning A migration that assigns a slug must decline to guess
`1789000000000` (pledge) and `1789100000000` (judicial) both seed by name and both do **nothing** unless exactly one committee matches. Zero matches, two matches, a slug already assigned, or a candidate already carrying a different slug all leave every row untouched.

Doing nothing is recoverable: the committees page shows an unmissable notice until somebody sets it. Guessing wrong is not — it silently hands rushee GPAs or the conduct record to a committee that should never have seen them.

**Shipping the code without the assignment migration is the failure mode this whole design exists to avoid.** `can_view_rush_data` shipped switched off and the Rushee Data table was eboard-only for weeks while everyone assumed it worked.
:::

`slug` rides on **every** committee shape, not just an admin one, so the website badges it on the committee card for all members. An access grant nobody can see is one nobody audits — and removing the switch must not also remove the ability to notice it is pointed at the wrong committee.

:::info `can_view_rush_data` still exists, and is dead
Phase 1 of 2. The column is still on the table and still in the projection, so a client mid-deploy does not see the key vanish — but **no permission check reads it any more**. Dropping it is a new migration; `1789000000000` is deployed and therefore frozen.
:::

---

## Rushee interest form data

The questions the chapter used to collect in a Google Form, asked instead on the rushee's profile builder. `GET /rush-data` is the response sheet that replaces it.

:::danger Route order in `routes/rushData.js` is load-bearing
Express matches `GET /:id` against a single segment, so registered first it would also answer `/access` and `/presentation` with the profile handler and go looking for a rushee whose id is the literal string `"access"`. **Every static path stays above the parameterised one.** The file used to say "there is no `/:id` route here today" — there is now. Same trap, same shape, as `/homepage-photos/collections`.
:::

**This router is not under `/admin`**, and that is the whole point of it. `routes/admin.js` carries `requireGroup("eboard")` at the router level, and this surface is deliberately reachable by the pledge committee too — a committee is a Postgres row rather than an Authentik group, so no `requireGroup` call can express the rule. The router applies `requireAuth` plus a `SHARED_ALBUM_GROUPS` floor (**not** `RUSH_ACCESSIBLE_GROUPS` — a rushee must not reach an endpoint returning every other rushee's GPA), and the real decision happens in the controller. Same shape as `committeesController.loadAdministrable`.

**The rule is eboard OR a member of the committee whose `slug` is `'pledge'`.** A union with no deny side. The eboard check runs first and short-circuits the query — they are authorised by definition, so there is no reason to ask Postgres about their committees.

`mayViewRushData` is **the one export every rush-facing surface uses**. The table, the profile, the deck and the write-up all call it rather than re-deriving the rule, so there is exactly one answer to "may this person see rushee data" and it cannot drift between four controllers.

### The four tiers, which are not the same tier

Read this before touching any route below. Collapsing any two of these is the failure mode.

| Surface | Who |
|---|---|
| Rushee profile, interest form, **GPA** | eboard + **any** pledge committee member |
| Decision night deck | eboard + **any** pledge committee member |
| Presentation write-up (**write**) | eboard + the pledge **chair** only |
| Interview notes | eboard + pledge chair + **pledge members who ran that rushee's slot** |

:::danger Rushees never see notes about themselves
Every notes route carries `requireGroup(...SHARED_ALBUM_GROUPS)`, and `"rush"` is deliberately **absent** from that list. `interviewNoteModel` has exactly one consumer. The way this breaks is somebody adding a note field to a rushee-facing projection, or deleting that per-route gate for looking redundant.
:::

### `GET /rush-data`

Every rushee, with their interest form answers, ordered by surname.

`403` rather than `404` for someone without the grant, and the message names who *can*. The existence of rushee data is not a secret to anyone who can see the Rushees tab in the directory; what is restricted is the answers.

Excludes test accounts and deleted rows, like every other people-list. **Keeps rows whose `profile_complete` is false** — this is a funnel, and the rushee who signed up on Tuesday and stopped halfway is the one a chair needs to chase. Filtering them out would make the table disagree with the rushee count on the dashboard.

The projection *is* the CSV export's column list, in the order the Google Form asked its questions, and `test/rushInterestData.test.js` pins its shape. Adding a column here means adding it to the export.

### `GET /rush-data/access`

Answers `200` either way, so asking the question is never itself a failure.

```json
{
  "can_view": true,
  "can_edit_presentation": false
}
```

Its own endpoint rather than letting a client infer the answer from a `403`, for the same reason `GET /interviews/interviewer-schedules` backs the Interviews tab: a nav entry that appears and then `403`s is worse than no nav entry.

**`can_edit_presentation` is split from `can_view` deliberately.** The pledge chair authors the deck and an ordinary pledge member only reads it, so a page handed nothing but `can_view` renders an editor that `403`s on save — and the person finds out after typing.

:::info `pledge_committee` and `pledge_committee_set` were removed 2026-08-24
This endpoint used to also return the pledge committee and a tri-state `pledge_committee_set`, to raise a "No pledge committee is set" banner. **Both are gone, and nothing ever consumed them** — the website mapped them and no component read either one.

The warning they exist for has not gone anywhere; it moved and got wider. The committees page now raises a notice for **every** slug in the registry that no committee holds, by joining [`GET /committees/slugs`](#get-committeesslugs) against the `slug` that already rides on every committee shape. That covers `judicial` and anything added later, which the pledge-only version could not.

Why it matters either way: until a committee is marked, every surface behind that grant is eboard-only and the committee is locked out with nothing explaining why — which somebody debugs as a broken permission. The migration seeds deliberately decline to guess when zero or two committees match, so unset is an *expected* state rather than an error.
:::

### `GET /rush-data/presentation`

**The decision-night deck.** Every rushee with their signup details and their write-up, ordered by display name so the deck is stable between openings — somebody pages back to slide 14 mid-discussion and finds the person they left.

```json
[{ "candidate_id": "…", "candidate_name": "…", "profile_picture_asset_id": null,
   "major": "…", "minors": "…", "gpa": "3.75", "graduation_date": "Spring 2028",
   "heard_from": "…", "presentation_body": null, "presentation_updated_at": null }]
```

Read access, not write: the whole pledge committee watches the meeting, so they can all open it.

:::info The deck is the roster, not the notes table
`findDeck` starts `FROM users` and `LEFT JOIN`s the write-up. The old decision-night query started `FROM interview_notes`, so **a rushee nobody had written about was absent from the meeting entirely** — no slide, and therefore undiscussable. It is also not scoped to an interview round, so a rushee who never booked still gets a slide.
:::

`presentation_body` is **`null`, never `""`**. The authoring tab counts blanks to tell the chair how many rushees are still unwritten, and `""` would be indistinguishable from a real empty save. That is why clearing has its own verb below rather than saving an empty string.

### `GET /rush-data/:id`

One rushee's profile: the interest form, their interview, the rush events they turned up to, and the booking id the notes panel is addressed by.

```json
{ "rushee": { "…": "…" },
  "interview": { "booking_id": "…", "schedule_id": "…", "schedule_title": "…",
                 "startDate": "…", "endDate": "…", "location": null, "interviewers": [] },
  "presentation": { "body": "…", "updated_by_name": "…", "updated_at": "…" },
  "attended_events": [
    { "id": "12", "title": "Info Session", "startDate": "…", "endDate": "…",
      "location": null, "checkedInAt": "…" }
  ],
  "can_view_notes": true,
  "can_edit_presentation": false }
```

`interview` and `presentation` are each **`null` when absent, and neither absence is an error.** A rushee with no booking still gets a profile with the interview section simply missing — the chapter's rule is that no interview means no bid, and that is a fact worth stating rather than a page worth hiding.

`attended_events` is **always an array**, empty rather than absent, and is ordered oldest first so it reads as the rush timeline it is.

:::info `attended_events` is `status = 'present'` only, and an empty list is ambiguous
Excused, absent and never-marked rows all exist in `event_attendance` and none of them appear here — the panel answers "which events did they attend", so widening the filter would change what it claims without changing its heading.

The consequence worth designing around: **an empty list can mean nobody took attendance, not that the rushee came to nothing.** A rushee only lands on a roster for an event whose `audience` includes `rush`, and somebody still has to mark them. The portal's empty state says both, because on decision night "attended nothing" is a damaging thing to imply when the real cause was an officer never opening the roster.
:::

**The notes themselves are not in this response.** The website mounts the existing `InterviewNotes` component, addressed by `booking_id`, which already handles the access tiers and the edit rules. Duplicating them here would mean two projections of the most sensitive table in the product — which is why **no candidate-addressed notes endpoint was built and none is needed.**

:::danger The `404` is a permission answer wearing a `404`
`findRusheeById` carries the **same audience filter** as the table (`member_group = 'rush'`, not deleted, not a test account) rather than being a bare lookup by id. Without it this route would read any user row by id and return a member's, an alumnus's or eboard's date of birth, phone number and GPA. That one `WHERE` clause is the whole boundary; the test suite was proven to go red on both the read and write paths when it was removed.
:::

**`can_view_notes` is computed server-side and is narrower than access to this page.** Render the notes panel only when it is true — a panel that renders and then `403`s tells somebody they have permission right up until they do not. It reuses `interviewsController`'s own predicate rather than restating the rule, so there is one copy and not two that agree until the day one is edited.

### `PUT /rush-data/:id/presentation`

**Eboard or the pledge chair.** `{ "body": "…" }`, capped at `TEXT_LIMITS.PRESENTATION_NOTE` (**3000** — half an interview note, because this is read off a wall). Responds with the row. A `400` carries `field: "body"` so the client can put the length message beside the textarea.

`PUT`, not `POST`: one row per candidate makes the write idempotent by construction, so the client needs no create-versus-update branch. **Last save wins, deliberately** — this is a shared field being prepared collaboratively before a meeting, not a set of attributed opinions, and merging two people's prose is a job for the two people writing it.

Gated **twice**: `requirePledgeManage` on the route and `mayEditPresentation` in the controller. Not redundancy for its own sake — `getRushDataAccess` has to answer "may I edit?" *without* gating on it, so the predicate has to exist as a function anyway, and having the route carry it too means a controller edit alone cannot open the write.

### `DELETE /rush-data/:id/presentation`

**Eboard or the pledge chair.** `204`, or `404` if nothing was written.

Its own verb rather than saving an empty string, because `body` is `NOT NULL` and `""` would be a row that exists and says nothing — which the deck cannot tell apart from a slide somebody is still drafting.

---

## Contact sheet

The chapter's hand-kept spreadsheet of **every member it has ever had**, imported as CSV into `contact_sheet_rows`.

:::warning Narrower than the rest of the portal
Gated on `CONTACT_SHEET_GROUPS` = `["eboard", "chair", "active", "alumni"]`. **Rushees and pledges cannot read it at all.** It holds personal phone numbers, personal emails and Instagram handles for people who have left the chapter, so it is deliberately narrower than `SHARED_ALBUM_GROUPS`.

That constant is written out in full rather than derived by filtering another list. Adding a group to `SHARED_ALBUM_GROUPS` for its own reasons must not silently grant access to everyone's personal phone number.
:::

**It is not the Directory.** The Directory is people *with* portal accounts; this is the whole chapter *including* the people without. That distinction is the only thing justifying two surfaces with overlapping data. If it ever stops being true, one of them should go.

Rows carry **no link to portal accounts**. An earlier version resolved each row to a user by normalised name, with ambiguity handling and an eboard override table; removed on 2026-09-04 because the sheet is a read-only reference. Migration `1790500000000` drops the leftover table.

### `GET /contact-sheet`

Every row, in **sheet order**. `row_index` is data, not presentation: "in order of the spreadsheet" is what somebody checks against when a row looks wrong. The website groups by pledge class for display and preserves this order inside each group.

### `POST /admin/contact-sheet/import`

Eboard only. Body `{ csv, headerRows }`, where `csv` is the file **contents as text** rather than a multipart upload, since nothing is stored on disk. **Replaces every row** in one transaction, so a half-written sheet is never left behind.

Answers `{ imported, sample }`, the sample being the first three rows as parsed. That exists for a specific reason:

:::danger Columns are matched by position, not by header name
The real export's headers are prose written for humans, such as `First Name (Preferred):` and `Additional Social Media/NOTES:`, and they have been reworded before. Matching on those strings would break the import the next time somebody tidies a header, and it would break **silently**, dropping a column rather than failing. Position is the stabler contract; the `sample` is how a human catches a shifted column in the ten seconds after importing rather than weeks later.
:::

Column order: `class_name, first_name, last_name, major, graduation_date, status, phone, personal_email, linkedin_url, instagram, job, notes`.

`headerRows` is **2** for the chapter's real export: row 1 is a confidentiality banner, row 2 the column names. At 1 you import a member called "First Name (Preferred): Last Name:"; at 3 you silently lose the first member. Rows with neither a first nor a last name are skipped, which drops trailing blanks and the unrelated Apps Script tutorial sitting off to the right in columns 13 and beyond. Cells reading `N/A` become null, since rendering "N/A" as a job title is worse than rendering nothing.

## Resumes

A rushee's resume. Uploaded by the rushee, read by them, eboard, or the pledge committee.

### `PUT /resumes/me`

`multipart/form-data` with a **`file`** field. **PDF, `.doc` or `.docx` only**, 10 MB max — the smallest cap of any upload in this API. Returns `{ resume_filename, resume_mime, resume_uploaded_at }`.

Replaces any existing resume, and **unlinks the file it replaced**. Without that, every re-upload would leave bytes on disk that nothing points at.

### `DELETE /resumes/me`

`204`. Clears the columns and removes the file.

### `GET /resumes/:id`

Streams the file. Allowed for the rushee themselves, eboard, or the pledge committee — the same `mayViewRushData` predicate the rest of `/rush-data` uses, so committee membership is read from Postgres rather than from the token.

`?download=1` forces a save dialog. Without it a **PDF** is sent `inline` so it can render in a viewer; a **Word file is always an attachment**, because no browser can render one and offering it inline produces a blank frame rather than an error anyone can act on.

:::warning Two response headers here are load-bearing
`X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox` are set on every response. These bytes were uploaded by a **rushee** — somebody who is not yet a member — and the website proxies them back under its own origin. The website's proxy route forwards both headers explicitly; dropping either would undo the protection in the one place it matters most.

`resume_mime` goes straight into the `Content-Type` header, so a `CHECK` constraint on the column restricts it to the three accepted values in addition to the uploader's `fileFilter`. A column that accepted any string would be one bad write away from serving `text/html` from our own origin.
:::

:::note Uploading is not gated on being a rushee
Any authenticated caller may upload their **own** resume. Someone accepted into a pledge class keeps the `rush` group in Authentik until an admin removes it, so a gate here would revoke their ability to replace their own file on an unrelated admin's schedule, partway through rush. Only the rushee profile surfaces a button.
:::

## Interviews

Calendly-style slot signup that replaced meetings for rushees. Router-level gate is **auth + a rush-accessible group**, then narrowed per route. Full design in [Interviews](../website/interviews.md).

A slot takes **two different claims** against **two different counts**, and confusing them is the main hazard here:

| Claim | Table | Count | Unique per |
|---|---|---|---|
| A rushee **attending** | `interview_bookings` | `capacity` | slot **and round** |
| A member **running** it | `interview_slot_interviewers` | `interviewer_capacity` | slot only |

### `GET /interviews/available`

Published rounds with their slots. Each slot carries seats taken, `mine`, and `booking_id`. **Never returns other candidates' names.**

### `GET /interviews/calendar`

The caller's booked interviews, event-shaped for the portal calendar and ICS feed.

### `POST /interviews/slots/:id/book`

Claim a seat. `409` with `code: "slot_full"` or `"already_booked"`; `404` for an unpublished slot, deliberately identical to a missing one so drafts aren't discoverable by probing ids.

### `DELETE /interviews/bookings/:id`

Yours, or anyone's for eboard + chair. A push goes out only when someone else cancelled it.

### `GET /interviews/interviewer-schedules`

**Members only — never rushees.** Published rounds whose `interviewer_committee_ids` include a committee the caller belongs to. Returns `[]` rather than `403` when there are none.

Each slot carries `interviewer_count`, `interviewers`, `i_am_interviewing`, **and `bookings` — the rushee names.** That is wider than `GET /interviews/available` on purpose: someone about to conduct an interview needs to know who they're meeting. Note that `POST /committees/:id/join` is self-service, so the audience is any member who joins a designated committee.

### `POST /interviews/slots/:id/interviewers`

**Members only — never rushees.** Claims a spot to run the slot. Body is empty for yourself; eboard + chair may pass `{ "user_id": "..." }` to assign someone else.

`403` if your committee isn't designated on the round. `409` with `code: "interviewers_full"` or `"already_signed_up"`.

### `DELETE /interviews/slots/:id/interviewers/:userId`

Withdraw. Yours, or anyone's for eboard + chair. A push goes out only when someone else removed you.

### `GET /interviews/schedules`

**Eboard + chair.** Every round, drafts included, with slot/seat counts.

### `POST /interviews/schedules`

**Eboard + chair.** `{ "title": "...", "description"?, "location"?, "interviewer_committee_ids"? }` — created as a draft.

### `GET /interviews/schedules/:id`

**Eboard + chair.** The full sign-up sheet: every slot, who booked it, and who is running it.

### `PATCH /interviews/schedules/:id`

**Eboard + chair.** Also the publish switch and the committee list. Flipping `published` false → true sends one push to every current rushee; re-saving an already-published round does not.

An absent `interviewer_committee_ids` leaves it alone; an **empty array closes the round** to everyone outside eboard. Anything that is neither, including a bare `"3"` or a list holding one malformed id, is a `400`. It used to be read as the empty array, so a typo shut the round instead of failing.

### `DELETE /interviews/schedules/:id`

**Eboard + chair.** `409` with `code: "has_bookings"` and the count if anyone has booked; `?force=true` overrides and notifies everyone it unbooked.

### `POST /interviews/schedules/:id/slots`

**Eboard + chair.** `{ "starts_at", "ends_at", "location"?, "capacity"?, "interviewer_capacity"? }`. Max 50 seats, 10 interviewers, 500 slots per schedule.

### `PATCH /interviews/slots/:id`

**Eboard + chair.** Only the keys sent are changed, and an explicit `null` **clears** a nullable column rather than being ignored.

`409` if `capacity` is lowered below seats taken, or `interviewer_capacity` below the number signed up. **Neither has a `?force` override** — it's a hard stop. Moving the start time notifies rushees and interviewers separately; changing either count notifies nobody.

### `DELETE /interviews/slots/:id`

**Eboard + chair.** `409` with `code: "has_bookings"` if booked; `?force=true` overrides. Notifies rushees and interviewers with different wording.

---

## Polls

Targeted the same way as Events: an `audience` array and/or a `committee_ids` array, which **ADD rather than narrow**. Voting is self-service. Who voted for what is eboard-only *unless* the poll opted in with `show_voters` — see `GET /polls/:id/stats`.

### `GET /polls`

Visible polls for the caller (or all, if eboard), each with its options, the caller's own selection (`my_option_ids`), and two visibility flags: `results_visible` and `voters_visible`.

**Vote counts are conditional.** `vote_count` on each option and `total_votes` on the poll are present **only when `results_visible` is true** — they are *omitted*, not sent as zero, because a zero on the wire is a lie a client will faithfully render as "0 votes".

| Flag | True when |
|---|---|
| `results_visible` | caller is eboard, OR the poll is closed, OR the caller has voted |
| `voters_visible` | caller is eboard, OR the poll set `show_voters` **and** `results_visible` is already true |

The second condition on `voters_visible` matters: without it, the voter list would let someone reconstruct a tally they are not yet allowed to see.

:::note Until 2026-08-25 this was a UI convention, not a guarantee
"Results are hidden until you vote" lived only in the website's JSX while the API sent counts to every member regardless. Anyone with devtools could read a running tally before voting. It is enforced server-side now. Read `results_visible` rather than re-deriving `is_closed || hasVoted`, so the two cannot drift.
::: `is_closed` reflects either a manual close or `expires_at` having passed — computed fresh on every read, not a stored flag, so it's always accurate even if nothing ever flips it in the DB.

### `POST /polls`

**Eboard only.**
```json
{
  "question": "Best meeting time?",
  "description": "...",
  "options": ["Monday 6pm", "Wednesday 7pm"],
  "multi_select": false,
  "show_voters": false,
  "audience": ["active", "chair"],
  "committee_ids": [],
  "expires_at": "2026-08-01T23:00:00Z"
}
```
`options` needs at least 2. `expires_at` is optional — voting closes automatically at that time with no cron job involved (see `GET /polls` above). Omit for a poll that only closes when eboard manually closes it.

`audience` accepts the same values as an announcement, `rush` included, and rejects anything else with a 400. Rushees vote only in polls that name `rush` explicitly.

`show_voters` is optional and **defaults to false**. It is the per-poll opt-in that lets ordinary members see who voted for what, and it can only be set at creation.

:::danger `show_voters` de-anonymizes individual votes
Turning it on means everyone who can see the poll can see each person's vote once results are shown to them. Every poll created before 2026-08-25 was made under the promise that only eboard could see this, and members voted on that basis — which is why the column defaults to false and existing polls were never migrated to true.
:::

:::note `audience` and `committee_ids` ADD, they don't narrow
Send both and both are kept. `findAllForUser` ORs the audience match against the committee match, so a poll aimed at `["pledge"]` plus the Marketing committee reaches **every pledge and everyone on Marketing** — not just the pledges who are also on Marketing.

Until 2026-08-12 `createPoll` nulled `audience` whenever a committee was set, silently discarding half of what the form submitted and making "roles or committees, pick one" a rule of the API rather than a choice in the UI. Announcements and events had always targeted both together; polls were the outlier.
:::

### `PUT /polls/:id`

**Eboard only.** Edits `question`, `description`, `audience`, `committee_ids`, `expires_at`, and option **labels**:

```json
{
  "question": "Best meeting time?",
  "committee_ids": [3, 7],
  "options": [{ "id": 12, "label": "Monday 6pm" }]
}
```

:::danger Three things are frozen at creation and this cannot change them
`show_voters`, `multi_select`, and **which options exist**. Each would rewrite the terms people already voted under:

- flipping `show_voters` on would publish votes cast while they were private
- going multi-select to single leaves members holding selections the poll now calls impossible
- `poll_votes` rows point at option ids, so removing an option orphans real votes and adding one changes what people were choosing between *after* they chose

Option **labels** can be corrected, because the ids and therefore every vote survive it. That covers the reason people actually want to edit a poll: a typo.
:::

An `options` entry whose `id` does not belong to this poll is a **400**, not a silent no-op — otherwise a stray id would relabel another poll's row.

### `DELETE /polls/:id`

**Eboard only.**

### `PUT /polls/:id/close`

**Eboard only.** One-way manual close, independent of `expires_at`.

### `POST /polls/:id/vote`

Any shared-album-group member. `{ "option_ids": [3] }` — a single id unless `multi_select`. Replaces the caller's entire prior selection for this poll, so calling it again is also how you change your vote while it's still open.

### `GET /polls/:id/stats`

Same per-option counts as the list view, plus a `voters` array (name + id) per option.

**No longer eboard-only.** A member may read it when the poll's `voters_visible` is true for them. The route carries no `requireGroup`, because the decision needs the poll and not just the caller; the check lives in `pollsController.getPollStats`.

For a non-eboard caller, three things must all hold:

1. they can see the poll at all (audience/committee) — otherwise this endpoint would leak the existence *and* voters of polls not aimed at them
2. the poll set `show_voters`
3. the tally is already visible to them

Failing (1) returns **404, not 403**, so this cannot be used to probe which polls exist. Failing (2) or (3) returns 403.

---

## Photos & Albums

Members-only — the general shared album and eboard-created named albums alike. Public photos live in the separate **Homepage Photos** section below, not here. All routes require auth + membership in one of `active`/`chair`/`alumni`/`eboard`/`pledge`.

### `GET /photos?album_id=<id>`

Returns photos in the given album. Omit `album_id` for the general "Shared Album."

### `POST /photos`

Multipart upload, field `file` (images or video, 250MB limit). Optional form fields: `album_id` (puts it in a named album instead of the general shared album), `title`, `caption`.

### `GET /photos/:id/media`

Streams the photo/video from Immich (forwards `Range` headers for video seeking).

### `DELETE /photos/:id`

The uploader can always delete their own photo. **Eboard can delete any photo, in any album** — including the general Shared Album — as a real moderation power. (Previously scoped to only albums an eboard member personally created; broadened so eboard can act on any reported photo, not just their own albums.)

---

### `GET /albums`

Lists eboard-created named albums (e.g. "Spring Retreat 2026"). Any shared-album-group member can view.

### `POST /albums`

**Eboard only.** `{ "name": "...", "description": "..." }`

### `DELETE /albums/:id`

**Eboard only.**

---

## Homepage Photos

The **public** chapter gallery — no auth on reads, anyone can view. Writes are eboard-only. Entirely separate from the member `photos` system above (different audience, different permission model).

### `GET /homepage-photos`

Public. Returns the gallery, ordered by `display_order`.

### `POST /homepage-photos`

**Eboard only.** Multipart upload, field `file`, plus `title`/`caption`.

### `POST /homepage-photos/register`

**Eboard only.** For when someone (e.g. SWE committee) already uploaded straight into the Immich UI — registers an existing asset by id instead of uploading a new one. `{ "immich_asset_id": "...", "media_type": "image", "title": "...", "caption": "..." }`. Validates the asset actually exists in Immich before saving (a typo'd id here previously caused repeated errors on view).

### `GET /homepage-photos/:id/media`

Public. Streams the photo/video.

### `PUT /homepage-photos/reorder`

**Eboard only.** `{ "ids": [3, 1, 2] }` — sets `display_order` to match array position.

### `PUT /homepage-photos/:id`

**Eboard only.** Edits `title` / `caption` in place: `{ "title": "...", "caption": "..." }`. Before this existed, fixing a typo meant deleting the item and re-uploading the file.

An omitted key is left alone; an explicit `null` or `""` clears that field. The asset and `media_type` are immutable — re-register to change those.

:::note Route order matters here
`/reorder` is registered **above** `/:id`. Express matches in registration order, so flipping them makes the parameterised route swallow `/reorder` and attempt to edit a photo whose id is the string `reorder`.
:::

### `DELETE /homepage-photos/:id`

**Eboard only.** Only unlists the photo from the gallery — does **not** delete the underlying Immich asset, since a registered asset might be reused elsewhere.

### `GET /homepage-photos/collections`

**Public.** Named groups over the gallery, each with its photos nested. `?featured=true` returns only the collections eboard put on the homepage, capped server-side.

Ordered by `display_order`, then `event_date` newest-first, then `id`. `event_date` is what makes it chronological — `created_at` would file last autumn's photos under the semester they were uploaded in. An undated collection sorts **last**, since it is unplaced rather than ancient.

:::note The `featured` cap is a performance rule
`/homepage-photos/:id/media` streams the **original** asset and there is no thumbnail variant, so every collection added to the landing page makes it permanently slower. The homepage takes the featured few; the website's `/gallery` page carries the full archive.
:::

### `GET /homepage-photos/collections/manage`

**Eboard only.** The same list with `photo_count` in place of the photos — the management screen renders a number, and fetching every asset id to display one is waste.

### `POST` / `PUT` / `DELETE /homepage-photos/collections`

**Eboard only.** `{ title, subtitle?, event_date?, link_url?, link_label?, is_featured? }`. `PUT` is partial: an omitted key is left alone, an explicit `null` clears it.

`link_url` must be **https**, checked with `services/urls.js` and not merely `new URL()` — this becomes an `href` on a public page, the widest audience any link in this codebase gets. A `link_label` with no `link_url` is refused, since it would render a button that goes nowhere.

`DELETE` answers **409** with `code: "has_photos"` and a `photo_count` unless `?force=true`. Deleting a collection **takes its photos with it** (`ON DELETE CASCADE`); the Immich assets survive.

:::warning Route order, not style
`PUT /homepage-photos/:id` matches a single path segment — so it also matches `/collections`. Registered first it silently swallows `PUT /homepage-photos/collections` and tries to update a photo whose id is the string `"collections"`. Every `/collections` route sits **above** the `/:id` routes in `routes/homepagePhotos.js`, and there is a test asserting it, because Express gives no warning and the mistake is invisible in a diff that appends a route.
:::

---

## LinkedIn Posts

Chapter LinkedIn posts, ingested from a Discord channel by the [LinkedIn embed bot](../website/linkedin-spotlight.md) and rendered on the public homepage and `/spotlight`.

### `GET /linkedin-posts`

**Public, no auth.** Published posts, newest first. `?limit=` is accepted and **capped at 50** in the model, defaulting to 24 — this is the one unauthenticated route here, and an unbounded limit would be a table scan anybody on the internet could ask for.

**Posts older than six months are excluded**, measured from the LinkedIn post's own publication date, which is decoded from its id (a snowflake whose high bits are a Unix ms timestamp). Nothing is deleted or unpublished to achieve that — it is a filter, so widening the window restores everything. Ordering is by publication date, not `created_at`.

Returns the public shape only: `id`, `linkedin_post_id`, `linkedin_urn`, `source_url`, `embed_url`, `created_at`. **`discord_message_id` and `submitted_by_discord_id` are deliberately withheld** — a visitor reading the homepage has no business knowing which member posted a link in Discord.

### `POST /linkedin-posts/ingest`

**The Discord bot only**, authenticated with the shared `X-Bot-Secret` header rather than a bearer token. `{ linkedin_urn, source_url, discord_message_id, submitted_by_discord_id }`.

The server **derives** `linkedin_post_id` and `embed_url` from the URN rather than trusting the bot's copies. Upserts on `linkedin_urn`, so re-scanning the channel history on every restart creates no duplicates.

:::warning LinkedIn IDs are TEXT everywhere, never numbers
They are 19 digits, past `Number.MAX_SAFE_INTEGER`. One `parseInt` silently corrupts the ID and the resulting embed 404s. The column is `VARCHAR`, the validator refuses a numeric input outright, and the tests say so.
:::

### `DELETE /linkedin-posts/ingest`

**The Discord bot only.** `{ discord_message_id }`. Unpublishes every post that came from that message; answers `{ "unpublished": n }`.

**Addressed by MESSAGE ID, not by URN**, and that is what makes it work at all. A deleted message reaches the bot as a *partial* — Discord does not resend content the bot never cached, so for anything posted before the process started there is no link left to parse. The message id is always on the delete event and is already stored on the row.

**Answers `200` with a count of `0` rather than `404` when nothing matched.** The bot fires this for every deletion in the channel, because it cannot know whether a message it never saw held a link; a `404` would fill its log with errors describing ordinary behaviour.

**Unpublishes, never deletes.** The row is the only record that a link was submitted and by whom, so a mistaken Discord deletion stays recoverable from the admin panel.

### `GET /linkedin-posts/all`

**Eboard.** Every post including unpublished ones, plus the Discord trace the public shape withholds. Also returns **`posted_at`** (the decoded publication date), **`is_too_old`** — without which the panel would label an aged-out post "Live" while the site does not show it — and **`unavailable_at`** / **`last_checked_at`**, which the panel uses to distinguish "checked and healthy" from "never checked".

### `POST /linkedin-posts/check-availability`

**Eboard.** Runs the availability probe now instead of waiting for the scheduled worker, and returns `{ summary, posts }` where `posts` is the refreshed `/all` list.

`POST` rather than `GET` because it has real side effects: it writes `last_checked_at` and can set or clear `unavailable_at`. It re-probes regardless of freshness (`staleAfterMs: 0`) and is capped at **15 posts**, deliberately below the worker's `MAX_PER_RUN` of 40, because a caller is waiting on the response and the 1.5s spacing would otherwise make it a 60-second request. See [Checking on demand](../website/linkedin-spotlight.md#checking-on-demand).

### `PUT /linkedin-posts/:id`

**Eboard.** `{ "is_published": true | false }` — an explicit boolean, nothing else. A missing or mistyped key is a `400` rather than being read as "unpublish", because taking a post off the public site in response to a malformed body is the one failure direction that cannot be allowed here.

:::note Route order is load-bearing
`/all` and `/ingest` are literal paths that `/:id` would also match. Registered the other way round, `GET /all` would be handled as "the post whose id is the string `all`". Same trap documented on `/rush-data` and `/homepage-photos`.
:::

## Documents

A file library (bylaws, meeting minutes, course files) shown in the Files & Photos portal tab. Not Immich — arbitrary file types stored on ktp-api's own disk. View: any shared-album-group member.

**Writes have three tiers.**

| Tier | Groups | May |
|---|---|---|
| Contributors | `DOCUMENT_CONTRIBUTOR_GROUPS` — `eboard`, `chair`, `active`, `alumni` | upload a file, add a link, **create a folder** (unrestricted only), and **rename or delete a row they added** |
| Cabinet | `eboard`, `chair` | the above, plus **move** folders and documents, rename folders, and rename **anyone's** document |
| Eboard | `eboard` | everything, plus delete **anyone's** row, delete folders, and set visibility |

Rename and delete both route through `ownsOrManages(req, document, managerGroups)` in `documentsController`, with **different manager lists on purpose**:

| | own row | someone else's row |
|---|---|---|
| `PATCH /documents/:id` | yes | `eboard` + `chair` — housekeeping |
| `DELETE /documents/:id` | yes | `eboard` only — it destroys |

A chair renaming another member's file while failing to delete it is the pair that pins that difference down; `test/documentOwnership.test.js` asserts both.

Pledges read the library but do not contribute to it; rushees never reach the router at all.

:::note Folder upload adds no endpoint
The portal's **Upload Folder** button is a client-side composition of `POST /documents/folders` and `POST /documents` — no bulk endpoint, no transaction. It is therefore **cabinet-only**, because folder creation is: the two cannot disagree without showing members a button that 403s on its first step. See [Uploading a folder](../website/photos-and-documents.md#uploading-a-folder).
::: Folder deletes cascade whole subtrees, and visibility is the access-control surface itself, so both stay with eboard.

:::warning `DOCUMENT_CONTRIBUTOR_GROUPS` is spelled out, not derived
It is *not* written as "`SHARED_ALBUM_GROUPS` minus `pledge`", on either side of the stack. A group added to `SHARED_ALBUM_GROUPS` later is being granted **read** access to photos and documents; deriving the contributor list from it would hand that group **write** access silently, and a list whose job is to gate writes must not widen by accident.
:::

Only eboard is covered by `seesEverything`, so every add, move and delete handler checks that the folder or document is one the caller can actually **see** (`documentFolderModel.findVisibleById`, `findViewableDocument`), not merely that it exists. A target the caller may not see returns **404, not 403** — a 403 would confirm a restricted folder exists, which is the same reasoning as the download guard.

:::caution A document override cannot widen access
The effective audience of a document is **its folder's audience ∩ its own**. The folder gates navigation (documents are only ever listed by folder) while the document's override gates the row, so restricting a file to a group that is not already in its folder's audience leaves it visible to eboard alone. An override narrows, never widens.
:::

### `GET /documents/folders?parent_id=<id>`

Lists subfolders of `parent_id` (omit for the top level).

### `POST /documents/folders`

**Any member except pledges.** `{ "name": "...", "parent_id": null }` — folders nest to any depth. A non-eboard caller that sends a non-empty `audience`/`committee_ids` gets a **403** rather than having it quietly dropped: silently ignoring it would tell them their folder is restricted when every member can see it. A non-eboard caller also gets **404** (not 403) for a `parent_id` they cannot see.

:::note Tied to the file upload, not independently chosen
This is open to the same groups as `POST /documents` **by necessity**, not by separate policy: the portal's Upload Folder walks a picked directory and creates a folder per level, so gating the two differently shows members a button that 403s on its first step. Open or close them together.

Folder **deletion** stays eboard-only regardless, and that asymmetry is deliberate — creating a folder adds an empty container, deleting one cascades the whole subtree including other people's files.
:::

### `PATCH /documents/folders/:id/visibility`

**Eboard only.** `{ "audience": [...], "committee_ids": [...] }`.

### `PATCH /documents/folders/:id/parent`

**Eboard + cabinet.** `{ "parent_id": 3 }`, or `null` to move the folder back to the top level. Visibility is untouched — a folder keeps its own audience wherever it sits.

**Cycle-guarded.** Moving a folder into itself or into any of its own descendants is a **400**. Without that guard the subtree is detached from the root permanently: the UI only ever walks *down* from the root, so there is no path back to it. The check is a recursive CTE (`documentFolderModel.isDescendant`) whose seed row is the folder itself, which is what makes the self-move case fall out of the same query.

### `DELETE /documents/folders/:id`

**Eboard only.** Cascades subfolders and document rows in the DB, and also walks a recursive query to delete every nested file from disk (disk space on this server is limited — DB cascade alone would leave orphaned files).

### `GET /documents?folder_id=<id>`

Lists documents in `folder_id` (omit for the top level).

### `POST /documents`

**Any member except pledges** — `DOCUMENT_CONTRIBUTOR_GROUPS`, i.e. `eboard`, `chair`, `active`, `alumni`. Multipart upload, field `file` (any file type, 50MB limit), form field `folder_id` (omit for the top level).

`folder_id` is validated as an integer id and checked for visibility before the insert. Multer has already written the file to disk by the time the handler runs, so every rejection path unlinks it (`discardUpload`) instead of leaving an orphan behind — disk on this server is limited.

### `GET /documents/:id/download`

Streams the file with `Content-Disposition: attachment` and the original filename.

### `GET /documents/:id/preview`

Same file, but `Content-Disposition: inline` — used for the in-portal preview (images render inline, PDFs in an `<iframe>`) instead of forcing a download.

### `POST /documents/link`

**Any member except pledges**, same group as the upload above. An external hyperlink (Google Docs/Slides/Sheets, or any URL) shown alongside real files in the same folder tree — no file on disk. `{ "folder_id": null, "filename": "Meeting Notes", "url": "https://docs.google.com/..." }`. Every document row now carries `kind: "file" | "link"` — link rows have `url` set and no `mime_type`/`file_size`/`storage_path`.

### `PATCH /documents/:id/visibility`

**Eboard only.** `{ "audience": [...], "committee_ids": [...] }`. An **empty body means inherit the folder** — a document is the one place where NULL does not mean "everyone". Sending empty arrays instead is an explicit override meaning *everyone*, which inside a restricted folder is a leak.

### `PATCH /documents/:id/folder`

**Eboard + cabinet.** `{ "folder_id": 3 }`, or `null` to move the document out to the top level. The audience columns are deliberately left alone: an inheriting document re-points its inheritance at the new folder, and one with an explicit override keeps that override.

Note the consequence — moving an inheriting document into a more restricted folder silently shrinks who can see it.

### `PATCH /documents/:id`

**The uploader for their own row; eboard and cabinet for any row.** `{ "filename": "March Minutes.pdf" }`. Renaming is grouped with moving rather than with delete and visibility, on the same reasoning: it destroys nothing and it changes nobody's access. Members get it over their own uploads because someone who uploads `Scan_20260817.pdf` should be able to call it `Fall Dues Receipt` without finding a chair.

Same two-failure split as `DELETE` below — **404** if the caller cannot see the document, **403** if they can see it but did not add it and are not cabinet. Body validation runs *before* the lookup, so a blank or over-long name is a **400** whoever sends it; that leaks nothing, since it is the same answer for an id that does not exist.

Folder renames (`PATCH /documents/folders/:id`) stay **cabinet-only** — a folder has no uploader, so there is no "their own" for a member to have.

This renames the **display name only**, for uploads and links alike (`filename` is the label for both). `storage_path` is deliberately untouched, so the file on disk keeps the name it was stored under and every existing download keeps working.

:::note Renaming an upload can strip a useful extension
`mime_type` is what drives the in-portal preview, so preview survives a rename to `"March Minutes"` with no `.pdf`. The **download** does not: the member's own OS has nothing to open it by. The portal's rename dialog preselects only the basename so the extension is left in place by default, but the endpoint itself does not enforce one.
:::

### `PATCH /documents/folders/:id`

**Eboard + cabinet.** `{ "name": "Fall 2026 Resources" }`. Rename only; audience and parent are untouched. Like every cabinet-writable route here it checks the folder is one the caller can **see** and answers `404` rather than `403` when it is not.

### `DELETE /documents/:id`

**The person who added the row, or eboard for any row.** Removes the DB row and, for `kind: "file"` rows, unlinks the file from disk (link rows have nothing on disk to clean up).

This is the one document route whose answer the router cannot decide on its own — it depends on who uploaded the row — so `requireGroup` only establishes that the caller is a contributor, and ownership is enforced in the controller.

:::warning Two different failures, deliberately
**Visibility is checked before ownership.** A document the caller cannot *see* answers **404**; one they can see but did not add answers **403**.

Answering 403 in the first case would confirm that a document exists inside a restricted folder to anyone willing to walk the ids, which is exactly what the audience model exists to prevent. The consequence to expect: a member's own upload becomes a 404 to them once eboard moves it into a folder they cannot see.

A `NULL` `uploaded_by` — the uploader's account was hard-deleted — matches nobody rather than matching a caller whose id came through undefined, so those rows are eboard-only.
:::

---

## Announcements

One-way broadcast, no replies. Any rush-accessible member can view (filtered by audience). Same targeting shape as Events: `audience` is an array, or scope to one `committee_id` instead.

**Who may post, as of 2026-09-04:**

| Caller | May create | May edit / delete |
|---|---|---|
| Eboard | anything, including chapter-wide | anything |
| **Committee chair** ("cabinet") | **anything, including chapter-wide** | **only what they posted, or their own committee's** |
| Everyone else | nothing | nothing |

:::warning Cabinet gained reach, not authority over other people's posts
Until 2026-09-04 a chair could only post to a committee they chaired. That restriction was deliberate and was **removed on purpose** — cabinet now has the same reach as eboard for *creating*. What did not change is editing and deleting: a chair still cannot touch somebody else's announcement, eboard's included.

This asymmetry is why `checkAnnouncementPermission` was split into **`checkAnnouncementCreate`** and **`checkAnnouncementMutate`**. One function serving both could not be loosened for create without also loosening it for editing other people's posts.
:::

:::danger The `posted_by` arm is load-bearing
A chapter-wide announcement has `committee_id NULL`, so the committee arm of `checkAnnouncementMutate` can **never** match it. Without the `posted_by` arm, a chair could publish to the entire chapter and then be locked out of editing or retracting their own post — something only eboard could take down. The same applies to `created_by` on events.
:::

This mirrors the Events rule on purpose (`checkEventCreate` / `checkEventMutate`). If either changes, change both — the same person being able to reach the whole chapter one way but not the other is worse than either rule alone.

Editing checks **two** things: may you touch this row at all, against the row as it stands; and may you move it there, against what the request sets. With only a target check, a chair could capture any committee's announcement by re-pointing it at their own.

Deleting a single media item follows the same rule as editing the announcement, so a chair is never left able to delete a whole post but not one photo from it.

### `GET /announcements`

Returns announcements visible to the caller: `audience` empty/null (everyone), `audience` overlaps the caller's Authentik groups, or the caller belongs to the announcement's `committee_id`. Eboard sees every announcement unfiltered.

### `POST /announcements`

**Eboard only.** `{ "title": "...", "body": "...", "audience": ["active", "chair"], "committee_id": null }` — omit/empty `audience` (and no `committee_id`) to send to everyone.

Valid `audience` values are `eboard`, `chair`, `active`, `pledge`, `alumni` and **`rush`**; anything else is a 400 rather than being stored, since a typo would match nobody and be invisible until somebody asked why they could not see it. **"Everyone" means every member, not everybody**: the untargeted branch requires a member group, so a rushee sees an announcement only when `rush` is named explicitly. This is the same rule the Rushee pill in the portal's audience picker exists to make obvious.

### `PUT /announcements/:id`

**Eboard only.**

### `DELETE /announcements/:id`

**Eboard only.** Cascades the announcement's media rows and deletes their Immich assets.

### Photos, videos and links

Both announcement boards carry up to **10** photos or videos and up to **5** labelled links, added on migration `1788600000000`.

`POST` and `PUT` answer **both `application/json` and `multipart/form-data`** — multer leaves a non-multipart request untouched, so the plain JSON path is unchanged for posts that carry nothing. Files ride in a `media` field; up to 100 MB each; JPEG, PNG, WebP, HEIC, MP4, MOV and WebM.

:::warning Multipart turns every field into a string
`audience` and `links` are JSON-encoded into the form body and parsed back by a shim on the API. Send them as anything else and the error you get names the audience, not the encoding.
:::

:::info Uploading is part of the create request, not a follow-up call
`createAnnouncement` responds and *then* fires push and email. A two-step upload notifies the chapter about a post whose photos have not arrived yet. Files reach Immich **before** the row is inserted and are **all-or-nothing** — if one of five fails the other four are deleted and nothing is posted.
:::

| Method | Path | Notes |
|---|---|---|
| `GET` | `/announcements/media/:mediaId` | The bytes. `?size=thumbnail\|preview` for tiles; Range headers forwarded so video seeks |
| `DELETE` | `/announcements/media/:mediaId` | Eboard only. New files **append** on `PUT`, so this is the only way media comes off |
| `GET` | `/rush-announcements/media/:mediaId` | Same, and open to **rushees** — a photo on a rush announcement is for them |
| `DELETE` | `/rush-announcements/media/:mediaId` | Eboard + chair |

Both boards share one `announcement_media` table with **two nullable foreign keys and a CHECK that exactly one is set**, rather than a polymorphic `parent_type`/`parent_id` pair Postgres could not enforce. Each endpoint refuses ids belonging to the other board with a **404**.

`asset_id` is never returned to a client. Bytes come through the media route, which re-asks the same visibility SQL the list read uses, so a photo on a committee-only announcement cannot outlive the rule it was posted under. **404, not 403** — the ids are sequential.

Links are `[{ label, url }]`, validated by `services/linkList.js`, shared with profile links. The URL is judged by **protocol**: `new URL()` is not a check, since it parses `javascript:alert(1)` without complaint.

---

## Messages (Direct Messages)

Any member can message any other member — no membership list, unlike Group Chats below.

**Safety features, both here and in Group Chats:** message bodies are checked against a basic content filter (`services/contentFilter.js`, wraps the `bad-words` package — **pinned to v3**, v4 ships broken CJS packaging that can't be `require()`'d from this project) and rejected with `400` if flagged. Sending is rate-limited to 20 messages/minute/user (`middleware/rateLimit.js`, in-memory, no Redis) — a `429` means slow down, not a real error. Blocking (see Users above) also applies: `POST /messages` 403s if either party has blocked the other, and a blocked user's messages are filtered out of `GET /messages/conversations` and `GET /messages/conversations/:userId` for whoever did the blocking.

### `GET /messages/conversations`

Returns one entry per person the caller has exchanged messages with: their basic info, the last message, and an unread count — sorted by most recent activity.

### `GET /messages/conversations/:userId`

Full thread with that specific user, chronological.

### `POST /messages`

**Multipart**, not JSON — fields `recipient_id`, `body`, `file`, `reply_to_id`. Either `body` text *or* a `file` attachment is required; both together is fine. Attachments cap at 25MB.

Image attachments go to Immich, everything else to ktp-api's own disk under `uploads/message-attachments/` — `services/messageAttachments.js` decides per-file by mimetype.

#### Replies

`reply_to_id` points at another message and makes this one a reply. Every read of a message carries a `reply_to` object (or `null`) with the parent's `id`, `sender_id`, `sender_display_name`, `body` and `attachment` — enough to render a quote without a second fetch. The send response already includes it, because the insert is a CTE that left-joins the parent and its sender.

**The target is validated against the conversation, not just its id.** A DM reply must reference a message in that exact two-person thread; a group-chat reply, a message in that same chat. Anything else is a `400`.

This is a **disclosure guard, not a tidiness check.** A bare integer id would otherwise let someone reply to a message in a conversation they cannot see and read its body and sender back out of their own reply preview.

**`reply_to_id` is `ON DELETE SET NULL`.** Deleting a message leaves its replies in place with `reply_to: null` rather than deleting them. CASCADE would let a single delete remove unrelated messages, and would make a thread containing a deleted parent impossible to moderate.

### `PUT /messages/conversations/:userId/read`

Marks every message from `:userId` to the caller as read.

### `GET /messages/unread-count`

Total unread count across all of the caller's conversations. Backs the sidebar badge.

### `GET /messages/:messageId/attachment`

Streams the attachment. The caller must be the sender or the recipient.

### `POST /messages/:messageId/reactions`

`{ "emoji": "👍" }` — **toggles**. Sending the same emoji twice removes it.

### `DELETE /messages/:messageId`

A sender can always delete their own message. Eboard can delete any message within a conversation they're already part of.

---

## Group Chats

Named chats with an assigned member list, created either by eboard (official) or by any member except a rushee (private). Access is gated by actual DB membership (`group_chat_members`), not a broad Authentik group, so most routes below check membership inline and return **403** if the caller isn't in that specific chat. Same content filter + rate limit as Direct Messages above. Blocking doesn't stop someone from posting in a shared group chat (they're a legitimate member) — it filters their messages out of `GET /group-chats/:id/messages` for whoever blocked them, same idea as the DM thread filtering.

### `GET /group-chats`

Chats the caller is a member of, with last message + unread count.

### `POST /group-chats`

**Eboard only.** Creates an **official** chat. `{ "name": "...", "member_ids": ["uuid", "uuid"], "audience": [...], "committee_ids": [...] }` — the creator is automatically added too, so eboard isn't locked out of a chat they just made.

### `POST /group-chats/member`

**Currently returns `403` for everyone** — creation is switched off at the route by `MEMBER_CHAT_CREATION_ENABLED = false` in `routes/groupChats.js`, ahead of the controller. Existing member-created chats are unaffected. See [Messaging](../website/messaging.md#member-created-chats) for the matching website flag that has to be flipped with it. The rest of this entry describes the behaviour when it is on.

**Any member except `rush`.** Creates a **member-created** chat (`is_member_created = TRUE`), invisible to eboard oversight and administered by its creator alone.

`{ "name": "...", "member_ids": ["uuid", "uuid"] }`. No `audience` or `committee_ids` is accepted — a member's chat is exactly the people they picked, and one that auto-followed a whole group would be a broadcast channel. **400** if any id belongs to a rushee, **404** if any id has no live account.

The allowed groups are a *positive* list (`eboard`, `chair`, `active`, `alumni`, `pledge`), never "not `rush`": an accepted rushee keeps the `rush` group in Authentik until someone removes it, so an exclusion rule would lock real members out while that stale group lingers.

### `PATCH /group-chats/:id`

**Administrator only** (see the note below). Renames the chat. `{ "name": "..." }` — **400** on a blank or whitespace-only name, which leaves the old name in place.

Works on every chat type, committee chats included. A committee chat's name is not re-derived later: it is named once at creation and there is no committee update function anywhere.

### `DELETE /group-chats/:id`

**Administrator only** (see the note below). Cascades members, messages, and read markers.

### `DELETE /group-chats/:id/leave`

Removes **the caller** from the chat. The one roster change that needs no administration right, which is why it isn't `DELETE /:id/members/me` — that path would be matched by the `:userId` route and inherit its check.

**409** if you're in the chat via its audience or a committee (there'd be no row to delete, so it would report success and change nothing), or if you created a member chat (nobody else could administer it afterwards — delete it instead). **403** if you aren't in the chat.

### `GET /group-chats/:id/messages`

Full thread — **403** if the caller isn't a member of this chat.

### `POST /group-chats/:id/messages`

**Multipart**, same `body`-or-`file` rule as direct messages, and the same optional `reply_to_id` ([Replies](#replies)) — scoped to this chat, so a message id from another chat is a `400`. **403** if not a member.

### `PUT /group-chats/:id/read`

Marks the chat read for the caller.

### `GET /group-chats/unread-count`

Unread count across every chat the caller belongs to.

### `GET /group-chats/:id/messages/:messageId/attachment`

Streams the attachment. Must be a member of the chat.

### `POST /group-chats/:id/messages/:messageId/reactions`

`{ "emoji": "👍" }` — toggles, same as DMs. Must be a member.

### `DELETE /group-chats/:id/messages/:messageId`

Sender, or eboard within a chat they belong to.

### `PUT /group-chats/:id/photo`

**Eboard only.** Multipart, field `file` — the chat's avatar. Shares the profile-picture uploader, so it accepts the same formats up to **25MB** and is likewise **normalized to a resized JPEG** on upload (see [`PUT /users/me/profile-picture`](#put-usersmeprofile-picture)). `GET .../photo/media` streams the original asset back, so the conversion is what keeps a phone-camera upload from rendering broken outside Safari.

### `GET /group-chats/:id/photo/media`

Streams the chat avatar. Must be a member.

### `GET /group-chats/:id/members`

Any current member can view the participant list.

### `POST /group-chats/:id/members`

**Administrator only.** `{ "user_id": "uuid" }`

### `DELETE /group-chats/:id/members/:userId`

**Administrator only.** **409** if the target belongs via the audience or a committee, since deleting their row would remove nothing.

:::note "Administrator" depends on the chat, not on your groups
| Chat | Administrator |
|---|---|
| Official (`is_member_created = FALSE`) | eboard |
| Member-created (`is_member_created = TRUE`) | its `created_by`, and **not** eboard |

This covers `PATCH /:id`, `DELETE /:id`, `PUT /:id/photo`, `PATCH /:id/audience`, `POST /:id/members` and `DELETE /:id/members/:userId`. None of them carries `requireGroup` at the router, because a router-level group check can't express "unless a member made it" — the answer depends on the row, so it's checked in the controller. `created_by` confers nothing on an official chat.

`PATCH /:id/audience` additionally returns **409** on a member-created chat, even for its creator: groups and committees are official-targeting concepts.
:::

:::note Two chats are managed automatically
Committees do not own a group chat. Scope a chat to a committee with `committee_ids` and its membership is derived at read time: there is nothing to sync and nothing to manage by hand.

There used to be a singleton Eboard chat re-synced on every login. **It was removed in migration `1788800000000`** — see [Messaging](../website/messaging.md#the-eboard-chat-was-removed).
:::

---

## Tickets

Any member telling eboard and the judicial committee **anything**: concerns, suggestions, questions. Requires auth plus a `SHARED_ALBUM_GROUPS` floor — deliberately not `RUSH_ACCESSIBLE_GROUPS`, since a ticket is a channel to the chapter's own leadership and a rushee is not a member of the chapter.

:::info Why this is not the reports table
`reports` is a **moderation record**: it points at a person or a piece of content, `content_type` is NOT NULL and CHECKed against four values, and its statuses are open/resolved/dismissed. A ticket points at nothing and often is not a complaint at all.

Reusing the table would have meant widening two CHECK constraints that are doing real work, and putting *"here is an idea for spring rush"* in the same queue as *"somebody is harassing me"* — where the urgent thing gets buried and "dismissed" becomes the word for declining a suggestion.
:::

| Method | Path | Who | Body / notes |
|---|---|---|---|
| `POST` | `/tickets` | any member | `{ category, subject, body, anonymous? }`. `category` is one of `concern`, `suggestion`, `question`, `other`. `subject` ≤150, `body` ≤5000 |
| `GET` | `/tickets` | eboard or judicial | Optional `?status=open\|in_progress\|closed` |
| `GET` | `/tickets/mine` | any member | Their own **signed** tickets only |
| `GET` | `/tickets/access` | any member | `{ can_view }`, for deciding whether to render the queue |
| `PUT` | `/tickets/:id` | eboard or judicial | `{ status?, response? }` |

### Anonymous by default

:::warning This is the OPPOSITE default to `POST /reports`
A ticket exists to collect candid feedback, and defaulting to named suppresses exactly that. A report defaults to **named** because the board usually needs to follow up.

**Only an explicit `false` signs a ticket.** Anything else — a missing key, a typo, a string — stays anonymous, which is the failure direction that cannot expose somebody who meant to stay unnamed.

Two surfaces, two defaults, deliberately. Do not "make them consistent" without deciding which behaviour you are changing.
:::

`/^\/tickets$/` is in `middleware/auditLog.js`'s SKIP list. That matters **more** here than for reports, precisely because anonymity is the default: without it, every anonymous ticket would have a matching audit row naming whoever filed it. The pattern is an exact match, so `PUT /tickets/:id` is still logged in full.

### `is_anonymous` is a real column, not an inference

`author_id` being NULL does **not** mean anonymous on its own. `ON DELETE SET NULL` empties that column when a signed author leaves the chapter, so inferring anonymity from it would relabel a departed member's signed ticket as "Anonymous" — a false statement about somebody who did put their name to it.

`GET /tickets` therefore returns three distinguishable states:

| `is_anonymous` | `author` | `author_departed` | Means |
|---|---|---|---|
| `true` | `null` | `false` | Nobody was ever recorded |
| `false` | object | `false` | A signed ticket |
| `false` | `null` | `true` | Signed, but the author has since left |

### Accepted costs

An anonymous ticket **can never be replied to**, and the person who filed it **cannot read it back** — `findForAuthor` matches on `author_id`, and there isn't one. The form states both plainly rather than burying them.

Read access reuses `reportsController.mayModerateReports` rather than restating it, so the bare `chair` group is refused here too. Accepting it would hand the social chair every concern in the chapter.

---

## Reports & Moderation

App Store safety requirement (reporting/blocking/moderation for an app with user-generated content). Submitting a report is self-service; reviewing the queue is **eboard or the judicial committee**.

There is no separate "moderator" Authentik group and there is deliberately no attempt to invent one. The rule is expressed as `reportsController.mayModerateReports`, which is eboard **or** a member of the committee carrying [`slug = 'judicial'`](#committee-slugs) — because which committee is the judicial committee is a Postgres row, not a group, so no `requireGroup` call can say it.

:::danger Not the bare `chair` group
`chair` is an Authentik group worn by the chair of **every** committee. Accepting it here would hand the social chair every conduct report in the chapter. That is not hypothetical — it is the exact bug found in `interviewsController`'s `MAY_MANAGE`, where it had been live for two weeks. `test/judicialReports.test.js` pins it.
:::

The **whole** judicial committee, not only the chair. Code of Conduct Section 17 makes the Judicial Board an independent body that arbitrates, with the Chair handling situational discipline; a board that cannot read the matter it is convened to decide would have the chair relaying report contents by hand, which is its own confidentiality problem.

**Fails closed** when no committee carries the slug: eboard still gets through, nobody else does. The opposite polarity would open every report in the chapter to every committee member for as long as the slug went unset.

### `POST /reports`

Any rush-accessible member. `{ "content_type": "user" | "message" | "group_message" | "photo", "content_id": "...", "reported_user_id": "uuid", "reason": "...", "explanation": "..." }`.

`reported_user_id` is trusted from the client (the UI reporting a message/photo/profile already knows who authored it) rather than re-derived server-side — content spans three different tables, not worth a per-type lookup just to double-check what the caller already knows. It is trusted as to *whose* id it is, though, not as to its shape.

| Field | Rule |
|---|---|
| `content_type` | One of the four; anything else is a 400 |
| `content_id` | A **positive integer** within int4 range — every reportable table (`messages`, `group_chat_messages`, `photos`) is `SERIAL`. Required for all types except `"user"`, which must not send one |
| `reported_user_id` | A canonical UUID. Required for `"user"` (it is the only thing naming the subject), optional otherwise. **404** if it names an account that no longer exists |
| `reason` | Required, ≤100 characters |
| `explanation` | Optional, ≤2000 characters |
| `anonymous` | Optional bool. `true` or `"true"` files anonymously; **anything else files NAMED** |

`reason` and `explanation` are **rejected rather than truncated** when too long: a report is evidence, and a silently shortened account of what happened is worse than being asked to shorten it yourself.

`content_id` is validated because the column is loose `TEXT` shared across three tables, so the database will hold any string — see [Group chats](../website/messaging.md#the-report-escape-hatch) for what a non-numeric value there used to be able to do.

#### Anonymous tickets

`anonymous: true` means **nothing is written down** — not "hidden from the queue". `reporter_id` is left NULL, so nobody can learn who filed it: not the judicial committee, not eboard, not somebody with direct database access. There is no record to find.

:::danger The promise has two halves and both are load-bearing
Nulling the column alone would be theatre. `middleware/auditLog.js` stamps `actor_id` on **every** mutating request, so an audit row reading *"Ann POSTed /reports at 02:14"* identifies the ticket that appeared at 02:14 exactly as well as a column would have.

So `/^\/reports$/` is in that middleware's SKIP list. If you ever remove it, anonymous reporting silently stops being anonymous and nothing will fail.
:::

Two deliberate details of that skip:

- **Exact match, so it exempts creation only.** `PUT /reports/:id/status` is still logged in full — acting on a report is a decision with consequences, which is precisely what an audit trail is for.
- **It skips every report, not just anonymous ones.** Deciding per-request would mean reading and trusting `req.body` inside the middleware, where a multipart quirk or a renamed field would silently start logging the one thing that must never be logged. Named reports lose little; the row itself records who filed them.

⚠ A value that is not `true` or `"true"` files a **named** report. The typo direction is deliberate: silently anonymising a ticket somebody meant to sign would cost the board the ability to follow up, and cannot be undone afterwards.

**The accepted cost:** the board can never ask a follow-up question, and a false report cannot be traced. Rate limiting was considered and deliberately not built.

In `GET /reports`, an anonymous ticket comes back with **`reporter: null`**, not an object of nulls, so the queue renders "Anonymous" rather than a blank that reads like a deleted account.

### `GET /reports/access`

`{ "can_view": true | false }` — answers `200` either way, so asking is never itself a failure.

Its own endpoint rather than letting the client infer it from a `403`, exactly like `GET /rush-data/access`: a nav entry that appears and then `403`s is worse than no nav entry.

### `GET /reports`

**Eboard or the judicial committee.** Optional `?status=open|resolved|dismissed`. Returns reporter/reported-user names already joined in.

### `PUT /reports/:id/status`

**Eboard or the judicial committee.** `{ "status": "resolved" | "dismissed" | "open", "moderator_response": "..." }` — stamps `resolved_by`/`resolved_at` whenever status moves away from `open`.

Same gate as reading, deliberately. Code of Conduct Section 17 makes the Judicial Chair responsible for situational disciplinary action, so a read-only queue would leave the people who actually handle a report unable to close it — and the queue would fill with open items that were long since dealt with.

:::warning The judicial chair is not eboard
`proxy.ts` refuses them all of `/admin`, so the website carries a member-side copy of the queue at **`/member/reports`** alongside eboard's at `/admin/oversight`. Without it the slug would grant an access they had no way to reach — the same trap the pledge chair hit with the decision-night write-up. Anything the judicial committee may do has to exist on the member side too.
:::

---

## Admin

All routes below require `requireAuth` + `requireGroup("eboard")`.

### `GET /admin/users`

Returns all users in the database.

### `PUT /admin/users/:authentikId/group`

`{ "group": "eboard" | "chair" | "active" | "alumni" | "pledge" }` — moves the target user to this group in Authentik itself (removing them from whichever other role group they're currently in there), then mirrors the change into `users.member_group` immediately. See [API Overview: Eboard — changing a member's group](./overview.md#eboard-changing-a-members-group) for the full mechanism and required Authentik setup.

### `GET /admin/exec-roles`

Every exec position, ordered by `sort_order` then `label`. Each row carries `id`, `slug`, `label`, `sort_order`, `is_active` and a computed `holder_count` (live members only — `deleted_at IS NULL`).

`?includeInactive=1` also returns retired roles. The admin portal asks for those, because the manager screen has to show a retired role for anybody to un-retire it, and because a role hidden from the picker while somebody still holds it must not vanish from that person's card.

### `POST /admin/exec-roles`

`{ "label": "Vice President of Operations", "sortOrder": 8 }`. `sortOrder` is optional and defaults to `0`; it must be a whole number between 0 and 999.

The `slug` is derived from the label here and **is not accepted from the caller**. Two labels that reduce to the same slug (`"VP, Finance"` and `"VP Finance"`) both succeed — the second gets `-2` appended — rather than failing the `UNIQUE` constraint with a 500 on an ordinary create.

### `PUT /admin/exec-roles/:id`

`{ "label"?, "sortOrder"?, "isActive"? }`. Absent keys are left alone.

`slug` is **deliberately not an accepted field**. Renaming a role changes what people read and nothing else — see [the warning in the overview](./overview.md#exec_roles-table).

A rename also rewrites `users.exec_title` for every holder, in the same call. That column is a copy of the label, and a rename that updated only `exec_roles` would leave the old wording on every card until somebody reassigned the role by hand.

`isActive: false` retires a role: gone from the default list, still attached to whoever holds it.

### `DELETE /admin/exec-roles/:id`

`204` when nobody holds the role.

**`409` while anyone does**, with a message naming the count. The FK is `ON DELETE SET NULL`, so deleting would silently strip the position off those profiles with nothing recording what it had been; retiring the role is the intended alternative and the message says so.

### `PUT /admin/users/:authentikId/exec-role`

`{ "execRoleId": 3 }`, or `null` to clear it. This is the route the admin portal uses.

Writes **both** `exec_role_id` and `exec_title`, and reads the label from the `exec_roles` row rather than from the request body — so a client cannot put arbitrary text into a column that now claims to be a role.

`404` when either the member or the role is gone, rather than a silent `200`. The two cases are not told apart: it would take a second query, and both mean the same thing to an admin looking at a stale page.

### `PUT /admin/users/:authentikId/exec-title`

`{ "execTitle": "President" }`, or `null`/omitted to clear it. Free-text eboard position.

:::note Superseded by `exec-role` above
Kept mounted for the leftovers. The exec-roles migration backfilled by exact label match, and anything it could not match is still plain text in `users.exec_title` — this is the one route that can correct such a value directly. New writes should go through `PUT /admin/users/:authentikId/exec-role`, which is the only way to get a `slug` attached.
:::

Purely a display label — it makes no Authentik call and isn't validated against `member_group`, though it's only ever surfaced for eboard members (on the directory and the public roster). Unlike the group change above, this one touches nothing outside ktp-api's own database.

### `PUT /admin/users/:authentikId/profile`

Edits **anyone's** profile. Identical body and identical validation to [`PUT /users/me/profile`](#put-usersmeprofile) — both go through `services/profileFields.js`, deliberately one module rather than two copies, so a rule tightened on the member form can't leave a hole on the route with more authority.

Returns `404` when the id is unknown **or** when the account was anonymized by a deletion request. That second case is the point: `anonymize()` erased that person's PII because they asked, and an admin edit writing names back in would quietly undo it.

Unlike the member's own save, this route does not create a row, does not set `profile_complete`, and does not apply the alumni email guard. See the [ktp-api README](https://github.com/ktpuga/ktp-api#eboard-editing-another-members-profile) for why each of those matters.

:::warning It sets the whole row
Every field absent from the body is written as `NULL`. The admin UI seeds its form from `GET /admin/users`, which is why that endpoint returns `dob`, `phone`, `personal_email`, `linkedin_url`, `about_me`, `minors`, `gpa` and `heard_from` even though the list doesn't display them. A new editable column has to be added to `PROFILE_FIELDS`, `findAll` and `adminUpdateProfile` in the same change, or it will erase itself the first time eboard saves.

**This route does *not* honour the "absent key is left alone" rule** that `PUT /users/me/profile` follows — it is a plain whole-row `UPDATE`, on purpose (see the three reasons in `userModel.adminUpdateProfile`). The consequence for the UI is concrete: `AdminEditProfileModal` renders `minors`, `gpa` and `heard_from` for **everyone**, not only rushees. Gating those inputs on `member_group === 'rush'` would mean eboard fixing a typo in a new pledge's surname silently erasing the GPA the pledge committee selected them on.
:::

### `PUT /admin/users/:authentikId/username`

`{ "username": "newname" }` — renames anyone. Writes Authentik first, then mirrors into Postgres, exactly like the self-service rename. `409` if taken, `502` if Authentik couldn't be reached (most often the service account missing `Can change User`).

Separate from the profile route for the same reason the self-service rename is separate: it's the only field that writes to Authentik, and folding it in would sink "that name is taken" into an unrelated bio edit.

### `PUT /admin/users/:authentikId/profile-picture`

Replaces anyone's profile picture. `multipart/form-data`, field name `file` — the only admin route that isn't JSON.

Identical handling to [`PUT /users/me/profile-picture`](#put-usersmeprofile-picture): same 25MB cap, same accepted formats, same server-side re-encode to a resized JPEG. It reuses the member route's multer config, so a rejected upload fails the same way on both.

### `DELETE /admin/users/:authentikId/profile-picture`

Takes down a profile picture; the member's card falls back to their initials.

Only the `profile_picture_asset_id` reference is cleared — the Immich asset is kept, so a contested removal can still be reviewed.

:::note All three are audited
They're recorded in the [activity log](../website/activity-log.md) by the global middleware, never by a call inside the controller — which is what makes the record impossible to forget. These writes change what a person's own profile says about them, with no notification to them, so the log is the accountability.
:::

---

## Notifications

iOS APNs registration, per-user preferences, and the web portal's per-tab badge counts. All routes require auth. **Device tokens are private to their owner** and are never returned by any list endpoint.

### `POST /notifications/devices`

`{ "token": "<64-char hex>", "platform": "ios", "environment": "development" | "production" }`. Registers or transfers an APNs token.

The client sends `development` for local/debug builds and `production` for TestFlight/App Store builds; the API picks that environment's credentials and APNs host accordingly.

### `DELETE /notifications/devices/:token`

Removes the caller's registration for that token.

### `GET /notifications/preferences`

Returns seven booleans, creating the row with all of them `true` if it doesn't exist yet:

`direct_messages_enabled`, `announcements_enabled`, `polls_enabled`, `meetings_enabled`, `events_enabled`, `event_reminders_enabled`, `email_enabled`.

The first six are iOS push categories. `email_enabled` is the member's opt-out for the **email** channel and is the only one the website surfaces — a push toggle in a browser would silently govern a different device.

### `PUT /notifications/preferences`

Updates any supplied boolean; **omitted fields keep their prior value**, so older iOS builds that know about only two of them stay compatible.

### `GET /notifications/unread`

Per-tab badge counts for the web portal sidebar:

```json
{ "announcements": 3, "calendar": 1, "meetings": 0, "polls": 2, "interviews": 0,
  "committees": 2, "tickets": 1, "reports": 0, "ticket_queue": 0 }
```

Each count is "items in this tab created after your cursor for it, that you are allowed to see". **On the first call for a user the cursors are seeded to now and every count is 0** — existing content is never retroactively unread.

`files` was removed in August 2026 and is no longer returned. The cursor table's CHECK constraint still permits the value, so old rows are simply ignored.

:::note Four of these counts ignore their tab cursor
`meetings` counts **unanswered invitations**; `committees` sums **per-committee** counts plus approval queues; `reports` and `ticket_queue` count what is **still open**. None is "new since you last looked", so neither clears by visiting the tab — see `CLEARS_ON_ACTION_NOT_VIEW` on the website side. Their cursor rows are still written and simply unused.

`committees` is the sharper case: its unit of "seen" is the **committee**, not the tab, so it drains as each committee is opened. Zeroing it on arrival would blank the roll-up while every per-committee marker underneath stayed lit.
:::

:::warning `reports` and `ticket_queue` are permission-gated, and are not tabs
They are **0 for everybody except eboard and the judicial committee**. The caller is checked with the same `mayModerateReports` helper the report and ticket routes use, because judicial membership is a Postgres row and never an Authentik group — `groups` on the token genuinely cannot answer it. The keys are always present so the client shape does not change; 0 is what a member without access would see regardless.

Both count what is **still unresolved** (`reports.status = 'open'`, `tickets.status <> 'closed'` — so "in progress" still counts) and both have a **fixed cutoff**, so items already open when the badge shipped never appear. Neither has a cursor row, and `POST /notifications/seen` must not be called for them.
:::

`tickets` is the **author-facing** count: how many of your own signed tickets have been replied to, closed or otherwise touched since you last opened the Tickets page. An anonymous ticket records no author, so it can never appear here.

Counts honour the same audience rules as the corresponding list endpoint, so a badge can never advertise something the caller cannot open. In particular an untargeted announcement or event badges **members only, never rushees**, and a rushee's `announcements` count comes from `rush_announcements` instead.

Also quiet on purpose: you are never counted for content you posted yourself, and closed/expired polls and cancelled meetings don't count.

### `POST /notifications/seen/:tab`

Moves that tab's cursor to now — i.e. marks it read. `204` on success. `tab` must be one of `announcements`, `calendar`, `meetings`, `polls`, `files`, `interviews`, `committees`, `tickets`; anything else is a `400`. `reports` and `ticket_queue` are deliberately **not** valid here — they are queue counts with no cursor. The list is enforced by a **CHECK constraint** on `notification_cursors.tab` as well as in code, so adding a tab needs a migration.

**Behavior worth knowing:** DM alerts fire only after the message is persisted, only to the permitted recipient, and **never include the message body**. Event alerts fire on create, material update, or cancellation, to users who can actually see that event and have event notifications enabled. APNs failures are logged and never fail the underlying message/event request — a push that doesn't arrive is not a reason to suspect the send itself failed.

APNs credentials come from environment variables only (`APNS_PRODUCTION_*` / `APNS_SANDBOX_*`); the API never reads a `.p8` file from disk. An incomplete set for one environment disables only that environment.

**Reminders.** Events and meetings get durable reminder jobs at **2 hours and 30 minutes** before start; an event whose `requires_attendance` is true also gets one **1 day** ahead, titled "Required event". Any write to the event rebuilds its jobs, so a time change moves the reminders and leaves none stale; deleting it removes them. These are APNs-only.

### `GET /notifications/channels`

`{ "email": true | false }` — whether this deployment can actually send email. The website asks before offering the "also send this as an email" checkbox, and hides it when `false`, so the control can never post happily and mail nobody. Adding credentials flips it with no website deploy.

**Email.** `POST /announcements` and `POST /events` accept `send_email: true`, which additionally emails everyone the item targets — minus deleted accounts, test accounts, and anyone with `email_enabled` false. Each recipient gets their own message. Sending is claimed atomically via `announcements.emailed_at` / `events.emailed_at`, so an item is emailed **at most once** and a later edit never re-sends. Requires `RESEND_API_KEY` and `EMAIL_FROM`; without them nothing is sent and a warning is logged, and no other behaviour changes.

---

## iOS Homepage Slideshow

The slideshow on the iOS app's home screen. **Distinct from Homepage Photos above** — that one is the public marketing gallery on the website, this one is in-app and requires auth. Easy pair to confuse.

Reads are open to any authenticated member; writes are eboard-only. A slide is "visible" when it's active, has reached its optional `starts_at`, and hasn't passed its optional `ends_at`. Responses never expose the backing Immich asset ID.

### `GET /ios-homepage-photos`

Visible slides in display order, as `{ "slides": [...] }`.

Eboard callers can pass **`?include_hidden=true`** to also get inactive, scheduled and expired slides.

:::warning Don't make the full set the default
The iOS app calls this same endpoint for the real slideshow, and the route is behind plain `requireAuth` — not `requireGroup("eboard")`. Returning everything by default would feed deactivated and expired slides straight into the app. The flag is additionally gated on the caller being eboard.

This was a real bug: without the flag the admin UI only ever received currently-live slides, so deactivating a slide made it disappear from the one screen capable of reactivating it, and scheduling a slide for next week made it vanish on save.
:::

### `GET /ios-homepage-photos/:id/media`

Streams a visible slide. Eboard can additionally fetch inactive/scheduled ones. Supports `ETag`/`If-None-Match`.

### `POST /ios-homepage-photos`

**Eboard only.** Multipart, field `file`, plus required `title` and `alt_text`. Optional: `subtitle`, `link_url` (HTTPS only), `link_label`, `is_active` (default true), `starts_at`, `ends_at`, `focal_x`, `focal_y`.

### `POST /ios-homepage-photos/register`

**Eboard only.** Creates a slide from an existing Immich asset — `immich_asset_id` plus the same metadata as upload.

### `PUT /ios-homepage-photos/:id`

**Eboard only.** Partial metadata update.

### `PUT /ios-homepage-photos/:id/image`

**Eboard only.** Replaces the picture on an existing slide while keeping its metadata, schedule and position. Multipart, field `file`, plus optional `focal_x`/`focal_y` so the crop can be re-chosen at the same time. Runs the same processing pipeline as a create.

The old Immich asset is deleted **only after** the row already points at the new one — a failure there leaves an orphaned asset rather than a live slide with no image. The `updated_at` trigger bumps the ETag `GET .../media` serves, so clients don't keep showing the previous picture for the rest of its hour-long cache.

### `PUT /ios-homepage-photos/reorder`

**Eboard only.** `{ "ids": ["1", "2", "3"] }`.

### `DELETE /ios-homepage-photos/:id`

**Eboard only.** Deletes the slide and the generated 1500×1000 derivative.

If the slide came from `/register`, the shared-album original is recorded in `source_immich_asset_id` and is **not** touched. This is the opposite of `DELETE /homepage-photos/:id`, which unlists but keeps everything — worth being precise about in UI copy, since "this permanently deletes the image" would wrongly imply a library original is about to be destroyed.

**Constraints:** max 10 active slides; uploads capped at 100MB; JPEG/PNG/HEIC/HEIF/WebP only (no animated images); source images must be at least 900×600.

:::note The crop is focal-point based, not a freehand rectangle
`services/iosSlideshowImage.js` extracts the largest possible 3:2 region **centred on the focal point**:

```
cropWidth  = min(W, H * 1.5)
cropHeight = min(H, W / 1.5)
left = clamp(W * focal_x - cropWidth / 2)
top  = clamp(H * focal_y - cropHeight / 2)
```

So a source wider than 3:2 is cropped at full height and slides horizontally; a taller one is full width and slides vertically. Any client preview must reproduce this against the **source** dimensions — rendering the image into a container already forced to 3:2 shows a crop the server will never produce.
:::

---

## Webhooks

### `POST /webhooks/authentik`

Called by Authentik's notification transport when a user is deleted — **fixed and confirmed working in production.**

**Headers:**
```
X-Authentik-Token: <WEBHOOK_SECRET>
```

**Request body (Authentik format):**
```json
{
  "action": "model_deleted",
  "model": {
    "model_name": "user",
    "pk": 42
  }
}
```

Deleting a user in Authentik now correctly removes their row from `users` — no manual DB cleanup needed. The root causes of the long-standing "nothing happens" issue were entirely on the Authentik side, not this endpoint:
1. The Notification Rule needs a Group **or** "Send notification to event user" set — Authentik silently no-ops a Rule with neither.
2. The bound Event Matcher Policy's **App** field compares against the Event's own `event.app`, not `event.context.model.app` — leave App blank; Action=`Model Deleted` + Model=`User (authentik_core)` alone is correct and sufficient.

If this breaks again, `docker logs worker` on the Authentik host (not this API's logs) shows structured `policy_execution` entries with a per-criterion pass/fail — the fastest way to see which criterion is silently failing.

---

## Error Responses

| Status | Meaning |
|--------|---------|
| `400` | Bad request — missing or invalid fields |
| `401` | Missing or invalid Bearer token |
| `403` | Authenticated but not authorized (wrong group) |
| `404` | Resource not found |
| `413` | Upload exceeds that route's size limit |
| `415` | Unsupported file type, or a file that isn't a decodable image |
| `429` | Rate limited (message sends, 20/minute/user) |
| `500` | Internal server error |

All error responses use the format:
```json
{ "message": "Error description" }
```

Upload errors additionally carry a machine-readable `code` (`upload_too_large`, `unsupported_media_type`, `unexpected_file_field`).

:::note `message` is the only key clients read
The website extracts `err.message` and nothing else (`lib/portal-api.js`). An endpoint returning `{ "error": "..." }` will have its text silently replaced by a generic fallback — this was a real bug on the slideshow routes. Every upload router now goes through the shared `uploadErrorHandler` in `middleware/upload.js`, which emits `message` and quotes the route's real limit from `LIMITS_MB` rather than a hardcoded string.
:::