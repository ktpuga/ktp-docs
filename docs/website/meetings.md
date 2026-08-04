---
sidebar_position: 10
---

# Meetings

Any member can set up a meeting with specific people, a whole member group, or a committee. Everyone invited RSVPs, and it lands on the calendar of whoever says they're going — including their [calendar subscription](./calendar-subscription.md).

This is the second half of replacing Calendly. Calendly couldn't do it: it has no approval step at all. You publish open availability, someone grabs a slot, it's auto-confirmed. There is no "request, then accept", and every member would have needed their own account.

Available in all five portals at `/<portal>/meetings`, plus a **Make a meeting** button on any profile in the directory — the slot Calendly's booking link used to occupy.

## Meeting or event? The committee page offers both

A committee chair can create either, and for a while a single **Schedule Meeting** button on the committee page created an *event* — the wrong one, under the other one's name. The button is now split in two, with the difference stated on the page itself.

| | **New Meeting** | **Schedule Event** |
|---|---|---|
| Creates | a row in `meetings` | a row in `events` |
| Who sees it | only the people invited | everyone on the committee |
| RSVP | yes — `going` / `not_going` | none |
| Reaches a personal calendar | only for whoever accepts | for the whole committee |
| Attendance / QR check-in | no | yes, opt-in (defaults on) |
| Visible to eboard's unfiltered calendar | no | yes |

Rule of thumb: **a meeting asks, an event announces.** Use a meeting when you need to know who's coming and it's nobody else's business; use an event when it belongs on the calendar and you may want to scan people in.

Both buttons show for a committee's chair and for eboard, matching `checkEventPermission` — eboard may schedule for any committee, a chair only for one they chair.

Opening **New Meeting** from a committee page passes `presetCommittee` to `NewMeetingModal`: that committee is locked in as the invitee list (a chip, not the usual picker — choosing a *different* committee from inside one committee's page would be a surprise), while the individual picker stays open for adding a guest. The audience selector is hidden entirely in this mode.

## Why meetings are not rows in `events`

This was the obvious design, and it's wrong for one decisive reason.

Putting them in `events` would have made the calendar, the ICS feed and push targeting work for free. But **`eventModel.findAll()` returns every event unfiltered**, and that is what eboard's calendar uses. Personal one-on-ones living there would put every member's private meetings in front of eboard, and the only thing preventing it would be remembering to filter in each place.

In their own tables, privacy is structural: nothing reads `meetings` except through a participant check, so there is no unfiltered view to forget about. It also keeps a new feature away from `eventModel.findAllForUser` — the query that has already caused one production outage.

The cost is that the calendar and the ICS feed each merge two sources. Both places pay it:

| Surface | Where the merge happens |
|---|---|
| Subscribed calendar (Apple/Google) | `calendarFeedController.getFeed` |
| Portal **Calendar** tab | `EventsCalendar.jsx`, via `loadCalendarItems()` |

Both read `GET /meetings/calendar` → `meetingModel.findForCalendar`, so "what's on my calendar" has exactly one definition. The frontend deliberately does **not** filter `GET /meetings` itself — that returns declined and unanswered meetings too, and restating the rule in JSX would let it drift.

:::danger Meetings must be flagged in the merged list
Meeting ids and event ids both start at 1, and the calendar's delete button calls `deleteEvent(id)` against `/events/:id`. An unguarded Delete on meeting 4 would destroy the unrelated **event** 4.

`asCalendarEntry` therefore sets `isMeeting: true`, namespaces the id, and leaves `createdBy` undefined, and both `canDelete` checks in `EventsCalendar` refuse meetings outright. Meetings are cancelled by their organizer from the Meetings tab, never deleted from the calendar.
:::

:::note UID namespacing
Meetings and events both have ids starting at 1, so the feed prefixes meeting ids (`ktp-event-meeting-4@…`). Without that, meeting 4 and event 4 would be the same entry to a calendar client and one would silently overwrite the other.
:::

## The meeting is scheduled; attendees RSVP

A meeting is on the books the moment it's made. `meetings.status` is the organizer's business alone — `scheduled` or `cancelled` — and an RSVP never changes it.

| Who | Field | Values |
|---|---|---|
| Organizer | `meetings.status` | `scheduled`, `cancelled` |
| Attendee | `meeting_invitees.response` | `pending`, `going`, `not_going` |

This replaced an earlier request/accept model where the meeting only counted as happening once somebody accepted, and the meeting-level status was *derived* from the invitee rows. RSVP makes those two questions independent, which removed the trickiest logic in the model: `respond()` now records one row and nothing else.

An RSVP can be **changed** — plans change, and the calendar should follow. The buttons stay visible after answering, with the current choice highlighted.

### What reaches someone's real calendar

`findForCalendar` returns a meeting when it isn't cancelled **and** you either organised it or RSVP'd `going`.

Deliberately excluded:

- **`pending`** — an invitee who hasn't answered. Their Meetings tab shows the prompt, but nobody else gets to put entries on their personal calendar without their say-so.
- **`not_going`** — the meeting still happens, just not for them.

Cancelling removes it from everyone's calendar at once, since the status check comes first.

## Inviting a group or a committee

Members can invite a whole member group or committee instead of picking people one at a time, using the same `AudienceSelect` as announcements.

**Who may:** eboard, chair, active and alumni — `MAY_BULK_INVITE` in `meetingsController`. **Pledges and rushees can still make meetings, but must pick individuals.** That constant is deliberately not derived from `SHARED_ALBUM_GROUPS`, which answers "is this a real member" and includes pledges; this is the narrower question of who is established enough to summon a slice of the chapter.

`expandInvitees` resolves the selection to user ids at creation time:

- **`active` implies `chair` and `eboard`**, matching event and group-chat targeting.
- **Rushees are never expanded in**, even if asked for directly. A member picking a broad audience should not be quietly pulling prospective members into a chapter meeting — so the picker passes `exclude={['rush']}` and the model enforces it regardless.
- Soft-deleted members are excluded.

:::note Individually-picked and group-expanded people are validated differently
A person you **named** is checked strictly and a failure rejects the whole request — you picked them deliberately, so silently dropping them would produce a meeting you believe includes them.

A person the **group expanded to** is filtered instead. Failing an eighty-person meeting because one active blocked you is useless, and a refusal would tell you exactly who blocked you.

Blocks are fetched once via `findBlockedEitherWayIds` rather than per invitee — the old per-head `isBlockedEitherWay` was an N+1 that expanding a group would have turned into 150 queries.
:::

`MAX_INVITEES` is 150. The cap exists so a meeting can't become an unbounded broadcast that bypasses announcements, not because meetings must be small.

## Invitees

A join table rather than a single invitee column, so "one-on-one" and "with a group" are the same feature with a different row count instead of two code paths.

Group and committee invites expand **at creation time** — deliberately a snapshot, unlike [group chats](./messaging.md), whose membership tracks roles live. Someone who joins Marketing next week wasn't invited to today's meeting, and someone who leaves doesn't get un-invited from one they already RSVP'd to. The form says so outright.

The **organizer is never an invitee of their own meeting**: they have nothing to RSVP to, and including them would make a one-on-one look like a two-person group. Their `my_response` comes back `null`, which is what the UI uses to decide whether to show RSVP buttons at all.

## Who can invite whom

Rushees may only invite **eboard and chairs**, mirroring the DM restriction in `messagesController` exactly and for the same reason: rush accounts are self-created by strangers, the directory is closed to them precisely so they can't pick members out of it, and an invitee id is just a value in a request body.

Blocking cuts both ways here as it does in messaging, otherwise a meeting invite is a way to put text in front of someone who blocked you. How a block is *handled* depends on how the person got invited — see the note above on named vs expanded invitees.

## Endpoints

| Method | Path | Notes |
|---|---|---|
| `GET` | `/meetings` | Everything you organised or were invited to, with invitees and your own response |
| `POST` | `/meetings` | `{ title, message?, location?, starts_at, ends_at, invitee_ids[], audience[]?, committee_ids[]? }` |
| `POST` | `/meetings/:id/respond` | `{ response: 'going' \| 'not_going' }` |
| `POST` | `/meetings/:id/cancel` | Organizer only |

Gated on `RUSH_ACCESSIBLE_GROUPS` — rushees can use meetings, with *who* they may invite narrowed in the controller.

Counter-proposing a different time isn't built. RSVPing no and setting up your own covers it for now.

## Deleting a meeting

`DELETE /meetings/:id` — **organizer only, and only once the meeting is over or already cancelled.**

That date rule is deliberate. Cancelling a future meeting leaves everyone a record it was called off and pulls it from their calendar subscription. Deleting it makes it vanish with no trace, so someone who had it in Apple or Google Calendar just finds an appointment they can no longer explain. **Cancel means "it's not happening"; delete is for tidying up afterwards.** The two buttons are therefore never both offered on a live meeting — you cancel first, and it becomes deletable.

A hard delete: `meeting_invitees` has `ON DELETE CASCADE`, so invitee rows go with it. No soft-delete column, because `meetings` is already invisible to non-participants (every read goes through `IS_PARTICIPANT`) and a `deleted_at` would only add a filter every future query has to remember. No push notification, unlike cancel — there is nothing actionable in "a meeting you already attended was tidied out of a list".

Cancelled meetings also file under **Past** regardless of their date, so a cancelled future meeting no longer sits in Upcoming looking like something to turn up to.
