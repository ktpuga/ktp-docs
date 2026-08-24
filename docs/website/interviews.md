---
sidebar_position: 8
---

# Interviews

After speed dating, eboard runs final interviews. This is the sign-up sheet: **eboard posts timed slots, each rushee claims exactly one, and a claimed slot comes off the board for everyone else.**

It replaced meetings in the rush portal. Rushees see **Interviews** at `/rushee/interviews`; eboard and chairs manage rounds at `/admin/interviews`, under the **Rush** nav section.

There are **two kinds of claim** on a slot, and keeping them apart is the thing to understand before reading anything else here:

| Claim | Table | Who | Limit |
|---|---|---|---|
| **Attending** — a rushee being interviewed | `interview_bookings` | rushees | one per *round* |
| **Running** — a member conducting the interview | `interview_slot_interviewers` | members of designated committees | one per *slot* |

They contend for different counts on the same row (`capacity` and `interviewer_capacity`) and are notified with different wording. See [Interviewer signup](#interviewer-signup).

## Why not just use meetings?

Meetings were already open to rushees, so this looked like a UI change. It isn't — the two features have opposite shapes.

| | **Meetings** | **Interviews** |
|---|---|---|
| Direction | *Push* — an organizer names the people | *Pull* — eboard posts capacity, the rushee chooses |
| Who initiates | the organizer | the candidate |
| Contention | none — an invitee list can't be taken | **yes** — a slot can be claimed by someone else first |
| Answer to "no" | RSVP `not_going` | the slot is simply gone |

The decisive difference is **scarcity**. Booking has to be a contended, transactional claim against a capacity. Expressing that as a meeting would mean inventing "invitee rows not yet assigned to anyone" — which is `interview_slots` wearing a disguise.

There was also a governance reason. A rushee proposing an arbitrary time and summoning named leadership inverts who is running rush. Eboard decides when interviews happen; candidates pick from what's offered.

## Schema

Three tables in `migrations/1786600000000_add-interview-scheduling.sql`, plus a fourth added by `migrations/1787600000000_add-interview-interviewer-signup.sql`.

```
interview_schedules  ──<  interview_slots  ──<  interview_bookings
   (a round)               (a time)          │    (a rushee attending)
                                             └<  interview_slot_interviewers
                                                  (a member running it)
```

### `interview_schedules`

One round of interviews — "Fall 2026 Final Interviews". Carries a default `location` that individual slots may override, and the `published` flag.

`interviewer_committee_ids INTEGER[]` names the committees whose members may sign up to **run** interviews in this round. It **fails closed**: NULL or empty means nobody outside eboard, so a round created before this column existed stays shut rather than silently opening.

### `interview_slots`

One time, with **two independent counts**:

| Column | Counts | Default |
|---|---|---|
| `capacity` | rushee seats | 1 |
| `interviewer_capacity` | members who may run it | 1 |

`capacity` defaulting to 1 makes a slot behave exactly like a Calendly slot: taken means gone. Higher values exist for nights that run several rooms in parallel, so eboard can say "5:00 PM, three seats" rather than entering the same time three times and hoping nobody notices they're indistinguishable.

`interviewer_capacity` is a different question — how many people conduct *one* interview — which is why it isn't folded into `capacity`.

:::note `interviewer_id` is gone
Slots used to carry a single nullable `interviewer_id`, assigned by hand. Interviewers are now rows in `interview_slot_interviewers`, so a slot can have several and members can claim their own.

Migration `1787600000000` backfills every assigned interviewer into the new table but **deliberately leaves the column in place**, because dropping it in the same statement would make every interview query 500 until the new API deployed. It is read and written by nothing; a follow-up migration drops it. If you still see it in the schema, that's why.
:::

### `interview_slot_interviewers`

One member signed up to run one slot. `UNIQUE (slot_id, user_id)` and **nothing more** — the asymmetry with bookings is the point:

| | Bookings | Interviewer signups |
|---|---|---|
| Unique per slot | yes | yes |
| **Unique per round** | **yes** | **no** |

A rushee holding two times has taken a seat from someone else. An interviewer covering a whole evening is just Tuesday.

### `interview_bookings`

One claimed seat. Two unique constraints do the real work:

| Constraint | Prevents |
|---|---|
| `UNIQUE (slot_id, user_id)` | taking two seats in the same slot |
| `UNIQUE (schedule_id, user_id)` | **holding two different times in the same round** |

:::note Why `schedule_id` is denormalised onto bookings
Purely so "one interview per person per round" can be a `UNIQUE` constraint instead of application code. It cannot drift: a composite foreign key

```sql
FOREIGN KEY (slot_id, schedule_id) REFERENCES interview_slots (id, schedule_id)
```

makes it impossible for a booking's `schedule_id` to disagree with its slot's. (That's what the otherwise-redundant `UNIQUE (id, schedule_id)` on `interview_slots` is for — a composite FK needs a unique target.)

The denormalisation therefore costs nothing in correctness. The database won't let it lie.
:::

## Booking is the one contended write

Forty rushees are told "signups open at 8pm" and they all click at once. A read-then-insert passes every single-threaded test and then overbooks in production.

`interviewModel.book()` therefore runs a real transaction on a dedicated client:

1. `BEGIN`
2. `SELECT … FOR UPDATE` on the slot row — serialises every claim on *that* slot
3. check the schedule is published
4. count existing bookings **inside the lock**
5. refuse if `count >= capacity`, otherwise `INSERT`
6. `COMMIT`

:::warning Why a dedicated client and not the shared `query` helper
A transaction must run every statement on **one** connection. `pool.query` hands out an arbitrary connection per call, which would leave `BEGIN` and `COMMIT` on different sessions and silently drop the lock — the code would look transactional and provide no isolation at all.
:::

The `UNIQUE (schedule_id, user_id)` violation is **caught** rather than pre-checked, because a pre-check has the same race the capacity check does. Here the constraint already closes it, so a `23505` is translated to `already_booked`.

`book()` returns `{ ok: false, reason }` instead of throwing for the contention outcomes. Losing a race for the last seat is a normal thing that happens on interview night, not an exception.

| `reason` | HTTP | Shown as |
|---|---|---|
| `full` | 409 | "Someone just took the last spot in that slot." |
| `already_booked` | 409 | "You already have an interview booked." |
| `not_published` | **404** | "That slot no longer exists." |
| `not_found` | 404 | same |

`not_published` deliberately answers the same as a missing slot, so an unpublished round isn't discoverable by probing slot ids.

:::tip The test proves itself
`test/interviews.test.js` claims a **capacity-2 slot from four rushees concurrently** via `Promise.all` and asserts exactly two win — then re-checks the row count in the database, because a correct return value with a wrong row count is still an overbooked slot.

Verified by removing `FOR UPDATE`: the slot admitted **3**. A sequential version of that test passes against the broken code, which is why it isn't written that way.
:::

## Interviewer signup

Eboard decides **which committees** may staff a round and **how many interviewers** each slot takes. Members of those committees then claim slots themselves.

### Who may sign up

Membership of a committee listed in the round's `interviewer_committee_ids`. Eboard and chairs bypass the check — they run interviews by definition.

The route also carries its own `SHARED_ALBUM_GROUPS` gate, **narrower than the router's `RUSH_ACCESSIBLE_GROUPS`**, because rushees must never reach it: they would be able to sign up to interview, and these routes expose the candidate list that the rush-facing query deliberately hides.

:::warning Committee membership is a soft boundary
**This changed on 2026-08-11.** `POST /committees/:id/join` used to be self-service for any member, with no eboard route to remove anyone — so "the pledge committee can see this" really meant *any member who joins that committee can see it*, and that included seeing rushee names. Joining now creates a **request** that eboard or the committee chair approves, and removal exists. See [Committees](./overview.md#committees).

That matters because the interviewer view **does** include rushee names (see below). It is a deliberate choice, not an oversight, but the audience it creates is wider than the committee roster suggests.
:::

### Claiming a spot is contended, exactly like booking

Two people on the same committee open the page together and click the same slot. `signUpAsInterviewer` therefore uses the identical shape as `book()` — dedicated client, `SELECT … FOR UPDATE` on the slot, count taken **inside** the lock — and returns `{ ok: false, reason }` rather than throwing.

| `reason` | HTTP | Shown as |
|---|---|---|
| `full` | 409 | "Someone just took the last interviewer spot for that time." |
| `already_signed_up` | 409 | "You're already signed up to interview that slot." |
| `not_published` | **404** | "That slot no longer exists." |

:::danger Ask "am I already in this?" before checking capacity
On the common `interviewer_capacity` of 1, the person occupying the only spot **is** the reason it's full. Checking capacity first tells them *"someone just took the last interviewer spot"* — the one message they cannot act on, about a spot they hold.

`signUpAsInterviewer` checks for an existing signup first, inside the lock, and answers `already_signed_up`. The `UNIQUE` violation is still caught as the real enforcement; the pre-check exists purely so the message is true.

**`book()` still has this flaw** for rushees on a capacity-1 slot (the default). Known, one line, not yet fixed.
:::

### What an interviewer sees

`findForInterviewer` returns published rounds their committee is designated on, every slot, who else signed up, and `i_am_interviewing` per slot.

It **includes `bookings` — the rushee names** — which `findAvailableForUser` deliberately omits. The reasoning is that someone about to conduct an interview needs to know who they are meeting. Weigh it against the self-service-join note above.

:::note `i_am_interviewing`, not `mine`
`mine` already means "I booked this slot as a rushee". One key meaning two things across two audiences is how a disclosure bug gets written, so the interviewer flag has its own name.
:::

### Withdrawing

`DELETE /interviews/slots/:id/interviewers/:userId` — yours, or anyone's if you manage interviews. A push goes out only when *someone else* removed you.

## Drafts and publishing

Slots are added **one at a time**, so a schedule is half-built for as long as it takes to enter forty of them. Without `published`, rushees would be grabbing slots out of a list still being typed, and the first arrivals would take everything on day one because day two doesn't exist yet.

Nothing rush-facing reads an unpublished schedule. The **Publish** button is disabled until the round has at least one slot.

:::note Unpublishing does not cancel anyone
Pulling a round back to fix a typo is routine and must not be capable of quietly cancelling interviews. Someone booked at 5:20 keeps their slot; the sheet just stops accepting new claims.
:::

Flipping `published` from false to true sends **one** push notification to every current rushee. Only on that edge — re-saving a published round to fix a typo doesn't re-notify the whole rush class.

## Entering slots

Each slot is created explicitly, which is a lot of typing for an interview night. The mitigation is chaining: **after each save the next slot starts exactly where the previous one ended** and inherits its length, room, seats and interviewer count. A three-hour evening of 20-minute slots is one field of typing and then nine clicks on **Add slot**.

That chaining is also how a round gets a *de facto* default interviewer count without a per-round setting: set it once on the first slot and it carries.

The prefill is keyed on the last slot's id (`chainedFrom`) so it runs once per added slot — otherwise typing a start time would be overwritten the moment the parent refetched.

## What each side sees

This is the part worth getting right, and it's enforced by using **two different queries** rather than one query and a filter.

| | `findAvailableForUser` (rush) | `findScheduleForManagement` (eboard) |
|---|---|---|
| Unpublished rounds | hidden | shown |
| Seats taken | count only | count |
| **Who booked** | **never selected** | full names + emails |
| **Who is interviewing** | **never selected** | full list + counts |
| Your own booking | flagged `mine` + `booking_id` | — |

The rush-facing query selects **neither** name set, each for its own reason:

- **Other candidates.** A rushee has no business knowing who else is interviewing at 5:20.
- **The interviewers.** Told before booking, it lets candidates shop for a friendly interviewer; the chapter decides who takes which slot, not the candidate.

Both are left out of the SQL rather than stripped later, which is a stronger guarantee than remembering to filter in a controller — the same reasoning as the [content visibility](./photos-and-documents.md) SQL/JS split.

:::note One omission covers two screens
`my_booking` is derived from these same rows, so not selecting interviewer names also blanks the post-booking confirmation card. Hiding it in the tile component alone would have left it on the card, one query away.

The candidate's calendar is covered separately — `findForCalendar` doesn't select it either, and its `description` is a bare `"Interview"`. That one matters most: an ICS `DESCRIPTION` is cached on a phone for **weeks**, so it's the leak that is hardest to take back. `calendarFeed.test.js` asserts it at the wire, scoped to the interview's own `VEVENT`.
:::

:::warning Already-synced calendar entries keep the old text
Changing the feed can't reach an entry a phone already downloaded. Anyone who booked before this shipped may still see "Interview with …" until their calendar app re-fetches.
:::

:::note Full slots stay on the board, greyed out
A sheet that silently omits taken rows makes it look like there were never that many times on offer. A paper sign-up sheet shows the crossed-out rows too.
:::

### Every tile names its own room

A slot may override the round's `location`, and that override used to be invisible until **after** booking — the round room showed in the board header, and the slot room appeared only on the confirmation card. So a rushee could take 5:20 without knowing it was in a different building from the 5:00 above it.

Each tile now shows `slot.location ?? schedule.location`, the same resolution the confirmation card and the ICS feed's `COALESCE(s.location, sc.location)` use, and the room is part of the tile's `aria-label` so it's heard before committing rather than after.

When some slots override the round room, the header adds *"— unless a time below says otherwise"*. Without that, a header saying "Boyd 204" above a tile saying "MLC 248" reads as a contradiction instead of a default.

Room names are `truncate`d with a `title` fallback: these tiles sit in a four-column grid, and one long name would otherwise stretch the track and break the row.

### `mine` is derived from the booking id

The rush query selects `my_booking_id` and derives `mine` from it being non-null, rather than selecting an `EXISTS` flag separately. The two can then never disagree — a slot flagged as yours with no id to cancel is a dead "Change my time" button.

:::danger Never fall back from `booking_id` to `slot_id`
They are ids from different tables that both start at 1. A `booking_id ?? slot.id` fallback wouldn't fail safe — it would cancel whichever booking happened to have that id, which is **somebody else's interview**. `InterviewSignup` throws instead.
:::

## Editing a booked slot

Allowed — a room change is a normal correction — and eboard does it **in place**: the pencil on a slot row expands into the same fields as the add form. Before August 2026 `PATCH /interviews/slots/:id` existed with no caller, and editing meant delete-and-re-add.

Three guards:

- **Neither count can drop below what's already claimed.** `capacity` can't go below seats taken, `interviewer_capacity` can't go below signups. Both are checked in the controller rather than by a `CHECK` constraint, because the useful error ("3 people have already booked this") needs a count a constraint can't see across tables to produce. Neither has a `?force` override — unlike deleting, this is a hard stop, so the UI shows it as an explanation beside the field rather than an escalation dialog.
- **Moving a slot's time notifies both audiences**, in their own words: rushees get "your interview time changed", members get "an interview you're running moved". Changing either count affects nobody and stays silent.
- **An absent field is left alone; an explicitly empty one is cleared.**

:::warning `COALESCE($n, column)` cannot express "clear this"
`updateSlot` used to be write-only for its nullable columns: `COALESCE` reads NULL as "keep", so a room could be set and never unset. Choosing *Not decided* or emptying the Room box returned **200 and changed nothing** — a request that looks like it worked.

It now builds its `SET` clause from a fixed column allowlist, so `undefined` means "leave alone" and an explicit `null` means "clear". `updateSchedule` still uses the old pattern for `description`/`location`; nothing edits those yet, but fix it before building a form that does.
:::

Deleting a booked slot, or a round containing bookings, returns **409 with `code: 'has_bookings'`** and the count. The UI re-asks with that number in the question — "delete this schedule" and "cancel 23 people's interviews" deserve different answers, and only the server knows which one it is. Passing `?force=true` proceeds and notifies everyone it unbooked.

## Cancelling a booking

`DELETE /interviews/bookings/:id` — **yours, or anyone's if you run interviews.** Both are legitimate: a rushee changing their mind, and eboard clearing a no-show so the time reopens.

A push goes out only when *someone else* cancelled it for you. You don't need a notification about the button you just pressed.

## Interview notes

What an interviewer thought of a candidate. **Readable and writable only by eboard and by the members signed up to run the slot that candidate is booked into** — never by the candidate, under any request shape.

One note per interviewer per candidate per round: `UNIQUE (schedule_id, candidate_id, author_id)`. The alternative, one shared note per candidate, is a lost update with no detection — two interviewers on a `interviewer_capacity: 2` slot open the same box and the second save silently discards the first. Booking is the only contended write in this codebase and it needed a real `FOR UPDATE` transaction to get right; a second one, for a textarea, is a bad trade.

### The note is anchored to the CANDIDATE and the ROUND, not the booking

This is the design decision the whole feature turns on, and the obvious column is the wrong one.

`interview_bookings.id` looks right: a slot holds several bookings, so the booking is the row meaning "this person at this time". It is also **a row the candidate can delete.** `cancelBooking` allows `isOwn` with no further check, and `book()` refuses a second booking — so **rescheduling requires cancelling first.**

:::danger A booking-anchored note is destroyed by rescheduling
A candidate moving from Tuesday to Wednesday would silently erase every evaluation written about them, after the evaluations exist, by the one person they are being kept from.

Refusing the cancel is not the way out: declining to let someone reschedule *because a note exists* tells them a note exists.
:::

So notes key on `(schedule_id, candidate_id)` — the same unit `interview_bookings` already declares a candidate to be with its own `UNIQUE (schedule_id, user_id)`. `booking_id` is kept as **nullable provenance**, `ON DELETE SET NULL`, recording which sitting a note came from without ever being how the row is found. Eboard's `?force=true` slot delete stops eating them for free.

### `author_id` is `ON DELETE SET NULL`, with the name denormalised

Deleting a user in Authentik **hard-deletes** the row here — `webhooksController` runs a real `DELETE FROM users` on a `model_deleted` event, which is not the soft `deleted_at` path. Under `ON DELETE CASCADE`, removing one graduating senior from the IdP would erase every note they ever wrote, across every candidate.

`author_name` is written alongside and reads render `COALESCE(<live join on users>, author_name)`, so an ordinary rename still shows through and only a deleted account falls back to the stored copy. Postgres treats NULLs as distinct in a `UNIQUE`, so orphaned notes never collide.

### Three permission tiers, not two

| Tier | Who | Sees |
|---|---|---|
| `all` | eboard/chair, or currently signed up on the candidate's slot | every note on that candidate |
| `own` | wrote a note here and has since **withdrawn** from the slot | only their own, and can still edit or retract it |
| — | anyone else | `403` |

Slot membership is a **current** claim and authorship is a **standing** one. Collapsing them into one live check means an interviewer who drops a night they can no longer cover loses the ability to read or correct what they themselves wrote, while eboard carries on reading it.

:::warning `GET` returns `{ access, notes }`, and the client must render the difference
A caller in the `own` tier gets a `200` carrying **one** note when three exist. A UI handed only the array shows "1 note" and is confidently wrong at a decision meeting.

`access` comes from the API rather than being derived from `slot.i_am_interviewing` in the component, because a client-side copy of a server rule is free to drift the day the rule changes.
:::

### Eboard deletes but never edits

A note is a named person's judgement, so rewriting it would make the attribution false — the opposite of a profile, which eboard *can* edit because it is a record of fact. Delete is the escape hatch, so something inappropriate can be removed without opening a SQL client. There is deliberately no edit control on another person's note anywhere in the UI, and no route that could reach one: saving always writes the **caller's** row.

### Two failures that must not answer alike

| Situation | Answer |
|---|---|
| A note the caller cannot see | `404` |
| One they can see but didn't write | `403` |

Note ids are sequential `SERIAL`s, so a single `403` for an unreadable note turns `DELETE /interviews/notes/:id` into an existence oracle: walk the ids, count the refusals, learn how many evaluations have been written. Same rule and same reasoning as the [document library](./photos-and-documents.md).

### Notes are not on `BOOKINGS_JSON`

That shared SQL fragment is used by `findScheduleForManagement` **and** `findForInterviewer`, and `findForInterviewer` selects `WHERE s.schedule_id = ANY(...)` — every slot of every round a member may staff, not only the ones they claimed. A `notes` key on it would hand every committee member every note in the round. Notes are their own caller-keyed query.

`findAvailableForUser` and `findForCalendar` do not use `BOOKINGS_JSON` at all, so the rushee-facing and ICS paths are structurally clear. A test asserts that neither carries a note, nor even an empty `notes` key, under any request shape.

### Archiving keeps them

`archiveModel.snapshotRushHistory` writes notes into `rush_history` as a third parallel query alongside events and interviews, for the same reason those two are there: `candidate_id` cascades from `users`, so the rows are unrecoverable the moment the live user row goes. Denormalised the same way — the round's **title** and the author's **name**, not their ids — because the point is to still be readable in a year.

### The activity log captures them, by doing nothing

The global middleware already logs every mutating request. The DM argument for skipping runs backwards here: DMs are skipped because eboard is not allowed to see them, and here eboard **is** the audience.

`SAFE_SUMMARY_KEYS` is an allowlist and the field is named `body`, which is not on it — so the log records *that* a note was written, by whom and when, and can never record what it said. `title`, `name` and `status` **are** on that list; if a rating is ever added to notes, do not name it any of those.

### Bullets, and where the structure lives

Notes are bulleted, and the bullets are **not in the database**. `body` is still one `TEXT` column; `lib/interview-note-format.js` parses lines beginning `-`, `*` or `•` at render time and the editor helps you type them (Enter continues the list, Tab indents one level). Depth is capped at **two levels**, because a third is unreadable projected on a wall.

This was chosen over storing an array of bullet objects. A structured column would have meant a migration, a changed response shape that iOS reads later, and rewriting every note test that keys on `body` being a string — to buy formatting that a parser gives for free. Every note written before the format existed still renders: a line with no marker is a paragraph.

`*` and `•` are accepted on input because these notes are pasted out of Google Docs and Slides, which is the workflow the feature replaced.

:::warning Tab is only intercepted on a bullet line
Swallowing Tab everywhere inside a textarea traps keyboard users in the control with no way out. Off a bullet, Tab moves focus like it does anywhere else. `bulletKeyDown` returns `null` to say "not mine", and the component only calls `preventDefault()` when it returns a value.
:::

The caret position is returned by that same pure function and applied in an effect, never in the key handler. The textarea is controlled, so at the moment the key is handled React has not painted the new value and setting `selectionStart` there positions the caret in the **old** string — which is every "the cursor jumps to the end when I press Enter" bug in a controlled editor.

### Decision night

**Admin → Rushees → Presentation → Decision night**, or the same tab at `/member/rush-data` for the pledge committee. One candidate per screen, projected: photo and identity on the left, the write-up on the right, arrow keys or space to advance, Esc to close. It replaces a Google Slides deck that was rebuilt by hand every round.

:::danger It no longer projects interview notes, and must not again
Projecting the raw notes contradicts "notes are the pledge committee only" the moment a projector is switched on: a note is one named person's private judgement, written for a committee, and putting it on a wall publishes it to the whole chapter.

It now renders `rushee_presentations` — **one shared write-up per rushee**, curated before the meeting by eboard and the pledge chair, which is a thing written to be read aloud. Do not point `DecisionNight.jsx` back at `getRoundNotes`.
:::

It reads `GET /rush-data/presentation` and takes **no `scheduleId`**. The button used to live on `/admin/interviews` inside the round-notes card, and moved for two reasons: the deck is no longer built from one round's notes, and `/admin/interviews` is eboard-only while the deck is readable by the whole pledge committee. It belongs beside the text it projects.

The slide carries `major`, `minors`, `graduation_date`, `gpa` and `heard_from`. Minors and "how they heard" were added when it moved — both were already on the interest form and both come up in the room, so whoever was presenting had been reading them off a second screen.

`gpa` came from the [rushee interest form](./rush-portal.md#the-interest-form). Decision night is where the chapter votes, so the number belongs on the slide; the panel an interviewer opens mid-interview does not need it and does not get it.

It renders as the string the API sent. `users.gpa` is `NUMERIC` and node-postgres reads `NUMERIC` back as text, so `"3.75"` arrives already formatted; a `toFixed` in the component would put `NaN` on a projector the first time a candidate left it blank.

`graduation_date` is free text a member typed (`"Spring 2028"`), not a date. It is rendered as stored; nothing parses it.

:::info Every rushee gets a slide, written up or not
The deck is driven by the **rushee roster** — `findDeck` starts `FROM users` and `LEFT JOIN`s the write-up. The old query started `FROM interview_notes`, so a candidate nobody wrote about had no slide and **could not be discussed at the meeting at all**. An unwritten rushee now shows an explicit "Nobody has written this one up yet" slide rather than an absence nobody notices. A rushee who never booked an interview still gets one too.
:::

The view is **read-only**, and deliberately so: a room full of people watching a write-up get rewritten is the worst possible moment for it to change under them. It is edited from the Presentation tab, before the meeting.

### The presentation write-up

`rushee_presentations`, one row per rushee, edited in `components/rush/PresentationTab.jsx`. **Not interview notes**, and the distinction is the reason it is a separate table and a separate component:

| | **Interview notes** | **The write-up** |
|---|---|---|
| How many | several per candidate | **one**, shared |
| Attributed | yes, per author | no — last save wins |
| Who may write | the interviewer who ran the slot | eboard + the pledge **chair** |
| Who sees it | eboard, pledge chair, that slot's interviewers | **the whole chapter, on a projector** |
| Cap | `INTERVIEW_NOTE` (6000) | `PRESENTATION_NOTE` (**3000**) |

Half the length, because this one is read off a wall and a slide that scrolls has already failed.

The tab lists every rushee as an accordion with a written/blank marker, and counts the blanks at the top so the chair can see how many are still unwritten before the meeting starts. Clearing has its own verb (`DELETE`) rather than saving `""`, because `body` is `NOT NULL` and an empty row is indistinguishable from a slide somebody is still drafting.

:::warning The pledge chair is not eboard
`proxy.ts` refuses them all of `/admin`, so the tab exists in **both** portals — `/admin/rushees` for eboard and `/member/rush-data` for the pledge committee, one shared component either way. An admin-only Presentation tab would have granted a write permission with nowhere to spend it.

The editor renders only when `can_edit_presentation` is true; an ordinary pledge committee member gets the same tab read-only, plus the Decision night button.
:::

## Calendars

A booked interview lands on the rushee's portal calendar and their [calendar subscription](./calendar-subscription.md). `interviewModel.findForCalendar` shapes rows like events (`title`, `description`, `location`, `startDate`, `endDate`) so both merges work without a second formatter.

**Only the booker's.** There is no equivalent of the meetings "organiser sees it too" case — the person running interviews wants the sign-up sheet, not forty separate calendar entries. `calendarFeed.test.js` asserts an interviewer does *not* get the slots they're running.

The `description` is a bare `"Interview"`. It used to read "Interview with Ben", but **the candidate is not told who is conducting their interview**, so `findForCalendar` no longer selects a name at all — see the visibility table above.

`INTERVIEWER_NAMES` still exists for the eboard sheet, where it builds a **single comma-joined string** under the `interviewer_name` key rather than an array, because `findScheduleForManagement` consumers expect that shape. It uses `CONCAT_WS` rather than the `first_name || ' ' || last_name` idiom used elsewhere in the codebase:

:::warning `||` with a NULL operand yields NULL
A member with a first name but no last name falls all the way through to `username` — or to nothing. `CONCAT_WS` skips NULL arguments instead, so "Ben" stays "Ben".

It matters more here than in `meetingModel`: this name is baked into the `DESCRIPTION` of a calendar entry a phone caches for weeks, so the degraded version isn't a slightly-off label on a page you can refresh. This was caught by a test asserting the description, not by review.
:::

## Endpoints

All under `/interviews`, gated on `RUSH_ACCESSIBLE_GROUPS` at the router, then narrowed per route.

### Rush-facing

| Method | Path | Notes |
|---|---|---|
| `GET` | `/interviews/available` | Published rounds, slots, seats left, which one is yours |
| `GET` | `/interviews/calendar` | Your booked interviews, event-shaped |
| `POST` | `/interviews/slots/:id/book` | Claim a seat. 409 on `full` / `already_booked` |
| `DELETE` | `/interviews/bookings/:id` | Yours, or anyone's if you manage interviews |

Members can read these too — leadership needs to see the sheet the way a rushee sees it without signing in as one.

### Interviewer signup — members, **never rushees**

Gated `SHARED_ALBUM_GROUPS` at the route, then by committee designation in the controller.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/interviews/interviewer-schedules` | Rounds your committee may staff, with rushee names. `[]` if none |
| `POST` | `/interviews/slots/:id/interviewers` | Claim a spot. Eboard may pass `{ user_id }` to assign someone |
| `DELETE` | `/interviews/slots/:id/interviewers/:userId` | Withdraw. Yours, or anyone's if you manage interviews |

### Interview notes — members, **never rushees**

Same `SHARED_ALBUM_GROUPS` route gate, then decided per row in the controller. Addressed by **booking** id, which is what every rushee chip already carries; stored by candidate and round.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/interviews/bookings/:id/notes` | `{ access, notes }`. `access` is `all` or `own` |
| `PUT` | `/interviews/bookings/:id/notes` | Upsert **your own** note. `{ body }`. `PUT`, so saving twice edits |
| `DELETE` | `/interviews/notes/:noteId` | Yours, or anyone's if you manage interviews. `404` if you cannot see it |
| `GET` | `/interviews/schedules/:id/notes` | Decision-night view: the whole round, grouped by candidate. **`eboard` + `chair` only** |

:::warning The route gate is not redundant
The router opens with `requireGroup(...RUSH_ACCESSIBLE_GROUPS)`, so **a rushee reaches every handler in the file** — including the ones serving the notes written about them. Each notes route carries its own `requireGroup(...SHARED_ALBUM_GROUPS)`, and that layer must never be removed for looking duplicative.
:::

### Management — `eboard` + `chair`

| Method | Path | Notes |
|---|---|---|
| `GET` | `/interviews/schedules` | All rounds, draft included, with counts |
| `POST` | `/interviews/schedules` | `{ title, description?, location?, interviewer_committee_ids? }` — created as a draft |
| `GET` | `/interviews/schedules/:id` | Full sign-up sheet with names |
| `PATCH` | `/interviews/schedules/:id` | Also the publish switch and the committee list |
| `DELETE` | `/interviews/schedules/:id` | 409 if booked; `?force=true` overrides |
| `POST` | `/interviews/schedules/:id/slots` | `{ starts_at, ends_at, location?, capacity?, interviewer_capacity? }` |
| `PATCH` | `/interviews/slots/:id` | Neither count may drop below what's claimed. No `?force` |
| `DELETE` | `/interviews/slots/:id` | 409 if booked; `?force=true` overrides |

:::note An empty `interviewer_committee_ids` is a real value
`PATCH` treats an absent key as "leave alone" and an empty array as "close this round to everyone outside eboard". `COALESCE` can't tell those apart, so `updateSchedule` uses an explicit was-it-sent flag for this column.

Because the empty array is a real setting, malformed input must never be able to reach it by accident. It used to: any non-array fell into the same branch, so sending `"3"` instead of `[3]` locked every committee out of the round and looked like a deliberate closure. Both that and a list containing a bad id are now a `400`.
:::

`eboard` + `chair` matches [rush announcements](./rush-portal.md): it covers the rush chair however they happen to be modelled — an eboard member with an `exec_title`, or a committee chair — without the route needing to know which.

:::note `requireGroup` is repeated per route
Rather than a `router.use()` above the management block. A router-level guard would apply to everything below it *in file order*, which is a trap for whoever adds the next rush-facing route at the bottom of the file.
:::

## Limits

| Constant | Value | Why |
|---|---|---|
| `MAX_CAPACITY` | 50 | A slot holding more isn't a slot, it's an event with a start time |
| `MAX_INTERVIEWERS` | 10 | More than this on one slot is a panel, not an interview |
| `MAX_SLOTS_PER_SCHEDULE` | 500 | Guards a runaway script, not eboard's typing speed |
| `MAX_TITLE` | 150 | |
| `MAX_DESCRIPTION` | 2000 | |
| `TEXT_LIMITS.INTERVIEW_NOTE` | 3000 | One note. The constraint is a reading one: eboard opens a candidate and reads every note on them at once |

## Not built

- **Adding an interviewer from the eboard slot form.** Eboard sets the maximum and can *remove* a signup, but the form no longer has a person picker. `POST …/interviewers` accepts `{ user_id }`, so it's a button away.
- **Ratings on interview notes.** Free text only. A rating column is additive later and Swift's `JSONDecoder` ignores unknown keys, so nothing is foreclosed — but see the naming warning above.
- **Waitlists.** If a slot or an interviewer spot frees up, whoever refreshes first gets it.
- **Automatic interviewer assignment.** Members self-select; nothing balances coverage or warns about an unstaffed slot.
- **Reminders before the interview.** Only the calendar entry.
- **Recurring or bulk slot generation.** Deliberate — slot entry is explicit, with the chaining prefill as the ergonomic answer.
