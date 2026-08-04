---
sidebar_position: 8
---

# Interviews

After speed dating, eboard runs final interviews. This is the sign-up sheet: **eboard posts timed slots, each rushee claims exactly one, and a claimed slot comes off the board for everyone else.**

It replaced meetings in the rush portal. Rushees see **Interviews** at `/rushee/interviews`; eboard and chairs manage rounds at `/admin/interviews`, under the **Rush** nav section.

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

Three tables, in `migrations/1786600000000_add-interview-scheduling.sql`.

```
interview_schedules  ──<  interview_slots  ──<  interview_bookings
   (a round)               (a time)               (a claimed seat)
```

### `interview_schedules`

One round of interviews — "Fall 2026 Final Interviews". Carries a default `location` that individual slots may override, and the `published` flag.

### `interview_slots`

One time. `capacity` defaults to **1**, which makes it behave exactly like a Calendly slot: taken means gone. Higher values exist for nights that run several rooms in parallel, so eboard can say "5:00 PM, three seats" rather than entering the same time three times and hoping nobody notices they're indistinguishable.

`interviewer_id` is optional and nullable — most chapters decide who runs which slot after signups close.

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

## Drafts and publishing

Slots are added **one at a time**, so a schedule is half-built for as long as it takes to enter forty of them. Without `published`, rushees would be grabbing slots out of a list still being typed, and the first arrivals would take everything on day one because day two doesn't exist yet.

Nothing rush-facing reads an unpublished schedule. The **Publish** button is disabled until the round has at least one slot.

:::note Unpublishing does not cancel anyone
Pulling a round back to fix a typo is routine and must not be capable of quietly cancelling interviews. Someone booked at 5:20 keeps their slot; the sheet just stops accepting new claims.
:::

Flipping `published` from false to true sends **one** push notification to every current rushee. Only on that edge — re-saving a published round to fix a typo doesn't re-notify the whole rush class.

## Entering slots

Each slot is created explicitly, which is a lot of typing for an interview night. The mitigation is chaining: **after each save the next slot starts exactly where the previous one ended** and inherits its length, room, capacity and interviewer. A three-hour evening of 20-minute slots is one field of typing and then nine clicks on **Add slot**.

The prefill is keyed on the last slot's id (`chainedFrom`) so it runs once per added slot — otherwise typing a start time would be overwritten the moment the parent refetched.

## What each side sees

This is the part worth getting right, and it's enforced by using **two different queries** rather than one query and a filter.

| | `findAvailableForUser` (rush) | `findScheduleForManagement` (eboard) |
|---|---|---|
| Unpublished rounds | hidden | shown |
| Seats taken | count only | count |
| **Who booked** | **never selected** | full names + emails |
| Your own booking | flagged `mine` + `booking_id` | — |

The rush-facing query never selects other candidates' names. A rushee has no business knowing who else is interviewing at 5:20, and leaving the names out of the SQL is a stronger guarantee than remembering to strip them in the controller — the same reasoning as the [content visibility](./photos-and-documents.md) SQL/JS split.

:::note Full slots stay on the board, greyed out
A sheet that silently omits taken rows makes it look like there were never that many times on offer. A paper sign-up sheet shows the crossed-out rows too.
:::

### `mine` is derived from the booking id

The rush query selects `my_booking_id` and derives `mine` from it being non-null, rather than selecting an `EXISTS` flag separately. The two can then never disagree — a slot flagged as yours with no id to cancel is a dead "Change my time" button.

:::danger Never fall back from `booking_id` to `slot_id`
They are ids from different tables that both start at 1. A `booking_id ?? slot.id` fallback wouldn't fail safe — it would cancel whichever booking happened to have that id, which is **somebody else's interview**. `InterviewSignup` throws instead.
:::

## Editing a booked slot

Allowed — a room change is a normal correction — with two guards:

- **Capacity can never drop below the seats already taken.** Checked in the controller rather than by a `CHECK` constraint, because the useful error ("3 people have already booked this") needs a count a constraint can't see across tables to produce.
- **Moving a booked slot's time notifies everyone in it.** A capacity or interviewer change doesn't affect them and stays silent.

Deleting a booked slot, or a round containing bookings, returns **409 with `code: 'has_bookings'`** and the count. The UI re-asks with that number in the question — "delete this schedule" and "cancel 23 people's interviews" deserve different answers, and only the server knows which one it is. Passing `?force=true` proceeds and notifies everyone it unbooked.

## Cancelling a booking

`DELETE /interviews/bookings/:id` — **yours, or anyone's if you run interviews.** Both are legitimate: a rushee changing their mind, and eboard clearing a no-show so the time reopens.

A push goes out only when *someone else* cancelled it for you. You don't need a notification about the button you just pressed.

## Calendars

A booked interview lands on the rushee's portal calendar and their [calendar subscription](./calendar-subscription.md). `interviewModel.findForCalendar` shapes rows like events (`title`, `description`, `location`, `startDate`, `endDate`) so both merges work without a second formatter.

**Only the booker's.** There is no equivalent of the meetings "organiser sees it too" case — the person running interviews wants the sign-up sheet, not forty separate calendar entries. `calendarFeed.test.js` asserts an interviewer does *not* get the slots they're running.

The interviewer's name rides along in the description ("Interview with Ben"), which is why `INTERVIEWER_NAME` uses `CONCAT_WS` rather than the `first_name || ' ' || last_name` idiom used elsewhere in the codebase:

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

### Management — `eboard` + `chair`

| Method | Path | Notes |
|---|---|---|
| `GET` | `/interviews/schedules` | All rounds, draft included, with counts |
| `POST` | `/interviews/schedules` | `{ title, description?, location? }` — created as a draft |
| `GET` | `/interviews/schedules/:id` | Full sign-up sheet with names |
| `PATCH` | `/interviews/schedules/:id` | Also the publish switch |
| `DELETE` | `/interviews/schedules/:id` | 409 if booked; `?force=true` overrides |
| `POST` | `/interviews/schedules/:id/slots` | `{ starts_at, ends_at, location?, capacity?, interviewer_id? }` |
| `PATCH` | `/interviews/slots/:id` | Capacity can't go below seats taken |
| `DELETE` | `/interviews/slots/:id` | 409 if booked; `?force=true` overrides |

`eboard` + `chair` matches [rush announcements](./rush-portal.md): it covers the rush chair however they happen to be modelled — an eboard member with an `exec_title`, or a committee chair — without the route needing to know which.

:::note `requireGroup` is repeated per route
Rather than a `router.use()` above the management block. A router-level guard would apply to everything below it *in file order*, which is a trap for whoever adds the next rush-facing route at the bottom of the file.
:::

## Limits

| Constant | Value | Why |
|---|---|---|
| `MAX_CAPACITY` | 50 | A slot holding more isn't a slot, it's an event with a start time |
| `MAX_SLOTS_PER_SCHEDULE` | 500 | Guards a runaway script, not eboard's typing speed |
| `MAX_TITLE` | 150 | |
| `MAX_DESCRIPTION` | 2000 | |

## Not built

- **Waitlists.** If a slot frees up, whoever refreshes first gets it.
- **Automatic interviewer assignment.** `interviewer_id` is set by hand, or left null.
- **Reminders before the interview.** Only the calendar entry.
- **Recurring or bulk slot generation.** Deliberate — slot entry is explicit, with the chaining prefill as the ergonomic answer.
