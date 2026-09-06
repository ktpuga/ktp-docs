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

**Auth required.** Creates or updates the caller's database row and returns `profile_complete`. The website calls it on login and when a refresh detects changed groups.

Example request:

```json
{ "authentik_id": "uuid", "username": "jsmith" }
```

Example response:

```json
{ "authentik_id": "uuid", "profile_complete": false }
```

Identity and group values come from the verified token. The request cannot assign `member_group`. `ROLE_GROUPS` resolves multiple groups in this order: `eboard`, `chair`, `active`, `alumni`, `pledge`, `rush`. A middleware-defaulted group does not overwrite an existing stored group.

### `GET /users/me`

**Auth required.** Returns the caller's full profile row. Example fields:

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

### `PUT /users/me/profile`

**Auth required.** Accepts JSON, saves the supplied profile fields, and sets `profile_complete = true`. Returns the saved profile row. File uploads use the separate profile-picture endpoint.

`first_name` and `last_name` are required. Other omitted fields retain their stored values. Send an explicit `null` to clear an optional nullable field; blank text is normalized rather than stored as an empty string. Use `[]` to clear links.

| Field | Validation |
| --- | --- |
| `first_name`, `last_name` | Required after trimming; up to 100 characters each |
| `preferred_name` | Up to 100 characters |
| `dob` | A real `YYYY-MM-DD` date between `1900-01-01` and today |
| `major` | Up to 120 characters |
| `graduation_date` | `Spring`, `Summer`, `Fall`, or `Winter`, followed by a four-digit year from 1900 to 2100 |
| `phone` | 7 to 15 digits; also accepts `+`, parentheses, hyphens, periods, and spaces; stored as entered |
| `email`, `personal_email` | Validated email addresses. For alumni, `email` is ignored and its stored value is preserved |
| `linkedin_url` | Validated and normalized; invalid values return `400` |
| `pledge_class` | Up to 50 characters |
| `about_me` | Truncated to 600 characters |
| `doing_now` | Up to 150 characters |
| `pronouns` | Free text, up to 40 characters; not limited to client presets |
| `links` | Up to 5 `{ label, url }` entries; required label up to 40 characters and URL up to 300 |
| `minors` | Free text, up to 200 characters |
| `gpa` | 0 to 5, with at most two decimal places |
| `heard_from` | Free text, up to 300 characters |

When the caller belongs to a group that requires a UGA email, omitting `email` is allowed only if an address is already stored. An explicit null still fails the required-email check.

Except for `about_me`, overlong values return `400` with the field name. Validation applies even when a field is not shown in the caller's form.

For `links`, a non-array or any invalid entry rejects the whole list. URLs must use HTTP or HTTPS; a host without a scheme, such as `example.com/me`, is normalized to HTTPS. Other schemes, including `javascript:` and `data:`, are rejected. Omitting `links` on this partial-update endpoint leaves the stored list alone.

Keep `dob` as a date-only string when sending it to Postgres. Converting it to a JavaScript `Date` can shift it by a day when a timezone offset is applied.

`gpa` uses Postgres `NUMERIC(3,2)` and is returned as a string such as `"3.75"`. Preserve that representation when exporting. The validator rejects more than two decimal places and alternate numeric spellings such as `3.5e0` or `+3.5`. The upper bound of 5 allows weighted secondary-school GPAs.

The website omits `minors`, `gpa`, and `heard_from` when those inputs are hidden. Sending null instead would erase saved rush answers after a member changes group. The [admin profile endpoint](#put-adminusersauthentikidprofile) has different update semantics.

After saving, the website calls `update({ profile_complete: true })` to refresh the NextAuth session. Username changes use the endpoint below; profile updates do not overwrite `username` from a potentially stale token.

### `PUT /users/me/username`

**Auth required.** Accepts `{ "username": "newname" }`. Updates Authentik first, then Postgres.

| Status | Meaning |
| --- | --- |
| `200` | Returns `{ username }` |
| `400` | Username must contain 3 to 32 characters from `[a-zA-Z0-9._-]` |
| `409` | Username is already taken in Authentik |
| `502` | The update could not be completed |

The Authentik service account needs `Can change User`. Check that permission when renames return `502`; see [API Tokens / Service Accounts](../authentik/overview.md#api-tokens--service-accounts).

See [Profiles & Directory: Usernames](../website/profiles-and-directory.md#usernames) for client behavior.

### `PUT /users/me/profile-picture`

**Auth required.** Multipart upload with a `file` field, limited to 25 MB. Accepts JPEG, PNG, WebP, HEIC/HEIF, AVIF, GIF, and TIFF. SVG and BMP are not accepted.

`services/profilePictureImage.js` decodes the image, applies EXIF rotation, fits it within 1024 × 1024 without enlarging it, flattens transparency onto white, removes EXIF metadata, and stores a progressive JPEG in Immich. Animated GIF and WebP uploads use the first frame. This gives clients a consistent avatar format and removes metadata such as GPS coordinates.

Returns `413` with `upload_too_large` above the limit, or `415` with `unsupported_media_type` when the file cannot be decoded. The claimed MIME type is only an initial check; the server also decodes the file.

HEVC-compressed HEIC support depends on the deployed libvips build having `libde265`. A build that reports HEIF support may still reject these files with `415`; check the decoder when investigating HEIC failures.

### `GET /users/:id/profile-picture/media`

**Auth required.** Streams a user's profile picture from Immich and forwards `Range` headers. Accepts any user ID, not just the caller's. Returns `404` if no picture is set; clients can show initials instead.

### `DELETE /users/me`

**Auth required.** Anonymizes the account: clears personal fields, sets `profile_complete = false`, and records `deleted_at`. The row and its messages, photos, and committee history remain. The account is excluded from member and admin lists. Deleting the Immich profile-picture asset is attempted before anonymization.

This does not delete the Authentik account. Eboard manages SSO access separately; an Authentik deletion triggers the webhook described below. Clients should sign the user out after this request succeeds.

### `GET /users/blocked`

**Auth required.** Returns the caller's block list as `{ id, username, first_name, last_name, preferred_name, profile_picture_asset_id }` entries. The asset ID lets clients version avatar URLs. It does not list people who have blocked the caller.

### `PUT /admin/users/:authentikId/traits`

**Eboard only.** Accepts `{ "traits": ["Pledge Chair", "Fintech"] }` and returns `{ traits }`. Up to 6 plain strings, each no more than 80 characters. Send `[]` to clear the list.

Traits appear on directory cards and the public roster alongside the member's role. They are free text, separate from [`exec_roles`](./overview.md#exec_roles-table). Objects such as `{ label, value }`, non-arrays, and invalid entries return `400`; an invalid entry rejects the whole list.

`traits` is excluded from `PROFILE_FIELDS`, so neither member nor admin profile saves can write it through that shared field list. Use this endpoint.

### `PUT /users/me/roster-visibility`

**Auth required.** Accepts `{ "visible": true | false }` and returns `{ show_on_public_roster }`. The value must be a boolean; other types return `400`.

This is a self-service setting for the public `/members-list` page. There is no eboard override. It has a separate endpoint so ordinary profile saves do not change the member's publication choice.

Opting out removes the member from `GET /roster` and prevents `/roster/:id/media` from serving their photo.

### `POST /users/:id/block`

**Auth required.** Blocks a member. Prevents new direct messages in either direction and hides that user's messages from the caller's DM and group-chat views. The block is one-directional and idempotent.

### `DELETE /users/:id/block`

**Auth required.** Removes the caller's block.

---

## Members

### `GET /members`

**Auth required.** Returns members, with optional `?group=` filtering by `member_group`. Accepted groups are `active`, `pledge`, `eboard`, `chair`, `alumni`, and `rush`.

Rushees are excluded from the unfiltered response. Request `?group=rush` to list them; callers without the required access receive an empty list. The website uses this separate request for its Rushees tab. See [Rushees in the member directory](../website/rush-portal.md#rushees-in-the-member-directory).

Example fields:

```json
[
  {
    "authentik_id": "uuid",
    "first_name": "John",
    "last_name": "Smith",
    "member_group": "active",
    "graduation_date": "Spring 2026",
    "birthday": "03-14"
  }
]
```

`birthday` contains only month and day, or null. SQL formats it as `TO_CHAR(dob, 'MM-DD')`; the raw date of birth and birth year are not returned. Formatting in SQL also avoids timezone shifts from parsing a full date in the client. The public roster returns neither birthday nor date of birth.

### `GET /members/:id`

**Auth required.** Returns a member by `authentik_id`, using the same fields as the list endpoint.

Both endpoints return `email: null` for members whose resolved `member_group` is `alumni`. Clients should fall back to `personal_email` for their contact link. The stored UGA address is preserved; this is a read-time rule based on `users.member_group`, not the token's raw groups. See the [API README](https://github.com/ktpuga/ktp-api#alumni-and-the-uga-email) for the write-side rule.

---

## Roster (public)

The public `/members-list` page uses these endpoints without authentication. Responses exclude private contact and profile fields such as email, phone, major, date of birth, pledge class, pronouns, and custom links.

### `GET /roster`

Returns `{ eboard: [...], chair: [...], active: [...], alumni: [...] }`. Entries include `{ id, firstName, lastName, preferredName, execTitle, chairedCommittees, profilePictureAssetId, doingNow }`.

`doingNow` is the member's public text about their work after graduation and is usually null for non-alumni. `execTitle` is populated only for eboard. `chairedCommittees` is an array because one member can chair multiple committees.

Pledges, incomplete profiles, test accounts, members without profile pictures, and members who opted out of the public roster are excluded.

Use `profilePictureAssetId` as the avatar URL's `?v=` cache key. The member ID does not change when a picture is replaced, but Immich creates a new asset ID for each upload. The asset ID does not grant access; the media endpoint checks eligibility. `test/avatarAssetIds.test.js` covers its presence in the relevant responses.

### `GET /roster/:id/media`

Streams the member's profile picture. Rechecks the same eligibility rules as the roster list, including the visibility setting, and returns `404` when the member or picture is not eligible.

---

## Events

Reads use `optionalAuth`. A valid bearer token includes events targeted at the caller; a missing or invalid token returns public results. Writes require authentication and membership in `SHARED_ALBUM_GROUPS`, followed by the endpoint's permission check.

### `GET /events`

Returns visible events. Public events have no audience or committee targeting. Authenticated callers also see events whose `audience` overlaps their token groups or whose `committee_ids` include a committee they belong to. Eboard sees all events.

Chairs and eboard count as active for audience matching. The same implied-group rule applies to announcements and polls.

### `GET /events/:id`

Returns one event using the same `VISIBLE_TO_VIEWER_SQL` predicate as the list. Eboard is unfiltered. An event the caller cannot see returns `404`, so the response does not confirm that restricted content exists.

### `POST /events`

Example request:

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

Eboard and chairs can create events, including chapter-wide events. If a chair supplies `committeeIds`, every ID must identify a committee they chair. Other callers receive `403`. The API validates `title`, `startDate`, `endDate`, and `location` before writing.

Events and polls store multiple committee IDs in `INTEGER[]` columns. Announcements use a single nullable `committee_id`; clients must use the correct shape for each endpoint.

Enabling `requiresAttendance` creates a random attendance secret if one does not exist. The secret is retained and is never returned by an endpoint. `services/attendanceCode.js` uses it as an HMAC key to generate rotating QR codes; publishing the key would allow callers to generate their own codes.

### `PUT /events/:id`

Checks permission against the existing event, then checks the requested targeting. Eboard can edit any event. Other callers can edit events they created or events belonging to a committee they chair, subject to the create/targeting checks on the update.

### `DELETE /events/:id`

Uses the existing-event permission check: eboard, the creator, or a chair of an owning committee. Deleting an event also deletes its RSVP rows.

---

## RSVP

Events with `requiresRsvp` enabled let members answer before or during the event. RSVP and attendance are independent: an event can use either or both. `event_rsvps` stores intent to attend; `event_attendance` stores attendance records.

### RSVP fields {#every-event-gains-two-fields}

Event responses include `requiresRsvp` and the caller's `myRsvp`:

```json
{ "requiresRsvp": true, "myRsvp": "going" }
```

`myRsvp` is `"going"`, `"not_going"`, or null for an unanswered or anonymous request. These fields do not reveal another member's answer.

`canRsvp` indicates whether this caller is eligible to respond:

```json
{ "requiresRsvp": true, "myRsvp": null, "canRsvp": false }
```

Use `canRsvp` for response controls, the *RSVP needed* badge, and pending counts. Seeing or creating an event does not necessarily put the caller in its audience. For example, eboard can see a pledge-only event without being eligible to RSVP.

The flag and write guard share `RECIPIENT_PREDICATE_SQL` in `eventModel`. Eligibility uses the stored `users.member_group`, excludes deleted accounts, and treats chairs and eboard as active. It is the same recipient set used for push and email, rather than the calendar's token-group visibility query. The event list calculates eligibility in one batch.

`GET /events/:id` also returns `rsvpSummary` for eboard or the event creator:

```json
{ "rsvpSummary": { "going": 12, "notGoing": 3, "pending": 7, "total": 22 } }
```

The summary is absent for other callers and is not included in `GET /events`, avoiding a separate recipient scan for every event in the calendar.

### Member responses {#where-members-actually-answer}

The portal shows RSVP controls in Upcoming events as well as the selected day's event card. Unanswered eligible events have an amber outline and an *RSVP needed* badge.

Keep the controls in a sibling footer to the event-row button; nesting buttons produces invalid HTML. See [Tab badges](../website/notifications.md#calendar-is-different-too-unanswered-rsvps-outrank-new) for the sidebar behavior.

### `PUT /events/:id/rsvp`

An authenticated caller answers only for themselves:

```json
{ "status": "going" }
```

| Status | Result |
| --- | --- |
| `200` | `{ eventId, status, createdAt, updatedAt }`; creates or updates the caller's answer |
| `400` | Invalid status or ID, or RSVP is disabled |
| `403` | `This event was not sent to you` |
| `404` | Event not found |
| `409` | `This event has already ended` |

`status` must be `going` or `not_going`. Responses remain editable until `endDate`, allowing a member to change plans during the event.

### `DELETE /events/:id/rsvp`

Withdraws the caller's answer. Uses the same eligibility, enabled-event, and end-time checks as `PUT`.

| Status | Result |
| --- | --- |
| `200` | `{ eventId, status: null, removed }` |
| `400` | Invalid ID or RSVP is disabled |
| `403` | `This event was not sent to you` |
| `404` | Event not found |
| `409` | `This event has already ended` |

An unanswered RSVP returns `200` with `removed: false`. Withdrawal deletes the row and returns the caller to `pending`; it does not change the recipient total. Use this endpoint rather than sending a null status to `PUT`.

### `GET /events/:id/rsvps`

**Eboard or the event creator only.** Returns named responses and a summary:

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

`responses` contains answered RSVPs from current recipients. `pending` is the recipient total minus those answers. These permissions are narrower than attendance management, which also permits cabinet.

Changing an event's audience immediately changes eligibility, totals, and visible responses. Stored answers are retained, so widening the audience again can restore them. Disabling `requiresRsvp` also retains answers. Do not cache a recipient snapshot for these calculations.

---

## Attendance

Events with `requiresAttendance` enabled support QR check-in. Eboard, cabinet (chairs), and the event creator can manage attendance. Members can check themselves in while signed in.

Attendance permissions are defined by `MAY_MANAGE_ATTENDANCE` in `attendanceController`. Chairs can manage attendance for events created by someone else.

### `GET /events/:id/attendance/code`

**Eboard, cabinet or event creator.** Returns `{ eventId, code, expiresAt, periodMs }`. Encode a QR pointing to `<site>/checkin/:eventId/:code`.

Codes rotate every 10 seconds. Fetch a replacement just after `expiresAt`; use the response timing fields instead of hardcoding the interval. `AttendancePage.jsx` fetches a code when mounted and continues refreshing while the QR overlay is open.

Returns `400` if attendance is not enabled for the event.

### `GET /events/:id/attendance`

**Eboard, cabinet or event creator.** Returns `{ finalizedAt, records }`. Read the roster from `data.records`; the response itself is not an array.

Each record includes:

- `user_id`, plus the saved `display_name` and `member_group`.
- `status`, `checked_in_at`, and `marked_by`.
- Current `username` and `profile_picture_asset_id` from `users` for the avatar.
- `still_eligible`, which indicates whether the attendee still matches the event's audience.

Records are sorted in SQL by status: present, excused, not marked, then absent. Each group is sorted by last name. Both the website and iOS app use this order. Rows can move as the portal refreshes during check-in.

A deleted account has `user_id: null`. Its attendance record retains the saved name, but the status control is disabled because there is no user ID to address an update to.

#### Unmarked attendees

An expected attendee who has neither scanned nor been marked has `status`, `checked_in_at`, and `marked_by` set to `null`. Display this as *Not marked*. It does not mean absent.

The status endpoint accepts only `present`, `excused`, and `absent`. There is no endpoint to reset a marked attendee to `null`.

#### Saved roster and group changes

`attendanceModel.syncRoster` inserts expected attendees into `event_attendance` with a null status. It saves their display name and member group at that time. Later name or group changes do not overwrite those saved values.

The controller syncs before each roster read while `attendanceFinalizedAt` is null. This allows new eligible attendees to appear until the roster is finalized. Existing attendance rows remain even if the event's targeting changes.

Expected attendees follow the calendar's audience rules:

- An untargeted event includes every member group.
- `audience` matches member groups.
- `committee_ids` matches committee membership.
- Test accounts, incomplete profiles, and soft-deleted accounts are excluded.

Chairs and eboard count as active members. `syncRoster` handles this with a SQL `CASE` because `users.member_group` stores a single group. A direct comparison of that column with `ev.audience` would omit chairs and eboard from active-member events. Keep this logic consistent with `expandImpliedGroups()` in `middleware/auth.js`; `test/attendanceRoster.test.js` covers it.

#### `still_eligible`

This boolean reports whether the attendee currently matches the event's audience. It becomes false if they change to an ineligible group, leave the relevant committee, or delete their account. It uses the same `AUDIENCE_MATCH_SQL` as roster syncing.

Use this flag for display, not to remove records. On an open roster, the portal greys out these rows and labels them *no longer in this group* or *account deleted*. Officers can still change the status of an existing account, and an audience mismatch does not refuse self check-in.

Do not grey out a finalized roster based on current eligibility. Its saved membership describes the event at the time it was finalized. The API still returns `still_eligible`; `AttendancePage` uses `finalizedAt` to decide whether to apply the styling.

`attendanceModel.findForEvent` retains the older response shape containing only recorded attendance. The portal does not use it.

### `PUT /events/:id/attendance/:userId`

**Eboard, cabinet or event creator.** Accepts `{ "status": "present" | "excused" | "absent" }`.

On an open roster, this creates a record if needed. On a finalized roster, it updates existing records only, using `allowInsert: false`.

| Target | Result on a finalized roster |
| --- | --- |
| Already on the roster | `200`; status remains editable |
| Existing member not on the roster | `403`; reopen the roster before adding them |
| Member no longer exists | `404` |

These rules are enforced by the API, including for callers that construct their own update URLs.

### `PUT /events/:id/attendance-finalized`

**Eboard, cabinet or event creator.** Accepts `{ "finalized": true | false }` and returns `{ finalizedAt }`. The timestamp is null when the roster is reopened.

Returns `400` if attendance is disabled or `finalized` is not a boolean.

Finalizing syncs the roster once, then stops further additions. Existing statuses remain editable. Syncing first ensures that an event whose roster has never been opened still includes its expected attendees.

Finalization is manual and reversible. Reopening resumes syncing without deleting records or changing existing marks. Past events that have not been finalized remain subject to group changes and are labelled *Not finalized* in the portal.

### `POST /checkin/:eventId/:token`

**Any signed-in member.** Records a self check-in after a QR scan.

The `token` path parameter is a rotating code derived from the event's attendance secret. The stored `attendance_token` is never accepted directly. A code must match the current 10-second bucket or the previous one, giving it 10 to 20 seconds of validity from generation. Less time may remain when it is scanned.

Check-in opens 30 minutes before the event starts and closes 30 minutes after it ends. The API generates and validates codes using server time; the scanning phone's clock is not an input.

| Condition | Response |
| --- | --- |
| Invalid or missing authentication | `401` |
| Invalid event ID or event not found | `404` |
| Attendance disabled, missing attendance secret, or invalid/expired code | `403` |
| Outside the check-in window or roster finalized | `403` |
| Attendance write or required lookup fails | `500` |

The controller checks audience eligibility for its logs but records the scan even when the attendee does not match. Empty or stale groups do not themselves cause a refusal. Eligibility queries can still fail with a database error.

#### Repeat scans and officer marks

A repeat scan preserves the first `checked_in_at` time. It also preserves `status` and `marked_by` when either:

- `marked_by IS NOT NULL`, indicating an officer's mark.
- The existing status is `excused` or `absent`.

The status check is needed because deleting an officer sets `marked_by` to null. Their previous absent or excused marks must still be preserved.

A member already marked absent or excused stays that way after scanning until an officer changes the status. The request returns the existing record successfully, so clients must read `record.status` instead of assuming every `200` means present.

The SQL upsert uses `CASE` expressions to preserve marks while still returning the row. A conditional update that returned no row would be treated by `selfCheckIn` as a failed write.

#### QR sharing

Rotating codes limit how long a screenshot can be used by someone outside the room. They replace the earlier QR format that exposed the event's fixed attendance token. The URL shape is unchanged for existing scanners.

Authentication identifies the member making the request. Rotation limits reuse of the code; it does not detect someone checking in and then leaving.

### `myAttendance` on `GET /events`

Each event includes the caller's recorded status: `"present"`, `"excused"`, `"absent"`, or `null`.

`eventsController.getEvents` adds this through one batched call to `attendanceModel.findMyStatusesForEvents`. The query excludes rows with a null status, so being on the expected roster does not appear as recorded attendance.

The field is specific to the caller. It is not part of `eventModel.toCalendarEventJSON` and is not included in `GET /events/:id` or the ICS feed.

`EventsCalendar.jsx` displays *Checked in*, *Excused*, or *Marked absent*. When no status is recorded, it shows the plain *Attendance* badge. Keep these labels separate from the officer roster's *Present* and *Absent* labels.

Regular members can use the calendar to confirm their own status. The attendance management screen is shown to chairs and eboard.

### The portal screen

`components/portal/AttendancePage.jsx` is mounted at `/member/attendance` and `/admin/attendance`. It has Upcoming and Past tabs, an event list on the left, and the selected roster on the right.

Live events appear under Upcoming with a *Happening now* heading. The initial tab uses whichever group has events. Refreshing keeps the selected event unless it is no longer in the visible tab.

**Show QR code** opens a fullscreen overlay, closed by its button or `Esc`. The overlay hides the roster so it is not projected with the QR.

**Finalize roster** and **Reopen roster** call `PUT /events/:id/attendance-finalized`. Finalized events show the date. Past events that remain open show a *Not finalized* indicator and explain that their rosters can still change.

Below the `lg` breakpoint, the event list becomes a labelled dropdown above the roster.

When editing this screen:

- Keep the QR background white for scanning contrast.
- Track pending status updates per attendee so one request does not disable the entire roster.
- Use the saved `display_name`. The `rosterPerson()` helper adapts it for `memberDisplayName()`; roster records do not contain the live first-name and last-name fields.
- Display a null `member_group` as *Group not recorded*. Older records may lack this value; the generic *Member* fallback would imply a known group.

---

## Committees

Committee membership is stored in Postgres, not in separate Authentik groups. These routes require authentication and a group in `SHARED_ALBUM_GROUPS`: active, chair, alumni, eboard, or pledge. Additional permissions are listed below.

Committees do not have dedicated group chats. A chat can reference committees through `committee_ids`; `membershipPredicate` checks their membership when the chat is read. Joining or leaving a committee changes access to those chats without syncing individual chat-member rows.

The former `committees.group_chat_id` column and `syncGroupChatMembership` function have been removed. Deleting a committee does not delete a chat.

### `GET /committees`

Returns all committees, their member counts, and whether the caller is a member or chair of each.

### `GET /committees/activity`

Returns per-committee counts for the Committees page and sidebar badge:

```json
[{ "committee_id": "3", "new_count": 2, "pending_count": 0 }]
```

- `new_count`: events and announcements created since the caller last opened that committee, excluding their own posts. Only the caller's committees contribute, including for eboard.
- `pending_count`: join requests the caller can approve or deny, excluding their own request. Eboard can act on requests for any committee; a committee chair can act on requests for that committee.

The API returns these counts separately. The sidebar adds them together. Committee events and announcements can also contribute to the Calendar and Announcements badges; that overlap is intended.

Register `/activity` and `/slugs` before any future `GET /:id` route so Express does not treat those names as committee IDs.

### `POST /committees/:id/seen`

Marks a committee as read for the caller. The portal calls this when the committee's detail view opens, not when the Committees list opens.

Returns `204` on success or `404` if the committee does not exist. Committee membership is not required: this only updates the caller's read position and grants no access. This also allows eboard to open committees they do not belong to.

### `POST /committees`

**Eboard only.** Accepts `{ "name": "..." }`.

### `DELETE /committees/:id`

**Eboard only.** Deletes the committee. Returns `204` on success or `404` if it does not exist. Group chats are not deleted.

### `POST /committees/:id/join`

Submits a join request for the caller. Returns `202` with `{ "status": "requested" }`; membership is granted only after approval by eboard or that committee's chair.

Returns `204` without creating a request if the caller is already a member, or `404` if the committee does not exist.

### `DELETE /committees/:id/leave`

Removes the caller from the committee and returns `204`. Chat access is recalculated from committee membership rather than updated through a linked-chat sync.

### `GET /committees/:id/members`

Returns the committee's members. Any caller allowed through the committee router can view the list; they do not need to belong to that committee. Returns `404` if the committee does not exist.

### `PUT /committees/:id/members/:userId/role`

**Eboard only.** Accepts `{ "role": "chair" | "member" }`. Adds the target user to the committee if needed, then sets their role.

Returns `204` on success, `400` for an invalid role, or `404` if the committee or user does not exist.

### Committee slugs

A slug identifies a committee used by a feature, independent of its numeric ID or display name. Each committee can hold one slug. The partial unique index `committees_slug_key` ensures that a slug belongs to at most one committee.

`services/committeeSlugs.js` defines the available slugs:

| Slug | Access |
| --- | --- |
| `pledge` | [Rushee interest form data](#rushee-interest-form-data), rushee profiles, the decision-night deck and write-up, and interview signup. Individual features also check the caller's role. |
| `judicial` | The [member report queue](#reports--moderation), including resolving and dismissing reports. |

To add a committee-specific feature, add an entry to `COMMITTEE_SLUGS`, implement its permission check, and assign the slug through a data migration. `committeeModel.isSlugMember` and `isSlugChair` accept the slug as an argument. The registry endpoint and committee-page notices use the registry without a separate list of known slugs.

### `GET /committees/slugs`

**Eboard only.** Returns the registry as `[{ slug, label, description }]`.

This endpoint describes the available permissions. Assignments come from the `slug` field on `GET /committees`. The committee page combines the two responses and shows a notice for each unassigned slug.

#### Assigning a slug

There is no HTTP endpoint or portal control for assigning slugs. The former `PUT /committees/:id/slug`, `PUT /committees/:id/pledge`, and `committeeModel.setSlug` paths were removed. Assignments grant access to sensitive member data and are changed through a reviewed migration or SQL change at deployment.

Move a slug by clearing its current assignment before setting the new one, in a single transaction:

```sql
BEGIN;
UPDATE committees SET slug = NULL      WHERE slug = 'judicial';
UPDATE committees SET slug = 'judicial' WHERE id = <the committee>;
COMMIT;
```

Replace `<the committee>` with the reviewed target ID. Use one checked-out database connection for the whole transaction. Separate pooled `query()` calls may run on different connections.

The clear-then-set order avoids a temporary duplicate under `committees_slug_key`. This partial unique index cannot be made deferrable, so do not combine the move into a single `UPDATE ... CASE` statement.

`test/rushInterestData.test.js` and `test/judicialReports.test.js` check that the HTTP write paths remain unavailable.

#### Assignment migrations

The pledge migration `1789000000000` and judicial migration `1789100000000` assign by name only when exactly one eligible committee matches. They leave rows unchanged if there are zero or multiple matches, the slug is already assigned, or the candidate holds another slug. An unassigned slug appears as a notice on the committee page.

Include the assignment migration when deploying a feature that depends on a slug. The feature's permission checks cannot grant committee access until the assignment exists.

Every committee response includes `slug`, so members can see the assignment on the committee card even though they cannot edit it.

#### Legacy `can_view_rush_data` field

`can_view_rush_data` remains in the table and response for compatibility, but permission checks no longer use it. Removing it requires a new migration; do not edit the already-deployed `1789000000000` migration.

---

## Rushee interest form data

Rushees enter their interest-form answers in the profile builder. These endpoints provide the committee's table, individual profiles, and decision-night presentation.

The router requires authentication and `SHARED_ALBUM_GROUPS`. Access to rushee data is then checked by `mayViewRushData`: eboard or membership in the committee with `slug = 'pledge'`. These routes are outside `/admin` so eligible committee members can use them.

Register `/access` and `/presentation` before `/:id` in `routes/rushData.js`.

### Access levels {#the-four-tiers-which-are-not-the-same-tier}

| Data or action | Access |
| --- | --- |
| Rushee profile, interest form, and GPA | Eboard or any pledge committee member |
| Decision-night deck | Eboard or any pledge committee member |
| Write a presentation note | Eboard or the pledge committee chair |
| Read interview notes | Eboard, pledge committee chair, or pledge committee members who ran that rushee's slot |

Rushees cannot read interview notes, including their own. Keep the member-group gate on notes routes and do not add notes to rushee-facing profile responses.

### `GET /rush-data`

Returns rushees and their interest-form answers, ordered by surname. Unauthorized callers receive `403`. Test and deleted accounts are excluded; incomplete profiles remain so the committee can follow up on unfinished registrations.

The response fields also define the CSV export columns. Update the export when adding a field. `test/rushInterestData.test.js` checks the response shape.

### `GET /rush-data/access`

Returns `200` with the caller's permissions:

```json
{ "can_view": true, "can_edit_presentation": false }
```

Use the separate flags to decide whether to show the page and its editor. A committee member may be able to read without being allowed to save a write-up.

The former `pledge_committee` and `pledge_committee_set` fields are no longer returned. The committee page finds missing assignments by comparing [`GET /committees/slugs`](#get-committeesslugs) with each committee's `slug`. Until a slug is assigned, its committee-specific access remains unavailable; eboard retains access.

### `GET /rush-data/presentation`

Returns the decision-night deck, ordered by display name:

```json
[
  {
    "candidate_id": "...",
    "candidate_name": "...",
    "profile_picture_asset_id": null,
    "major": "...",
    "minors": "...",
    "gpa": "3.75",
    "graduation_date": "Spring 2028",
    "heard_from": "...",
    "presentation_body": null,
    "presentation_updated_at": null
  }
]
```

`findDeck` starts from `users` and left-joins the write-up. Rushees without notes or an interview booking still appear. A missing `presentation_body` is null, not an empty string, so the editor can count unwritten slides.

### `GET /rush-data/:id`

Returns one rushee's profile, booking details, presentation note, and recorded attendance:

```json
{
  "rushee": { "...": "..." },
  "interview": {
    "booking_id": "...",
    "schedule_id": "...",
    "schedule_title": "...",
    "startDate": "...",
    "endDate": "...",
    "location": null,
    "interviewers": []
  },
  "presentation": { "body": "...", "updated_by_name": "...", "updated_at": "..." },
  "attended_events": [
    { "id": "12", "title": "Info Session", "startDate": "...", "endDate": "...",
      "location": null, "checkedInAt": "..." }
  ],
  "can_view_notes": true,
  "can_edit_presentation": false
}
```

`interview` and `presentation` are null when absent. `attended_events` is always an array, ordered oldest first, and includes only `status = 'present'`. An empty list can mean attendance was not recorded; it does not establish that the rushee attended no events.

The lookup applies the same rushee, test-account, and deletion filters as the table. Other user IDs return `404` rather than exposing a member's private profile fields.

Interview notes are fetched separately by `booking_id` through the existing `InterviewNotes` component. Show that panel only when the server returns `can_view_notes: true`. The flag uses the interview controller's permission predicate.

### `PUT /rush-data/:id/presentation`

**Eboard or the pledge committee chair.** Accepts `{ "body": "..." }`, up to `TEXT_LIMITS.PRESENTATION_NOTE` (3000 characters), and returns the saved row. Validation errors return `400` with `field: "body"`.

There is one write-up per candidate. Repeated saves update it, and the last save wins. Both `requirePledgeManage` on the route and `mayEditPresentation` in the controller enforce access.

### `DELETE /rush-data/:id/presentation`

**Eboard or the pledge committee chair.** Clears the write-up. Returns `204`, or `404` when none exists. Use this endpoint to clear it instead of saving an empty string.

---

## Contact sheet

A CSV import of the chapter's contact spreadsheet, including people without portal accounts. Rows in `contact_sheet_rows` are a read-only reference and are not linked to portal user IDs. The former account-matching table was removed by migration `1790500000000`.

Read access requires `CONTACT_SHEET_GROUPS`: eboard, chair, active, or alumni. Pledges and rushees cannot read it. Keep this list separate from `SHARED_ALBUM_GROUPS`, since the sheet contains personal contact details for former members.

### `GET /contact-sheet`

Returns rows in spreadsheet order, using `row_index`. The website groups them by pledge class while preserving that order within each group.

### `POST /admin/contact-sheet/import`

**Eboard only.** Accepts `{ csv, headerRows }`. `csv` is the file contents as text, not a multipart upload. Replaces all rows in one transaction and returns `{ imported, sample }`, where `sample` contains the first three parsed rows.

Columns are matched by position, in this order:

`class_name, first_name, last_name, major, graduation_date, status, phone, personal_email, linkedin_url, instagram, job, notes`.

Check the returned sample for shifted columns. Header names are not used because they vary between exports.

The chapter's export needs `headerRows: 2`: a confidentiality banner followed by column names. Rows with neither a first nor last name are skipped. Columns beyond the listed fields are ignored, and cells containing `N/A` become null.

---

## Resumes

Authenticated users can upload their own resume. Reading is limited to the owner, eboard, or the pledge committee through `mayViewRushData`. Committee membership is read from Postgres.

### `PUT /resumes/me`

Multipart upload with a `file` field. Accepts PDF, `.doc`, and `.docx`, up to 10 MB. Returns `{ resume_filename, resume_mime, resume_uploaded_at }`.

Replaces the existing resume and deletes the old file. Upload permission is not restricted to the `rush` group, although the upload button appears on the rushee profile.

### `DELETE /resumes/me`

Deletes the file, clears its profile fields, and returns `204`.

### `GET /resumes/:id`

Streams the file for an authorized caller. `?download=1` forces a download. Otherwise PDFs are served inline; Word files are always attachments.

Responses include `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox`. The website proxy must forward both headers because it serves user-uploaded files under the website's origin. The `resume_mime` database constraint also restricts values to the supported MIME types.

---

## Interviews

Interview rounds contain slots for candidates and interviewers. The router requires authentication and a rush-accessible group, with additional permissions on individual routes. See [Interviews](../website/interviews.md) for the full workflow.

Candidate bookings and interviewer assignments have separate limits:

| Assignment | Table | Capacity field | Uniqueness |
| --- | --- | --- | --- |
| Candidate attending | `interview_bookings` | `capacity` | Slot and round |
| Member conducting the interview | `interview_slot_interviewers` | `interviewer_capacity` | Slot |

### `GET /interviews/available`

Returns published rounds and slots, including seats taken, `mine`, and `booking_id`. Other candidates' names are not returned.

### `GET /interviews/calendar`

Returns the caller's booked interviews in the event format used by the calendar and ICS feed.

### `POST /interviews/slots/:id/book`

Books a seat. Returns `409` with `code: "slot_full"` or `"already_booked"` when applicable. Missing and unpublished slots both return `404`.

### `DELETE /interviews/bookings/:id`

The caller can cancel their own booking; eboard and chairs can cancel others. A push notification is sent when someone else cancels the booking.

### `GET /interviews/interviewer-schedules`

**Members only; not rushees.** Returns published rounds assigned to a committee the caller belongs to, or `[]` if none apply. Committee membership requires approval through the join-request flow.

Slots include `interviewer_count`, `interviewers`, `i_am_interviewing`, and `bookings` with candidate names for the people conducting the interview.

### `POST /interviews/slots/:id/interviewers`

**Members only; not rushees.** An empty body assigns the caller. Eboard and chairs can send `{ "user_id": "..." }` to assign someone else.

Returns `403` if the required committee access is missing, or `409` with `code: "interviewers_full"` or `"already_signed_up"`.

### `DELETE /interviews/slots/:id/interviewers/:userId`

Removes the caller's assignment. Eboard and chairs can remove others; a push is sent when someone else removes the assignment.

### `GET /interviews/schedules`

**Eboard and chairs.** Returns every round, including drafts, with slot and seat counts.

### `POST /interviews/schedules`

**Eboard and chairs.** Creates a draft from `{ "title": "...", "description"?, "location"?, "interviewer_committee_ids"? }`.

### `GET /interviews/schedules/:id`

**Eboard and chairs.** Returns the full signup sheet, including slots, bookings, and interviewer assignments.

### `PATCH /interviews/schedules/:id`

**Eboard and chairs.** Updates round settings, including publication and interviewer committees. Changing `published` from false to true sends a push to current rushees. Saving an already-published round does not resend it.

Omitting `interviewer_committee_ids` preserves the current list. An empty array removes committee-based access to the round, leaving eboard access. A non-array or malformed ID returns `400`.

### `DELETE /interviews/schedules/:id`

**Eboard and chairs.** Returns `409` with `code: "has_bookings"` and the count when bookings exist. `?force=true` deletes the round and notifies affected participants.

### `POST /interviews/schedules/:id/slots`

**Eboard and chairs.** Accepts `{ "starts_at", "ends_at", "location"?, "capacity"?, "interviewer_capacity"? }`. Limits are 50 seats and 10 interviewers per slot, and 500 slots per schedule.

### `PATCH /interviews/slots/:id`

**Eboard and chairs.** Updates supplied keys only; an explicit null clears a nullable field.

Returns `409` if either capacity is lower than the number already assigned. This has no force override. Changing the start time notifies candidates and interviewers separately; capacity-only changes do not send notifications.

### `DELETE /interviews/slots/:id`

**Eboard and chairs.** Returns `409` with `code: "has_bookings"` for a booked slot unless `?force=true`. Candidates and interviewers receive separate notification wording.

---

## Polls

Polls target groups through `audience` and committees through `committee_ids`. The two sets are combined: a poll for pledges and Marketing reaches all pledges plus all Marketing members.

### `GET /polls`

Returns visible polls, or all polls for eboard. Each includes options, the caller's `my_option_ids`, and these flags:

| Flag | True when |
| --- | --- |
| `results_visible` | Caller is eboard, the poll is closed, or the caller has voted |
| `voters_visible` | Caller is eboard, or `show_voters` is enabled and results are visible |

Option `vote_count` and poll `total_votes` are omitted while results are hidden. Read the flags rather than deriving permissions in the client. Voter names are also withheld when they would reveal a hidden tally.

`is_closed` is calculated on each read from the manual-close flag or an elapsed `expires_at`.

### `POST /polls`

**Eboard only.** Example request:

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

At least two options are required. `expires_at` is optional; without it, voting remains open until manually closed. No scheduled job is needed to enforce expiration.

`audience` accepts the supported role groups, including `rush`, and returns `400` for unknown values. Rushees see polls only when explicitly targeted.

`show_voters` defaults to false. Enabling it allows eligible viewers to see individual votes once results are visible to them. It can be set only at creation; existing private votes cannot be made public through an edit.

### `PUT /polls/:id`

**Eboard only.** Updates `question`, `description`, `audience`, `committee_ids`, `expires_at`, and option labels:

```json
{
  "question": "Best meeting time?",
  "committee_ids": [3, 7],
  "options": [{ "id": 12, "label": "Monday 6pm" }]
}
```

`show_voters`, `multi_select`, and the set of option IDs are fixed at creation. Labels can change while the IDs and votes remain intact. An option ID from another poll returns `400`.

### `DELETE /polls/:id`

**Eboard only.** Deletes the poll.

### `PUT /polls/:id/close`

**Eboard only.** Closes voting manually. This is one-way and independent of `expires_at`.

### `POST /polls/:id/vote`

Authenticated callers in `RUSH_ACCESSIBLE_GROUPS` can vote on polls available to them. Accepts `{ "option_ids": [3] }`, with one ID unless `multi_select` is enabled. Replaces the caller's previous selection while the poll remains open.

### `GET /polls/:id/stats`

Returns per-option counts and a `voters` array of names and IDs.

Eboard can read the statistics. Other callers must be able to see the poll, have results visible, and have the poll's `show_voters` enabled. An inaccessible poll returns `404`; other unmet conditions return `403`. `pollsController.getPollStats` checks these permissions against the poll itself.

---

## Photos & Albums

These routes serve the member photo library. All require authentication and membership in `active`, `chair`, `alumni`, `eboard`, or `pledge`. The public gallery uses the separate Homepage Photos endpoints.

### `GET /photos?album_id=<id>`

Returns photos in the selected album. Omit `album_id` for the general Shared Album.

### `POST /photos`

Multipart upload with a `file` field. Accepts images or video up to 250 MB. Optional fields are `album_id`, `title`, and `caption`.

### `GET /photos/:id/media`

Streams the photo or video from Immich and forwards `Range` headers for seeking.

### `DELETE /photos/:id`

The uploader can delete their own photo. Eboard can delete any photo, including those in the general Shared Album.

### `GET /albums`

Lists named albums, such as Spring Retreat 2026. Available to shared-album-group members.

### `POST /albums`

**Eboard only.** Accepts `{ "name": "...", "description": "..." }`.

### `DELETE /albums/:id`

**Eboard only.** Deletes the album.

---

## Homepage Photos

The public chapter gallery is separate from the member photo library. Reads are public; writes require eboard.

### `GET /homepage-photos`

Returns gallery items ordered by `display_order`.

### `POST /homepage-photos`

**Eboard only.** Multipart upload with `file`, plus optional `title` and `caption`.

### `POST /homepage-photos/register`

**Eboard only.** Registers an existing Immich asset:

```json
{ "immich_asset_id": "...", "media_type": "image", "title": "...", "caption": "..." }
```

The API checks that the asset exists before saving.

### `GET /homepage-photos/:id/media`

Publicly streams the photo or video.

### `PUT /homepage-photos/reorder`

**Eboard only.** Accepts `{ "ids": [3, 1, 2] }` and sets `display_order` from the array positions. Register this route before `/:id`.

### `PUT /homepage-photos/:id`

**Eboard only.** Updates `{ "title": "...", "caption": "..." }`. Omitted keys remain unchanged; null or an empty string clears the field. The asset and `media_type` cannot be changed through this endpoint.

### `DELETE /homepage-photos/:id`

**Eboard only.** Removes the gallery entry while preserving its Immich asset, which may be used elsewhere.

### `GET /homepage-photos/collections`

**Public.** Returns collections with nested photos. `?featured=true` selects the featured collections, subject to the server's cap.

Collections are ordered by `display_order`, then newest `event_date`, then ID. Undated collections sort last. The homepage uses featured collections; `/gallery` shows the archive. Keeping the featured set small limits downloads of original media assets.

### `GET /homepage-photos/collections/manage`

**Eboard only.** Returns collections with `photo_count` instead of nested photos.

### `POST` / `PUT` / `DELETE /homepage-photos/collections`

**Eboard only.** Create with `POST /homepage-photos/collections`; update or delete with `/homepage-photos/collections/:id`.

Fields are `{ title, subtitle?, event_date?, link_url?, link_label?, is_featured? }`. Updates are partial: omitted fields stay unchanged and null clears a nullable field.

`link_url` must use HTTPS and is validated by `services/urls.js`. A label without a URL is rejected.

Deletion returns `409` with `code: "has_photos"` and `photo_count` unless `?force=true`. Deleting a collection cascades its gallery photo rows but preserves the Immich assets.

Register collection routes before general `/:id` routes in `routes/homepagePhotos.js` to prevent Express from treating `collections` as a photo ID.

---

## LinkedIn Posts

The [LinkedIn embed bot](../website/linkedin-spotlight.md) imports chapter posts from Discord for the public homepage and `/spotlight`.

### `GET /linkedin-posts`

**Public.** Returns published posts, newest first. `?limit=` defaults to 24 and is capped at 50.

Posts older than six months are excluded based on the publication timestamp encoded in the LinkedIn ID. This is a read-time filter; rows are not deleted or unpublished when they age out.

Public fields are `id`, `linkedin_post_id`, `linkedin_urn`, `source_url`, `embed_url`, and `created_at`. Discord message and submitter IDs are omitted.

### `POST /linkedin-posts/ingest`

**Bot only.** Authenticates with `X-Bot-Secret`, not a bearer token. Accepts `{ linkedin_urn, source_url, discord_message_id, submitted_by_discord_id }`.

The API derives `linkedin_post_id` and `embed_url` from the URN and upserts by URN, so rescanning channel history does not create duplicates.

Keep LinkedIn IDs as strings. Their 19-digit values exceed `Number.MAX_SAFE_INTEGER`; numeric input is rejected to prevent rounding an ID.

### `DELETE /linkedin-posts/ingest`

**Bot only.** Accepts `{ discord_message_id }` and unpublishes posts from that message. Returns `{ "unpublished": n }`, including `200` with zero when nothing matches.

Discord deletion events may contain only the message ID, so this endpoint does not require a URN or the deleted message's content. Rows remain available for review or republication in the admin panel.

### `GET /linkedin-posts/all`

**Eboard only.** Returns published and unpublished posts with Discord attribution, `posted_at`, `is_too_old`, `unavailable_at`, and `last_checked_at`. These fields distinguish public visibility, unavailable posts, and posts that have not been checked.

### `POST /linkedin-posts/check-availability`

**Eboard only.** Runs a fresh availability check and returns `{ summary, posts }`, with `posts` in the `/all` shape.

The check updates `last_checked_at` and may set or clear `unavailable_at`. It uses `staleAfterMs: 0` and checks at most 15 posts, compared with the worker's 40-post limit. Requests are spaced by 1.5 seconds. See [Checking on demand](../website/linkedin-spotlight.md#checking-on-demand).

### `PUT /linkedin-posts/:id`

**Eboard only.** Accepts `{ "is_published": true | false }`. Missing or non-boolean values return `400`.

Keep `/all` and `/ingest` above parameterized routes that could match them.

---

## Documents

The Files & Photos tab stores documents on the API server's disk, separately from Immich. Shared-album-group members can read files they are allowed to see. Pledges have read access but cannot contribute; rushees cannot access the router.

| Permission | Groups |
| --- | --- |
| Upload files, add links, create unrestricted folders, rename or delete their own documents | `DOCUMENT_CONTRIBUTOR_GROUPS`: eboard, chair, active, alumni |
| Move folders/documents, rename folders, rename others' documents | Eboard and chairs |
| Delete others' documents, delete folders, set visibility | Eboard |

Keep `DOCUMENT_CONTRIBUTOR_GROUPS` explicit rather than deriving it from read-access groups. `ownsOrManages` uses different manager lists for renaming and deletion; `test/documentOwnership.test.js` covers the distinction.

Folder listing checks the caller's access to the folder. A document without an override inherits its folder's audience; an explicit override supplies its own audience. Direct preview and download use that effective document audience in `findViewableDocument`. Do not assume an explicit override is always intersected with the folder's audience.

Only eboard bypasses visibility restrictions. Inaccessible folders and documents return `404` rather than confirming their existence with `403`.

### `GET /documents/folders?parent_id=<id>`

Lists subfolders. Omit `parent_id` for the top level.

### `POST /documents/folders`

**Document contributors.** Accepts `{ "name": "...", "parent_id": null }`. Folders can nest.

Non-eboard callers receive `403` if they supply non-empty `audience` or `committee_ids`, and `404` for an inaccessible parent. Folder deletion remains eboard-only because it can remove other people's files.

The portal's [Upload Folder](../website/photos-and-documents.md#uploading-a-folder) operation combines this endpoint with `POST /documents`. There is no bulk endpoint or transaction; both operations must be available to the caller.

### `PATCH /documents/folders/:id/visibility`

**Eboard only.** Accepts `{ "audience": [...], "committee_ids": [...] }`.

### `PATCH /documents/folders/:id/parent`

**Eboard and chairs.** Accepts `{ "parent_id": 3 }`, or null to move to the top level. The folder retains its own visibility settings.

Moving into itself or a descendant returns `400`. `documentFolderModel.isDescendant` checks this with a recursive CTE that includes the folder itself.

### `DELETE /documents/folders/:id`

**Eboard only.** Deletes the folder subtree and document rows, and removes nested files from disk.

### `GET /documents?folder_id=<id>`

Lists documents in a folder. Omit `folder_id` for the top level.

### `POST /documents`

**Document contributors.** Multipart upload with `file`, up to 50 MB, and optional `folder_id`. Accepts arbitrary file types.

The API validates the folder ID and access before inserting a row. If validation or permission checks fail after multer has saved the upload, `discardUpload` removes the file.

### `GET /documents/:id/download`

Streams the file with `Content-Disposition: attachment` and its download filename.

### `GET /documents/:id/preview`

Streams the same file with `Content-Disposition: inline` for the portal preview, including images and PDFs.

### `POST /documents/link`

**Document contributors.** Adds a link alongside files:

```json
{ "folder_id": null, "filename": "Meeting Notes", "url": "https://docs.google.com/..." }
```

Rows have `kind: "file" | "link"`. A link has `url` set and no `mime_type`, `file_size`, or `storage_path`.

### `PATCH /documents/:id/visibility`

**Eboard only.** Accepts `{ "audience": [...], "committee_ids": [...] }`. An empty body restores inheritance from the folder. Empty arrays instead create an explicit unrestricted override; they are not equivalent to inheritance.

### `PATCH /documents/:id/folder`

**Eboard and chairs.** Accepts `{ "folder_id": 3 }`, or null for the top level. Audience columns are unchanged. An inheriting document uses the new folder's audience; an explicit override stays in place.

### `PATCH /documents/:id`

**Uploader, eboard, or chair.** Accepts `{ "filename": "March Minutes.pdf" }`. Renames the display/download name for files and links without changing `storage_path`.

Invalid names return `400` before lookup. An inaccessible document returns `404`; a visible document that the caller cannot rename returns `403`.

The endpoint does not require a file extension. Preview still uses `mime_type`, but downloaded files may be harder to open without an extension. The portal selects only the basename in its rename dialog to retain the extension by default.

### `PATCH /documents/folders/:id`

**Eboard and chairs.** Accepts `{ "name": "Fall 2026 Resources" }`. Changes the name only, preserving parent and audience. An inaccessible folder returns `404`.

### `DELETE /documents/:id`

**Uploader or eboard.** Deletes the row and, for a file, its disk contents. Link rows have no disk file.

Visibility is checked before ownership: an inaccessible document returns `404`; a visible document owned by someone else returns `403` unless the caller is eboard. A null `uploaded_by` grants no ownership, so only eboard can delete those rows. Moving a member's upload into a restricted folder can also remove that member's access to it.

---

## Announcements

Announcements are one-way posts with no replies. Reads require a rush-accessible group and are filtered by audience. Targeting combines an `audience` array with an optional single `committee_id`.

| Caller | Create | Edit or delete |
| --- | --- | --- |
| Eboard | Any targeting | Any announcement |
| Chair | Chapter-wide or audience-targeted posts; named committee must be one they chair | Their own posts or posts belonging to a committee they chair |
| Other callers | Not allowed | Not allowed |

`checkAnnouncementCreate` checks new targeting. `checkAnnouncementMutate` checks the existing row, including `posted_by` for a chair's own chapter-wide post. An edit must pass both checks; changing the target does not grant permission to edit someone else's post. Media deletion uses the same existing-post rule.

### `GET /announcements`

Returns visible announcements. Members see untargeted posts plus those matching their token groups or committee membership. Eboard sees all posts. Rushees see ordinary announcements only when `rush` is explicitly targeted.

### `POST /announcements`

**Eboard and chairs, subject to the rules above.** Example JSON body:

```json
{ "title": "...", "body": "...", "audience": ["active", "chair"], "committee_id": null }
```

An empty or omitted audience with no committee targets all member groups. Valid audience values are `eboard`, `chair`, `active`, `pledge`, `alumni`, and `rush`; other values return `400`.

### `PUT /announcements/:id`

Updates an announcement after checking both the existing row and requested targeting.

### `DELETE /announcements/:id`

Deletes an announcement the caller can manage, its media rows, and their Immich assets.

### Photos, videos and links

Both announcement boards support up to 10 photos or videos and 5 labelled links. `POST` and `PUT` accept JSON or multipart form data. Upload files under `media`, up to 100 MB each. Supported formats are JPEG, PNG, WebP, HEIC, MP4, MOV, and WebM.

For multipart requests, JSON-encode `audience` and `links`. Files are uploaded before the announcement is inserted and notifications are sent. If one upload fails, completed uploads from that operation are removed and the post is not created.

| Method | Path | Behavior |
| --- | --- | --- |
| `GET` | `/announcements/media/:mediaId` | Streams media; accepts `?size=thumbnail\|preview` and forwards Range headers |
| `DELETE` | `/announcements/media/:mediaId` | Uses the parent announcement's management permission |
| `GET` | `/rush-announcements/media/:mediaId` | Streams media for eligible rush-announcement readers, including rushees |
| `DELETE` | `/rush-announcements/media/:mediaId` | Eboard and chairs |

New files append on `PUT`; use the media delete endpoint to remove an existing file.

`announcement_media` has two nullable parent foreign keys with a check requiring exactly one. An endpoint given media from the other board returns `404`. Asset IDs are not returned to clients; media routes recheck the parent post's visibility and return `404` when access is denied.

Links use `[{ label, url }]` and the shared `services/linkList.js` validator. URLs are checked for an allowed protocol, not just whether `new URL()` can parse them.

---

## Messages (Direct Messages)

Members can message each other without joining a chat. Direct and group message sends are limited to 20 per minute per user by the in-memory `middleware/rateLimit.js`; exceeding the limit returns `429`.

`POST /messages` returns `403` if either party has blocked the other. Conversation and thread reads filter blocked users' messages for the caller who blocked them.

### `GET /messages/conversations`

Returns each conversation partner's basic information, the last message, and an unread count, sorted by most recent activity.

### `GET /messages/conversations/:userId`

Returns the two-person thread in chronological order.

### `POST /messages`

Multipart fields: `recipient_id`, `body`, `file`, and optional `reply_to_id`. Supply text, a file, or both. Attachments are limited to 25 MB.

`services/messageAttachments.js` sends images to Immich and saves other attachments under `uploads/message-attachments/` on the API server.

#### Replies

`reply_to_id` must reference a message in the same two-person conversation, or the same chat for a group message. A target outside that conversation returns `400`, preventing a reply preview from exposing another conversation.

Message reads and the send response include `reply_to`, either null or an object with the parent's `id`, `sender_id`, `sender_display_name`, `body`, and `attachment`. The insert uses a CTE to join this information into the response.

The foreign key uses `ON DELETE SET NULL`: deleting a parent keeps its replies and sets their `reply_to` to null.

### `PUT /messages/conversations/:userId/read`

Marks messages from that user to the caller as read.

### `GET /messages/unread-count`

Returns the total unread count across the caller's conversations.

### `GET /messages/:messageId/attachment`

Streams an attachment to its sender or recipient.

### `POST /messages/:messageId/reactions`

Accepts `{ "emoji": "👍" }`. Sending the same emoji again removes the reaction.

### `DELETE /messages/:messageId`

The sender can delete their message. Eboard can delete messages in conversations they participate in.

---

## Group Chats

Chats can have explicit members or derive membership from an audience or committee. Access is checked against the caller's membership in that chat; a broad Authentik group alone does not grant access. Message sends have the same rate limit as direct messages.

Blocking does not prevent another member from posting in a shared chat. It hides that person's messages from the caller who blocked them.

### `GET /group-chats`

Returns the caller's chats with their last message and unread count.

### `POST /group-chats`

**Eboard only.** Creates an official chat with `name`, `member_ids`, `audience`, and `committee_ids`. The creator is automatically added.

### `POST /group-chats/member`

**Currently returns `403` for everyone.** `MEMBER_CHAT_CREATION_ENABLED = false` in `routes/groupChats.js` disables creation without affecting existing chats. The [website flag](../website/messaging.md#member-created-chats) must also be enabled when restoring this feature.

When enabled, accepts `{ "name": "...", "member_ids": ["uuid", "uuid"] }` from callers in `eboard`, `chair`, `active`, `alumni`, or `pledge`. Use this positive group list: accepted members may still have `rush` alongside their new group.

Creates a chat with `is_member_created = TRUE`, administered by its creator and excluded from eboard oversight. It does not accept `audience` or `committee_ids`. A rushee member ID returns `400`; an ID without a live account returns `404`.

### `PATCH /group-chats/:id`

**Chat administrator.** Accepts `{ "name": "..." }`. A blank or whitespace-only name returns `400` and leaves the existing name unchanged.

### `DELETE /group-chats/:id`

**Chat administrator.** Deletes the chat and cascades its members, messages, and read markers.

### `DELETE /group-chats/:id/leave`

Removes the caller's explicit membership. Returns `403` if they are not a member, or `409` if membership comes from the audience or a committee.

A member-created chat's creator also receives `409` because leaving would remove its administrator. They can delete the chat instead.

### `GET /group-chats/:id/messages`

Returns the thread. Non-members receive `403`.

### `POST /group-chats/:id/messages`

Members can send multipart `body`, `file`, or both, with an optional `reply_to_id`. The attachment limit is 25 MB. A reply must target this chat; another chat's message returns `400`. See [Replies](#replies).

### `PUT /group-chats/:id/read`

Marks the chat read for the caller.

### `GET /group-chats/unread-count`

Returns the total unread count across the caller's chats.

### `GET /group-chats/:id/messages/:messageId/attachment`

Streams the attachment to a chat member.

### `POST /group-chats/:id/messages/:messageId/reactions`

Chat members can toggle a reaction with `{ "emoji": "👍" }`.

### `DELETE /group-chats/:id/messages/:messageId`

The sender, or eboard participating in the chat, can delete the message.

### `PUT /group-chats/:id/photo`

**Chat administrator.** Multipart upload under `file`. Uses the [profile-picture uploader](#put-usersmeprofile-picture), including its accepted formats, 25 MB limit, and conversion to a resized JPEG.

### `GET /group-chats/:id/photo/media`

Streams the avatar to a chat member.

### `GET /group-chats/:id/members`

Returns the participant list to a chat member.

### `POST /group-chats/:id/members`

**Chat administrator.** Accepts `{ "user_id": "uuid" }`.

### `DELETE /group-chats/:id/members/:userId`

**Chat administrator.** Returns `409` if the target's membership comes from the audience or a committee, since deleting an explicit row would not remove their access.

### Chat administration

| Chat type | Administrator |
| --- | --- |
| Official (`is_member_created = FALSE`) | Eboard |
| Member-created (`is_member_created = TRUE`) | Its `created_by` user |

These rules apply to rename, delete, photo upload, audience changes, and member additions/removals. Controllers check the chat row; these routes do not use a router-level group check. Creating an official chat does not grant an additional administration right through `created_by`.

`PATCH /group-chats/:id/audience` returns `409` for member-created chats, including requests from their creator.

Committees do not own a separate chat. Set `committee_ids` on a chat to derive its membership at read time. The former automatically synced Eboard chat was removed in migration `1788800000000`; see [Messaging](../website/messaging.md#the-eboard-chat-was-removed).

---

## Tickets

Tickets let members send concerns, suggestions, and questions to eboard and the judicial committee. Routes require authentication and `SHARED_ALBUM_GROUPS`; rushees do not have access.

Tickets are separate from moderation reports. They do not require a person or content target, and use `open`, `in_progress`, and `closed` statuses.

| Method | Path | Who | Body / notes |
| --- | --- | --- | --- |
| `POST` | `/tickets` | Any member | `{ category, subject, body, anonymous? }`; category: `concern`, `suggestion`, `question`, or `other`; subject up to 150 characters; body up to 5000 |
| `GET` | `/tickets` | Eboard or judicial committee | Optional `?status=open\|in_progress\|closed` |
| `GET` | `/tickets/mine` | Any member | Their own signed tickets |
| `GET` | `/tickets/access` | Any member | `{ can_view }` for queue visibility |
| `PUT` | `/tickets/:id` | Eboard or judicial committee | `{ status?, response? }` |

### Anonymous by default

Only an explicit boolean `false` signs a ticket. Missing values, strings, and other values leave it anonymous. Reports are named unless anonymity is explicitly requested.

`middleware/auditLog.js` skips the exact path `/^\/tickets$/` for all ticket creation, so its audit records do not identify anonymous authors. Updates to `/tickets/:id` remain audited.

### Author state {#is_anonymous-is-a-real-column-not-an-inference}

Use `is_anonymous`, not a null `author_id`, to identify anonymous tickets. Deleting a signed author's account also clears the author foreign key.

| `is_anonymous` | `author` | `author_departed` | Meaning |
| --- | --- | --- | --- |
| `true` | `null` | `false` | Anonymous submission |
| `false` | Object | `false` | Signed submission |
| `false` | `null` | `true` | Signed submission whose author has left |

### Anonymous ticket access {#accepted-costs}

An anonymous submitter cannot read the ticket or a response through `/tickets/mine`, since no author ID connects it to their account. The form explains this before submission.

Queue access uses `reportsController.mayModerateReports`: eboard or membership in the judicial committee. The `chair` group alone does not grant access.

---

## Reports & Moderation

Reports identify a person or content for moderation. Rush-accessible members can submit them; eboard and the judicial committee can review and update them.

`reportsController.mayModerateReports` checks eboard status or membership in the committee with [`slug = 'judicial'`](#committee-slugs). It grants access to the whole judicial committee. The `chair` group alone does not qualify. If no committee has that slug, only eboard has access. `test/judicialReports.test.js` covers this permission rule.

### `POST /reports`

Accepts `content_type`, `content_id`, `reported_user_id`, `reason`, `explanation`, and optional `anonymous`.

| Field | Rule |
| --- | --- |
| `content_type` | `user`, `message`, `group_message`, or `photo` |
| `content_id` | Positive int4-range integer; required except for `user`, which must omit it |
| `reported_user_id` | Canonical UUID; required for `user`, optional otherwise; `404` if the account does not exist |
| `reason` | Required; up to 100 characters |
| `explanation` | Optional; up to 2000 characters |
| `anonymous` | Boolean `true` or string `"true"` submits anonymously; every other value submits a named report |

The API validates `reported_user_id` but accepts the client's attribution rather than deriving the author from the reported content. It validates `content_id` even though the shared database column is text. Oversized reason and explanation values are rejected without truncation.

#### Anonymous reports {#anonymous-tickets}

Anonymous reports store a null `reporter_id` and return `reporter: null` in the queue. The stored report cannot identify an account for follow-up.

The audit middleware skips the exact creation path `/^\/reports$/` for all reports. Keep this exclusion: recording the creator's `actor_id` in an audit row would undermine anonymity even with a null `reporter_id`. Updates to `/reports/:id/status` remain audited.

### `GET /reports/access`

Returns `{ "can_view": true | false }` with `200` either way. Clients can use it to decide whether to show the queue.

### `GET /reports`

**Eboard or judicial committee.** Accepts optional `?status=open|resolved|dismissed`. Returns joined reporter and reported-user information.

### `PUT /reports/:id/status`

**Eboard or judicial committee.** Accepts `status` (`resolved`, `dismissed`, or `open`) and `moderator_response`. Moving away from `open` sets `resolved_by` and `resolved_at`.

The website exposes this queue at `/member/reports` for judicial members and `/admin/oversight` for eboard. Judicial membership does not grant access to `/admin`.

---

## Admin

All routes below require `requireAuth` and `requireGroup("eboard")`.

### `GET /admin/users`

Returns the admin user list, including profile fields needed by the edit form. Deleted accounts are excluded.

### `PUT /admin/users/:authentikId/group`

Accepts `group`: `eboard`, `chair`, `active`, `alumni`, or `pledge`. Changes the role in Authentik, removing other role groups, then updates `users.member_group`. See [Changing a member's group](./overview.md#eboard-changing-a-members-group) for required Authentik setup.

### `GET /admin/exec-roles`

Returns active positions ordered by `sort_order`, then `label`. Fields are `id`, `slug`, `label`, `sort_order`, `is_active`, and `holder_count`, which counts live members only.

Use `?includeInactive=1` to include retired roles for administration and existing assignments.

### `POST /admin/exec-roles`

Accepts `{ "label": "Vice President of Operations", "sortOrder": 8 }`. `sortOrder` defaults to zero and must be an integer from 0 to 999.

The API derives `slug` from the label; callers cannot supply it. Collisions receive a suffix such as `-2`.

### `PUT /admin/exec-roles/:id`

Partially updates `label`, `sortOrder`, or `isActive`. Omitted fields remain unchanged. The slug cannot be changed; see [Exec roles](./overview.md#exec_roles-table).

Renaming also updates `users.exec_title` for current holders. `isActive: false` hides the role from the default list while preserving assignments.

### `DELETE /admin/exec-roles/:id`

Returns `204` if nobody holds the role. Otherwise returns `409` with the holder count. Retire an assigned role instead of deleting it.

### `PUT /admin/users/:authentikId/exec-role`

Accepts `{ "execRoleId": 3 }`, or `{ "execRoleId": null }` to clear the assignment.

Writes both `exec_role_id` and `exec_title`, reading the label from the role row. Returns `404` if the member or role no longer exists. New clients should use this endpoint.

### `PUT /admin/users/:authentikId/exec-title`

Legacy free-text update: `{ "execTitle": "President" }`. A null or omitted value clears the title.

This route remains available for text that could not be matched during the role migration. It does not attach a role slug. Use `exec-role` for new assignments.

The title is a display value. This endpoint does not change Authentik groups or check the title against `member_group`; the directory and public roster display it for eboard members.

### `PUT /admin/users/:authentikId/profile`

Uses the same profile fields and shared `services/profileFields.js` validation as [`PUT /users/me/profile`](#put-usersmeprofile). Returns `404` for unknown or deleted accounts.

It does not create a user, set `profile_complete`, or apply the member route's alumni email guard. See the [API README](https://github.com/ktpuga/ktp-api#eboard-editing-another-members-profile).

:::warning Include the complete profile
This endpoint writes absent profile fields as `NULL`, unlike the member endpoint's partial-update behavior.

Seed the form from `GET /admin/users` and include all editable fields, including `dob`, `phone`, `personal_email`, `linkedin_url`, `about_me`, `minors`, `gpa`, and `heard_from`. Keep recruitment fields in the form after a member leaves the `rush` group so unrelated edits do not erase them.

When adding a field, update `PROFILE_FIELDS`, `findAll`, and `adminUpdateProfile` together.
:::

### `PUT /admin/users/:authentikId/username`

Accepts `{ "username": "newname" }`. Updates Authentik first, then Postgres. Returns `409` if taken or `502` if the Authentik update fails; check the service account's `Can change User` permission.

### `PUT /admin/users/:authentikId/profile-picture`

Multipart upload under `file`. Uses the member [profile-picture handler](#put-usersmeprofile-picture), including its formats, 25 MB limit, and JPEG conversion.

### `DELETE /admin/users/:authentikId/profile-picture`

Clears `profile_picture_asset_id` so the profile falls back to initials. The Immich asset is retained for review.

Admin profile changes are recorded by the global [activity-log middleware](../website/activity-log.md).

---

## Notifications

These authenticated routes manage iOS APNs registration, notification preferences, and website badge counts. Device tokens are private to their owner and are not returned by list endpoints.

### `POST /notifications/devices`

Accepts `token` (64 hexadecimal characters), `platform: "ios"`, and `environment` (`development` or `production`). Registers or transfers an APNs token.

Use `development` for local/debug builds and `production` for TestFlight/App Store builds. The API selects that environment's credentials and APNs host.

### `DELETE /notifications/devices/:token`

Removes the caller's registration for that token.

### `GET /notifications/preferences`

Returns seven booleans, creating a missing preferences row with all values set to true:

`direct_messages_enabled`, `announcements_enabled`, `polls_enabled`, `meetings_enabled`, `events_enabled`, `event_reminders_enabled`, and `email_enabled`.

The first six control iOS push notifications. The website exposes `email_enabled` for email preferences.

### `PUT /notifications/preferences`

Updates supplied booleans. Omitted fields retain their previous values.

### `GET /notifications/unread`

Returns website badge counts:

```json
{
  "announcements": 3,
  "calendar": 1,
  "meetings": 0,
  "polls": 2,
  "interviews": 0,
  "committees": 2,
  "tickets": 1,
  "reports": 0,
  "ticket_queue": 0
}
```

Cursor-based counts include visible items newer than the user's cursor. Missing cursors are initialized to now, so older content does not become unread. The following counts use different rules and can be nonzero on the first request:

| Key | Counts |
| --- | --- |
| `meetings` | Unanswered invitations |
| `committees` | Per-committee unread counts and approval queues |
| `reports` | Open reports after the queue's fixed cutoff |
| `ticket_queue` | Tickets not yet closed after the queue's fixed cutoff |

Visiting the tab does not clear these counts. Committee unread state is tracked per committee; pending invitations and queue items clear through the corresponding actions.

`reports` and `ticket_queue` are zero unless `mayModerateReports` grants access to eboard or a judicial committee member. They have no cursor rows and are not valid targets for `POST /notifications/seen`.

`tickets` counts updates to the caller's signed tickets since they last opened the page, including responses and status changes. Anonymous submissions have no author to notify.

Counts follow the corresponding content visibility rules. Untargeted announcements and events count for members, not rushees; rushees' announcement counts come from `rush_announcements`. A user's own posts, closed or expired polls, and cancelled meetings do not count. `files` is no longer returned.

### `POST /notifications/seen/:tab`

Moves a tab cursor to now. Returns `204`, or `400` for an invalid tab.

Accepted tabs: `announcements`, `calendar`, `meetings`, `polls`, `interviews`, `committees`, and `tickets`. The database also constrains tab names; extending the supported set may require a migration.

DM push alerts are sent after the message is saved, to the permitted recipient, without the message body. Event alerts cover creation, material changes, and cancellation for eligible recipients with notifications enabled. APNs failures are logged without failing the underlying API request.

Credentials come from `APNS_PRODUCTION_*` and `APNS_SANDBOX_*` environment variables, not a `.p8` file. Incomplete credentials disable only the affected environment.

Events and meetings have durable reminder jobs at two hours and 30 minutes before their start. Required events also have a one-day reminder titled "Required event." Event writes rebuild the jobs, and deletion removes them. Reminders use APNs only.

### `GET /notifications/channels`

Returns `{ "email": true | false }` to indicate whether the deployment can send email. The website uses this to show or hide its email checkbox.

`POST /announcements` and `POST /events` accept `send_email: true`. Each eligible recipient gets an individual email, excluding deleted accounts, test accounts, and users who disabled email.

An atomic claim through `announcements.emailed_at` or `events.emailed_at` limits each item to one email send; edits do not resend it. Sending requires `RESEND_API_KEY` and `EMAIL_FROM`. Missing credentials produce a warning without preventing the underlying operation.

---

## iOS Homepage Slideshow

These routes serve the authenticated iOS home screen. The public website gallery uses the separate Homepage Photos routes above.

Reads require authentication; writes require eboard. A slide is visible when active and within its optional `starts_at` and `ends_at` schedule. Responses do not expose Immich asset IDs.

### `GET /ios-homepage-photos`

Returns visible slides in display order as `{ "slides": [...] }`.

Eboard can use `?include_hidden=true` to include inactive, scheduled, and expired slides for administration. Keep this opt-in and permission check: the iOS app uses the same endpoint without the flag.

### `GET /ios-homepage-photos/:id/media`

Streams a visible slide. Eboard can also fetch hidden slides. Supports `ETag` and `If-None-Match`.

### `POST /ios-homepage-photos`

**Eboard only.** Multipart `file` with required `title` and `alt_text`.

Optional fields: `subtitle`, `link_url` (HTTPS only), `link_label`, `is_active` (defaults to true), `starts_at`, `ends_at`, `focal_x`, and `focal_y`.

### `POST /ios-homepage-photos/register`

**Eboard only.** Creates a slide from `immich_asset_id` with the same metadata as an upload.

### `PUT /ios-homepage-photos/:id`

**Eboard only.** Partially updates metadata.

### `PUT /ios-homepage-photos/:id/image`

**Eboard only.** Replaces the image while preserving metadata, schedule, and position. Multipart `file` accepts optional `focal_x` and `focal_y` and uses the same processing as creation.

The API updates the row before deleting the old asset. A failed cleanup can leave an unused asset without breaking the slide. The `updated_at` trigger changes the media ETag so clients can detect the replacement when revalidating.

### `PUT /ios-homepage-photos/reorder`

**Eboard only.** Accepts `{ "ids": ["1", "2", "3"] }`.

### `DELETE /ios-homepage-photos/:id`

**Eboard only.** Deletes the slide and its generated 1500 × 1000 image. For registered slides, the original recorded in `source_immich_asset_id` is retained.

The slideshow supports up to 10 active slides. Uploads are limited to 100 MB and accept JPEG, PNG, HEIC, HEIF, and WebP. Animated images are rejected. Sources must be at least 900 × 600.

### Crop calculation

`services/iosSlideshowImage.js` extracts the largest 3:2 region around the focal point, clamping its position to the source bounds:

```text
cropWidth  = min(W, H * 1.5)
cropHeight = min(H, W / 1.5)
left = clamp(W * focal_x - cropWidth / 2)
top  = clamp(H * focal_y - cropHeight / 2)
```

Wide sources crop horizontally at full height; tall sources crop vertically at full width. Client previews must calculate this from the source dimensions, before fitting the result into a 3:2 container.

---

## Webhooks

### `POST /webhooks/authentik`

Authentik's notification transport calls this endpoint when a user is deleted.

Required header:

```text
X-Authentik-Token: <WEBHOOK_SECRET>
```

Request body:

```json
{
  "event": {
    "action": "model_deleted",
    "context": {
      "model": {
        "model_name": "user",
        "pk": 42
      }
    }
  }
}
```

The callback removes the user's row from `users`. Configure the Authentik notification rule as follows:

1. Set a Group or enable "Send notification to event user." A rule with neither does not send the notification.
2. In the bound Event Matcher Policy, leave App blank. Set Action to `Model Deleted` and Model to `User (authentik_core)`. The App field matches `event.app`, not `event.context.model.app`.

If the callback is not sent, inspect `docker logs worker` on the Authentik host. The `policy_execution` entries show which matching criteria passed or failed.

---

## Error Responses

| Status | Meaning |
| --- | --- |
| `400` | Missing or invalid request fields |
| `401` | Missing or invalid bearer token |
| `403` | Permission denied or an operation refused by a feature rule |
| `404` | Resource missing or hidden from the caller |
| `409` | Conflict with current state |
| `413` | Upload exceeds the route's limit |
| `415` | Unsupported file type or undecodable image |
| `429` | Rate limit exceeded |
| `500` | Internal server error |
| `502` | Upstream service failure |

The standard error body is:

```json
{ "message": "Error description" }
```

Clients should follow the response format of the endpoint they call. Upload errors also include a machine-readable `code`, such as `upload_too_large`, `unsupported_media_type`, or `unexpected_file_field`.

Upload routers use `middleware/upload.js`'s shared `uploadErrorHandler`. It returns `message` and derives the size limit from `LIMITS_MB`. Keep errors compatible with the website's `lib/portal-api.js` error handling so the member receives the API's explanation.

---

## Correlating a check-in failure

The website sends `X-Checkin-Attempt-Id` with each attempt. Direct API callers can supply a UUID or let the API generate one. The API returns the ID in the same header and logs a `[checkin_attempt]` completion record for successful and failed responses, including refusals before the controller. The ID is diagnostic and grants no access.

The API record includes the event, verified user when available, HTTP status, processing stage, provider auth error code or claim, verified bearer lifetime remaining, controller refusal reason, and repair or write outcome. Database exceptions include a safe SQLSTATE.

For stale or wrong attendance codes, `matchedBucketOffset` searches one future bucket through six previous buckets using the same timestamp as validation. Null means no match in that range. Acceptance still requires the current or previous 10-second bucket; the wider diagnostic search does not grant attendance.

The website record shares the attempt ID and adds authentication, API, and total durations; whether the credential changed; and the outgoing token's unverified expiry delta.

To investigate an error:

1. Find the reference shown on the member's error screen.
2. Locate the website and API records with that attempt ID.
3. Check whether the API was reached. `apiStatus: null` means the website received no API response.
4. Use the API stage, auth error, and refusal reason to distinguish credential failures from attendance rules. Compare timings and bucket offsets when the code expired.

Do not copy bearer tokens or QR URLs into diagnostic notes. Completion logs cannot capture a process crash or a request that never finishes.

Deploy the website and API correlation changes together. They require no schema migration or Authentik configuration change. The credential-forwarding repair addresses a reproduced defect; confirming the cause of the historical incident still requires production evidence.

---
