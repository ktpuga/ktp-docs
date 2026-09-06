---
sidebar_position: 10
---

# Meetings

Members can schedule a meeting with individuals, a member group, or a committee. Invitees respond, and accepted meetings appear in the portal calendar and [calendar subscription](./calendar-subscription.md).

Meetings use member-only API routes. Rushees use [interview signup](./interviews.md) instead. Check each portal's navigation for the available meeting UI.

## Meeting or event? The committee page offers both

Committee chairs and eboard can open **New Meeting** or **Schedule Event** from a committee page.

| | New Meeting | Schedule Event |
| --- | --- | --- |
| Storage | `meetings` | `events` |
| Readers | Participants | Users matching the event's targeting |
| RSVP | Invitee response | Optional through `requires_rsvp` |
| Personal calendar | Organizer and invitees responding `going` | Users matching event visibility |
| Attendance/QR | No | Optional |
| Eboard's event-wide calendar | Not included as a private meeting | Event visible to eboard |

Meeting responses and event RSVPs have separate audience rules. Meeting responses belong to `meeting_invitees` and use `POST /meetings/:id/respond`. Event answers belong to `event_rsvps` and use `PUT /events/:id/rsvp`. Event recipients are derived from targeting and exposed as `canRsvp`; creating an event does not automatically make its creator a recipient.

In committee mode, `NewMeetingModal` receives `presetCommittee`. The committee is fixed in the form, the audience selector is hidden, and individuals can be added as guests.

## Why meetings are not rows in `events`

Private meetings use separate tables and participant checks. Eboard's broad event access does not grant an unfiltered view of personal meetings.

Calendar views merge the sources:

| Surface | Merge |
| --- | --- |
| Subscription feed | `calendarFeedController.getFeed` |
| Portal calendar | `EventsCalendar.jsx` through `loadCalendarItems()` |

Both use `GET /meetings/calendar` and `meetingModel.findForCalendar` for eligible meetings. The general meetings list also contains unanswered and declined invitations, so it is not a substitute for the calendar endpoint.

Calendar entries from meetings and interviews have namespaced IDs and explicit `isMeeting` / `isInterview` flags. `canDeleteEvent` rejects them. Keep these guards when adding another source so an action intended for meeting 4 cannot reach `/events/4`.

The subscription feed also namespaces UIDs. `calendarFeed.test.js` checks for collisions.

## The meeting is scheduled; attendees RSVP

The organizer's meeting status and each invitee's response are independent.

| Owner | Field | Values |
| --- | --- | --- |
| Organizer | `meetings.status` | `scheduled`, `cancelled` |
| Invitee | `meeting_invitees.response` | `pending`, `going`, `not_going` |

Invitees can change their answer. Responses do not cancel or reschedule the meeting.

### What reaches someone's real calendar

A meeting is included when it is not cancelled and the caller either organized it or responded `going`. Pending and declined invitations remain in the meetings list without being added to that invitee's personal calendar.

Cancellation removes the meeting from subsequent calendar responses; subscribed clients reflect that on their next refresh.

### A meeting has participants, not an audience

Calendar rows include `participants` from the caller's perspective: invitees for an organizer, or the organizer for an invitee. The UI uses `ParticipantBadge` rather than an "All Members" audience label.

Display names use:

```sql
COALESCE(
  preferred_name,
  NULLIF(TRIM(CONCAT_WS(' ', first_name, last_name)), ''),
  username
)
```

`CONCAT_WS` preserves a partial name when one component is null. The interview model uses the same approach for participant descriptions.

## Inviting a group or a committee

`MAY_BULK_INVITE` permits eboard, chairs, active members, and alumni to use group or committee selection. Pledges can create meetings with individually selected invitees.

`expandInvitees` resolves selections at creation time:

- Targeting `active` also includes chairs and eboard.
- Rushees and deleted accounts are excluded.
- Explicitly selected people are validated; a bad selection rejects the request.
- Ineligible people found through group expansion are filtered, including blocked accounts.

`findBlockedEitherWayIds` fetches block relationships together rather than once per invitee. `MAX_INVITEES` is 150.

## Invitees

Group and committee expansion is a snapshot. Later membership changes do not add or remove meeting invitees.

The organizer is not inserted as their own invitee. Their `my_response` is null, and the UI does not show them RSVP buttons.

## Who can invite whom

Blocks apply in both directions. Explicit invitee validation and group expansion handle blocked users differently, as described above.

### Rushees are excluded at three layers

| Layer | Restriction |
| --- | --- |
| API route | `SHARED_ALBUM_GROUPS` excludes rush |
| Expansion | Filters stored rush users |
| UI | No rushee meetings page |

The controller retains its narrower `RUSH_MAY_MEET` rule as an additional constraint if route access changes. Review it before reopening this feature to rushees.

## Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/meetings` | Meetings the caller organized or was invited to |
| `GET` | `/meetings/calendar` | Meetings eligible for the caller's calendar |
| `POST` | `/meetings` | `{ title, message?, location?, starts_at, ends_at, invitee_ids[], audience[]?, committee_ids[]? }` |
| `POST` | `/meetings/:id/respond` | `{ response: 'going' \| 'not_going' }` |
| `POST` | `/meetings/:id/cancel` | Organizer only |
| `DELETE` | `/meetings/:id` | Organizer only; over or cancelled |

Counter-proposals are not supported. An invitee can decline and create another meeting.

## Deleting a meeting

The organizer can delete an ended or cancelled meeting. A future scheduled meeting must be cancelled first so participants can see the cancellation.

Deletion removes the meeting and cascades its invitee rows. It sends no deletion push notification. Cancelled meetings appear under Past regardless of their scheduled date.
