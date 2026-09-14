---
sidebar_position: 8
---

# Interviews

Interview managers create rounds of timed slots. Eligible active members can sign up to conduct interviews before publication. Publishing makes the times visible and bookable to rushees.

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

A round has a title, optional description/default location, publication state, `interviewer_groups`, and `interviewer_committee_ids`. Matching either a selected group or a selected committee grants interviewer access. Empty selections grant neither; managers have separate access.

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

Managers choose eligible groups, committees, or both, and per-slot interviewer capacity. Group choices are active members, chairs and executive board members. Alumni, pledges and rushees cannot list or claim interviewer slots, even if they belong to a selected committee.

### Who may sign up

Active members and chairs must match a selected group or committee. Executive board members and the pledge chair qualify through `canManage`. Selecting Active includes chairs and executive board members through the API's existing implied-active groups. Empty group and committee selections leave only manager access.

Committee membership requires approval; it is not immediate self-join access.

### Claiming a spot is contended, exactly like booking

Interviewer signup locks the slot on a dedicated connection before checking its count. Expected conflicts include `full` and `already_signed_up`, both `409`. Unpublished slots accept eligible interviewer signups. Candidate booking still requires publication.

The existing-signup check runs before capacity so a member already occupying the last place receives the correct explanation. The candidate booking path still checks capacity first; repeating a booking on a full slot can therefore report `full`.

### What an interviewer sees

`findForInterviewer` returns eligible published and unpublished rounds, slots, candidate bookings, interviewer names, and `i_am_interviewing`. Managers can see both states without joining a designated committee. Other callers match a selected group or committee.

Candidate-facing queries omit those name lists. `mine` refers to a candidate booking and must not be reused to mean interviewer signup.

### Withdrawing

`DELETE /interviews/slots/:id/interviewers/:userId` permits self-withdrawal or removal by a manager. Removal by someone else triggers the applicable notification.

### Slots that need covering

A slot is marked as needing coverage when a rushee has booked it and no interviewer has signed up: `booked_count > 0` and an empty `interviewers` array. `lib/interview-coverage.js` holds the single definition, and the three places that display it all read from that module rather than restating the condition.

The marker appears on the slot row in the executive board setup view, on the member sign-up card, and as a count above the round ("3 slots need covering"). The count is derived from the same predicate as the badges, so a summary can never disagree with the number of marked rows below it.

Deliberately narrow. A slot with fewer interviewers than its `interviewer_capacity` is staffed, not uncovered, and is not marked. The row already states "1 of 2 interviewers" in words, and flagging partial staffing would fire on most of a round and train people to ignore the badge. The case being marked is a candidate arriving to an empty room.

A slot whose `interviewers` key is absent entirely is treated as unknown and is NOT marked, where one carrying an empty array is. Both projections these pages read do select the key, so the absent case should not occur; it is handled explicitly because `(undefined ?? []).length === 0` is true, and a payload that lost the key would otherwise paint the warning across every booked slot in the round.

Past slots still count. An uncovered slot that has already happened is a rushee who met nobody, which is something to see afterwards rather than hide.

This requires no API change. `booked_count` and `interviewers` already ride on every slot projection both pages read, including the member-facing `getInterviewerSchedules`.

## Drafts and publishing

Rounds begin as drafts. The UI requires at least one slot before publishing. Unpublished rounds accept eligible interviewer claims, but remain hidden and unavailable for new rushee bookings. Unpublishing does not stop interviewer signup.

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
| `all` | Eboard, or any pledge committee member | Every note on the candidate |
| `own` | An existing note author who has since left the pledge committee | Own note only |
| None | Other callers | Refused |

Wider access is pledge committee membership and nothing else, for reads and for writes alike. This changed on 2026-09-14. It previously required both committee membership and candidate-specific access through the slot the candidate booked, so an ordinary member saw only the notes on people they personally interviewed. The committee votes on these candidates together, so it now reads the evaluations together.

Being designated to conduct a round through another committee still does not grant note access. `interview_schedules.interviewer_committee_ids` lets the executive board assign any committee to run a round, and without the membership requirement that committee would read every note about the candidates they met. Such a person can conduct an interview and cannot write it up; add them to the pledge committee rather than widening this further.

Withdrawing from a slot no longer narrows access. Leaving the pledge committee is now the only route to the `own` tier, and it exists because membership is revocable while authorship is not: someone who leaves keeps their own words and loses everyone else's.

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

The display uses curated `rushee_presentation_sections`, with legacy `rushee_presentations` as the initial summary fallback, rather than raw interview notes. It includes every current rushee through a roster-driven left join, even when no write-up or interview booking exists.

Slides show identity, photo, major, minors, graduation, GPA, and referral information. Render GPA as the API's nullable numeric string and graduation as stored semester text.

Presentation mode is read-only. Arrow keys or Space advance, and Escape closes. Active pledge committee members and executive board members can switch to Edit mode to change each section directly. Save or discard drafts before changing slides or modes.

### The presentation write-up

| | Interview note | Presentation write-up |
| --- | --- | --- |
| Storage | Per author/candidate/round | Four shared sections per rushee; legacy plain-text fallback |
| Editing | Own attributed note | Executive board or active pledge committee member |
| Length cap | 6000 | 30,000 HTML characters per section; 3000 for legacy plain text |
| Purpose | Restricted evaluation | Prepared chapter discussion |

`PresentationTab.jsx` lists the rushees with Edit slide and Present buttons. The API supplies `can_edit_presentation`. Each section has separate saving, formatting and version checks. A deliberately empty saved section remains blank; legacy plain-text clearing still uses DELETE.

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
| `GET` | `/interviews/interviewer-schedules` | Eligible published and unpublished rounds |
| `POST` | `/interviews/slots/:id/interviewers` | Claim a place; managers may supply `user_id` |
| `DELETE` | `/interviews/slots/:id/interviewers/:userId` | Withdraw or remove |

### Interview notes {#interview-notes--members-never-rushees}

Member-group gate plus note-specific authorization:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/interviews/bookings/:id/notes` | `{ access, notes }` |
| `PUT` | `/interviews/bookings/:id/notes` | Save own `{ body }` |
| `DELETE` | `/interviews/notes/:noteId` | Delete an authorized note |
| `GET` | `/interviews/schedules/:id/notes` | Round-note view, eboard or any pledge committee member; not the projected deck |

Keep the narrower route checks even though the router already authenticates callers. The router also admits rushees.

### Management {#management--eboard--chair}

These routes use `requirePledgeManage`: eboard or pledge chair.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/interviews/schedules` | Rounds including drafts |
| `POST` | `/interviews/schedules` | Draft from `{ title, description?, location?, interviewer_groups?, interviewer_committee_ids? }` |
| `GET` | `/interviews/schedules/:id` | Full schedule |
| `PATCH` | `/interviews/schedules/:id` | Metadata, publication, eligible groups/committees |
| `DELETE` | `/interviews/schedules/:id` | Delete; confirm booked rounds with `force=true` |
| `POST` | `/interviews/schedules/:id/slots` | `{ starts_at, ends_at, location?, capacity?, interviewer_capacity? }` |
| `PATCH` | `/interviews/slots/:id` | Edit without reducing below existing claims |
| `DELETE` | `/interviews/slots/:id` | Delete; confirm booked slots with `force=true` |

Omitting either targeting field preserves its current value. An empty array clears only that selection. `interviewer_groups` accepts `active`, `chair`, and `eboard`; other groups or non-arrays return `400`. Invalid committee IDs also return `400`. Existing rounds keep their committees and begin with no selected groups after migration `1791100000000_add-interviewer-groups.sql`. Apply the migration before the API rollout, then deploy the website.

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


For timed member voting from the presentation, see [Decision-night voting](./decision-night.md). Voting does not expose private interview notes.


Interviewer signup is available at `/member/interviews`; executive board members use the Sign Up tab at `/admin/interviews`. The member link does not require pledge committee membership. No alumni or pledge interviewer pages are provided.


Decision Night uses full candidate names and a smaller photo. Events attended and the protected resume popup sit in the profile column. Open editing from the portal; the projected presentation has no mode switch. The slide and timer follow the portal theme. See [Decision Night](decision-night.md) for visibility and voting controls.

Decision-night presentation now has separate Edit and Presentation modes with three independently saved formatted sections and a read-only attendance list. The interview section is a curated summary, not an automatic copy of private interview notes. See [slide editing and live flags](./decision-night.md#slide-layout-and-editing) for the current workflow and migration requirements.

### Interview slots by day

Member interviewer signup and the executive board Sign Up and Set Up tabs display interview days in separate columns: one on phones, two on medium screens, and three on wide screens. Additional days wrap to another row. Each day has a date heading, slot count, and its own scrollable list capped at 85% of the viewport height. The date stays visible while scrolling, and the list can be focused for keyboard scrolling.

Signup, withdrawal, bookings, notes, and schedule-management actions keep their existing permissions. Slot-edit fields fit the day column. This layout does not generate slots or copy schedules between dates.
### Interview navigation visibility

The member Interviews link appears only when an API-eligible round has an unended slot with interviewer capacity available, or the member already has an interviewer assignment. Existing assignments keep the link available for notes. Empty rounds, full unassigned slots, expired unassigned slots, and rounds outside the user's selected groups or committees do not expose the link. The check refreshes every 30 seconds while visible, on return to the tab, and when the session or preview identity changes. Executive board members retain their setup link to create and manage slots.
### Preview an unpublished interview round

Executive board members and the pledge chair can open a round in interview setup and select **Preview as rushee** beside **Publish to rushees**. A read-only panel shows that round using the actual candidate schedule layout: dates, times, descriptions, locations, and current seat availability. Drafts are marked **Preview: not published**.

The preview represents a rushee who has not booked yet. It does not impersonate an account, fetch the rushee's available-round list, display interviewer or candidate identities, or permit booking/cancellation. Opening or closing it does not change publication. Actual rushees still cannot access a draft. The existing manager-only schedule endpoint supplies the data; no new public draft endpoint exists.
### Parallel interviews by location

Member interviewer signup and executive board Sign Up/Set Up group each day's slots by location. Locations are listed alphabetically, and times are sorted within each location. A slot uses its own location, then the round's location if none is set; otherwise it appears under **Location not set**. Each location heading stays visible while scrolling through that section inside the existing day scroll area. Slot assignments and actions are unchanged. Rushee booking and draft preview use the compact timetable described below.
### Rushee interview timetable

Rushee booking and **Preview as rushee** use a compact timetable. Day buttons show one day at a time; location columns separate parallel interviews, and each row shows the start and end time. On phones a location selector shows one room at a time. Day controls stay outside the scrollable table, and room headings remain visible while scrolling.

Available cells show a filled **Book** button, full slots stay disabled, and an empty time/location combination reads **No slot**. Multiple seats show the remaining count. Separate records with the same time and room are kept as separate buttons, each booking its original slot. Locations use the slot value, then the round location, then **Location not set**. Existing booking confirmation, cancellation, and read-only preview protections remain unchanged. Interview management keeps its day columns and room sections. Member signup uses the timetable described below.
### Member interviewer timetable

Member signup and executive board **Sign Up** use the same day selector, location columns, and mobile location selector as rushee booking. Member cells retain staffing counts, interviewer names, candidate details, signup/withdraw controls, and existing interview-note access. Only the presentation is shared; role permissions and actions remain separate. Switching days keeps the member panels mounted so unsaved note drafts survive the switch. Closing a note editor or leaving the page retains its existing behavior. Executive board **Set Up** keeps its day columns and location sections.
### Correcting interview locations

In interview setup, **Change locations** lets executive board members and the pledge chair replace one existing room or update all slots in the selected round. The form shows the affected count and asks for confirmation. Slots already at the replacement location are skipped. Matching includes slots inheriting the round's default location. After successful slot updates, the default is also changed when applicable.

The operation uses the existing permission-checked slot update action and sends only the location field. Times, capacities, bookings, and interviewer assignments remain intact. Updates run sequentially, not as one database transaction. If an update fails, the operation stops, reports the number of confirmed changes, and reloads the schedule for review. Keep the page open while it runs. Room-only changes do not currently send notifications; contact affected people separately if needed.

Candidate and member timetables use alternating row shading. After a rushee books successfully and the data refreshes, the table is replaced by the existing booking confirmation card with the chosen time and location.