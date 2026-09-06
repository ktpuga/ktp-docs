---
sidebar_position: 8
---

# Interviews

Interview managers publish rounds of timed slots. Candidates claim a seat, and designated members can separately sign up to conduct interviews.

Management requires eboard or the chair of the committee marked `slug = 'pledge'`. The general `chair` group does not grant it.

| Claim | Table | Limit |
| --- | --- | --- |
| Candidate booking | `interview_bookings` | One per candidate per round |
| Interviewer signup | `interview_slot_interviewers` | One per member per slot; multiple slots allowed |

Candidates use `/rushee/interviews`. Management and interviewer views use their authorized portal routes; do not place pledge-chair functionality only under `/admin`.

## Why not just use meetings?

Meetings invite named people who respond. Interviews publish limited capacity that candidates claim. Booking therefore requires concurrency control rather than only an invitee response.

## Schema

Scheduling was introduced by migration `1786600000000` and interviewer signup by `1787600000000`.

```text
interview_schedules
  -> interview_slots
       -> interview_bookings
       -> interview_slot_interviewers
```

### `interview_schedules`

A round has a title, optional description/default location, publication state, and `interviewer_committee_ids`. Empty committee targeting grants no ordinary committee member permission to staff it; managers have separate access.

### `interview_slots`

| Field | Counts | Default |
| --- | --- | --- |
| `capacity` | Candidate seats | 1 |
| `interviewer_capacity` | Interviewer places | 1 |

Slots can override the round's location. Interviewer assignments use the signup table rather than the former single `interviewer_id` column. The migration backfilled earlier assignments; a leftover legacy column is not the active source.

### `interview_slot_interviewers`

`UNIQUE (slot_id, user_id)` prevents duplicate signup for a slot. There is no one-per-round constraint because an interviewer can cover several times.

### `interview_bookings`

Bookings enforce both `UNIQUE (slot_id, user_id)` and `UNIQUE (schedule_id, user_id)`.

The stored schedule ID is tied to its slot by:

```sql
FOREIGN KEY (slot_id, schedule_id)
REFERENCES interview_slots (id, schedule_id)
```

The corresponding unique slot/schedule target supports that foreign key, keeping the round-level booking constraint consistent.

## Booking is the one contended write

`interviewModel.book()` uses a dedicated database client:

1. Begin a transaction.
2. Lock the slot with `SELECT ... FOR UPDATE`.
3. Check publication.
4. Count existing bookings while holding the lock.
5. Insert only when capacity remains.
6. Commit.

All statements must use the same connection. Separate `pool.query` calls do not provide that transaction boundary.

The round-level uniqueness constraint resolves races across different slots. Expected outcomes return `{ ok: false, reason }`:

| Reason | HTTP |
| --- | --- |
| `full` | `409` |
| `already_booked` | `409` |
| `not_published` or `not_found` | `404` |

`test/interviews.test.js` includes concurrent claims against a capacity-two slot and checks both responses and stored counts.

## Interviewer signup

Managers choose eligible committees and per-slot interviewer capacity.

### Who may sign up

Ordinary callers must belong to a designated committee. Eboard and the pledge chair qualify through `canManage`. Signup routes also require a member group, excluding rushees.

Committee membership requires approval; it is not immediate self-join access.

### Claiming a spot is contended, exactly like booking

Interviewer signup locks the slot on a dedicated connection before checking its count. Expected conflicts include `full` and `already_signed_up`, both `409`; unpublished slots return `404`.

The existing-signup check runs before capacity so a member already occupying the last place receives the correct explanation. The candidate booking path still checks capacity first; repeating a booking on a full slot can therefore report `full`.

### What an interviewer sees

`findForInterviewer` returns eligible published rounds, slots, candidate bookings, interviewer names, and `i_am_interviewing`. Managers can see published rounds without joining a designated committee.

Candidate-facing queries omit those name lists. `mine` refers to a candidate booking and must not be reused to mean interviewer signup.

### Withdrawing

`DELETE /interviews/slots/:id/interviewers/:userId` permits self-withdrawal or removal by a manager. Removal by someone else triggers the applicable notification.

## Drafts and publishing

Rounds begin as drafts. The UI requires at least one slot before publishing. Unpublished rounds do not accept new candidate or interviewer claims.

Unpublishing retains existing bookings. The false-to-true publication transition sends the rush notification; an ordinary save while already published does not.

## Entering slots

After adding a slot, the form prefills the next start from the previous end and retains duration, location, and capacity settings.

`chainedFrom` keys this prefill to the last added slot so a later refetch does not overwrite an in-progress edit.

## What each side sees

| Data | Candidate view | Management view |
| --- | --- | --- |
| Draft rounds | Hidden | Included |
| Seats taken | Count | Count |
| Candidate names | Omitted | Included |
| Interviewer names | Omitted | Included |
| Own booking | `mine` and `booking_id` | Booking list |

Candidate-facing SQL omits other candidates and interviewers rather than relying on UI hiding. Booking confirmation and calendar output must retain that restriction.

Full slots stay visible but disabled. A subscribed calendar may retain an older description until it refreshes.

### Every tile names its own room

Tiles, confirmation cards, and calendar rows resolve location as the slot override or round default. Include the resolved room in the tile's accessible label. The header explains when individual times use different rooms.

### `mine` is derived from the booking id

The candidate query derives `mine` from a non-null `my_booking_id`. Cancellation must use the booking ID. Never fall back to the slot ID; the two tables have independent ID sequences.

## Editing a booked slot

Managers can edit slots in place:

- Candidate capacity cannot fall below bookings.
- Interviewer capacity cannot fall below signups.
- Time changes notify the affected candidates and interviewers.
- Omitted fields stay unchanged; explicit null can clear a nullable slot field.

`updateSlot` builds updates from allowed fields so null does not always mean "keep." Check schedule-level nullable-field behavior separately before adding a form that needs clearing.

Deleting a booked slot or round returns `409` with `code: 'has_bookings'` and the count. A confirmed `?force=true` proceeds and notifies affected users. Capacity reduction has no force override.

## Cancelling a booking

`DELETE /interviews/bookings/:id` permits the owner or an interview manager. A notification is sent when someone else cancels it.

## Interview notes

Notes are attributed evaluations with separate authors. They are not the shared text projected at decision night.

### The note is anchored to the CANDIDATE and the ROUND, not the booking

Storage keys use `schedule_id` and `candidate_id`. A nullable `booking_id` records provenance with `ON DELETE SET NULL`.

This preserves notes when a candidate cancels and rebooks. A booking ID is an API address used to resolve the candidate/round, not the note's lifetime.

### `author_id` is `ON DELETE SET NULL`, with the name denormalised

Deleting an author's account retains their evaluations and stored `author_name`. Reads prefer a live name and fall back to the snapshot.

### Three permission tiers, not two

| Access | Caller | Result |
| --- | --- | --- |
| `all` | Eboard, pledge chair, or qualifying pledge-committee interviewer for the candidate | Candidate notes allowed by the query |
| `own` | An existing note author who no longer qualifies for wider access | Own note only |
| None | Other callers | Refused |

Ordinary wider access requires both pledge-committee membership and candidate-specific access. Being designated to conduct a round through another committee alone does not grant note access.

`GET` returns `{ access, notes }`. Render the access level so an own-only result is not presented as the candidate's complete evaluation set.

### Eboard deletes but never edits

Saving writes the caller's own note. Managers can remove another author's note but cannot rewrite it under that author's name.

### Two failures that must not answer alike

An inaccessible note returns `404`. A visible note that the caller cannot modify returns `403`. This avoids exposing sequential note IDs through an existence-only refusal.

### Notes are not on `BOOKINGS_JSON`

Do not add notes to the shared booking projection used by broad interviewer schedule reads. Notes use caller-specific queries; candidate and calendar responses must omit them entirely.

### Archiving keeps them

`archiveModel.snapshotRushHistory` captures notes with the round title and author name before deleting live candidates. These snapshots remain readable without live foreign-key targets.

### Audit records {#the-activity-log-captures-them-by-doing-nothing}

The global audit middleware records note mutations. Note `body` is not in `SAFE_SUMMARY_KEYS`, so content is excluded. Check that new note fields do not accidentally use an allowlisted summary key.

### Bullets, and where the structure lives

`body` remains text. `lib/interview-note-format.js` renders lines beginning with `-`, `*`, or `•` as bullets, with at most two levels. Unmarked lines render as paragraphs.

The editor continues bullets on Enter and indents applicable bullet lines on Tab. Off a bullet, Tab must move focus normally. Apply returned caret positions after the controlled value updates rather than against the old text.

### Decision night

**Rush Data → Presentation → Decision night** displays one candidate per slide. It uses `GET /rush-data/presentation` without a schedule ID.

The display uses curated `rushee_presentations`, not raw interview notes. It includes every current rushee through a roster-driven left join, even when no write-up or interview booking exists.

Slides show identity, photo, major, minors, graduation, GPA, and referral information. Render GPA as the API's nullable numeric string and graduation as stored semester text.

The view is read-only. Arrow keys or Space advance, and Escape closes. Edit write-ups in the Presentation tab before projecting them.

### The presentation write-up

| | Interview note | Presentation write-up |
| --- | --- | --- |
| Storage | Per author/candidate/round | One shared row per rushee |
| Editing | Own attributed note | Eboard or pledge chair |
| Length cap | 6000 | 3000 |
| Purpose | Restricted evaluation | Prepared chapter discussion |

`PresentationTab.jsx` shows written/blank status for the roster. Clearing uses DELETE rather than an empty saved body. Ordinary pledge-committee members can read the presentation; `can_edit_presentation` controls editing.

The same components must be reachable from the member-side rush-data page for eligible pledge-committee users and from the admin page for eboard.

## Calendars

`interviewModel.findForCalendar` returns the candidate's booked interviews, shaped for portal and ICS merging. Interviewer staffing alone does not add slots to that member's calendar.

Candidate descriptions remain "Interview" and omit interviewer names. The management query's `INTERVIEWER_NAMES` is a comma-joined display string; it is not part of the candidate calendar projection.

## Endpoints

The router starts with `RUSH_ACCESSIBLE_GROUPS` and narrows individual routes.

### Rush-facing

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/interviews/available` | Published slots and own booking state |
| `GET` | `/interviews/calendar` | Own booked interviews |
| `POST` | `/interviews/slots/:id/book` | Claim a candidate seat |
| `DELETE` | `/interviews/bookings/:id` | Cancel own booking or manage another |

Members can read the available sheet; write eligibility remains checked by the endpoint.

### Interviewer signup {#interviewer-signup--members-never-rushees}

Member-group route gate plus committee/manager checks:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/interviews/interviewer-schedules` | Eligible published rounds |
| `POST` | `/interviews/slots/:id/interviewers` | Claim a place; managers may supply `user_id` |
| `DELETE` | `/interviews/slots/:id/interviewers/:userId` | Withdraw or remove |

### Interview notes {#interview-notes--members-never-rushees}

Member-group gate plus note-specific authorization:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/interviews/bookings/:id/notes` | `{ access, notes }` |
| `PUT` | `/interviews/bookings/:id/notes` | Save own `{ body }` |
| `DELETE` | `/interviews/notes/:noteId` | Delete an authorized note |
| `GET` | `/interviews/schedules/:id/notes` | Manager's round-note view; not the projected deck |

Keep the narrower route checks even though the router already authenticates callers. The router also admits rushees.

### Management {#management--eboard--chair}

These routes use `requirePledgeManage`: eboard or pledge chair.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/interviews/schedules` | Rounds including drafts |
| `POST` | `/interviews/schedules` | Draft from `{ title, description?, location?, interviewer_committee_ids? }` |
| `GET` | `/interviews/schedules/:id` | Full schedule |
| `PATCH` | `/interviews/schedules/:id` | Metadata, publication, eligible committees |
| `DELETE` | `/interviews/schedules/:id` | Delete; confirm booked rounds with `force=true` |
| `POST` | `/interviews/schedules/:id/slots` | `{ starts_at, ends_at, location?, capacity?, interviewer_capacity? }` |
| `PATCH` | `/interviews/slots/:id` | Edit without reducing below existing claims |
| `DELETE` | `/interviews/slots/:id` | Delete; confirm booked slots with `force=true` |

An omitted `interviewer_committee_ids` leaves targeting unchanged; an empty array clears it. Non-arrays and invalid IDs return `400` rather than being treated as an empty selection.

## Limits

| Constant | Value |
| --- | --- |
| `MAX_CAPACITY` | 50 |
| `MAX_INTERVIEWERS` | 10 |
| `MAX_SLOTS_PER_SCHEDULE` | 500 |
| Title | 150 |
| Description | 2000 |
| `INTERVIEW_NOTE` | 6000 |
| `PRESENTATION_NOTE` | 3000 |

## Not built

The recorded UI does not include a manager picker for assigning interviewers even though the endpoint accepts a target user. Ratings, waitlists, automatic staffing, interview reminders, and recurring/bulk slot generation are also not part of this flow. Slot chaining reduces repeated entry without creating a bulk API.
