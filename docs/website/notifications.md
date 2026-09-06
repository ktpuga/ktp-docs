---
sidebar_position: 14
---

# Notifications, Reminders and Email

The portal uses three notification channels.

| Channel | Audience | Purpose |
| --- | --- | --- |
| Tab badges | Portal users | Unread content and pending actions |
| iOS push | Eligible registered app devices | Timely alerts and reminders |
| Email | Eligible addresses with email enabled | Announcements and events selected by the sender |

No channel guarantees that a member reads a message. Push requires an app registration; email depends on configuration, recipient preferences, and delivery.

## Tab badges

Announcements, Calendar, Meetings, Polls, Interviews, Committees, and Tickets use counts supplied or derived by the portal. Messages has separate read receipts. Reports and Oversight display unresolved queue counts.

Files & Photos no longer has a badge.

### How "new" is decided

Most new-content counts compare visible records with a per-user tab cursor, `last_seen_at`. Opening the tab advances the cursor. Pending-action counts use different rules and do not clear on a visit.

### Nothing is retroactively unread

Missing cursors initialize to the current time, so existing content does not become unread at first use. This does not apply to pending invitations, committee activity, or moderation queues; those counts can be nonzero on the first visit.

### A badge never advertises something you can't open

Count queries must match the corresponding list's visibility:

- Group- or committee-targeted records count only for eligible readers.
- Untargeted announcements and events count for member groups, not rushees.
- Rushee announcement counts come from the rush-announcement table.

Test list and count queries together when changing targeting.

### Exclusions {#deliberate-quiet}

Own posts, closed or expired polls, and cancelled meetings do not contribute to new-content counts. Interview schedules count from publication rather than draft creation, and booking clears the corresponding signup prompt.

### Committees is different: the unit of "seen" is the committee

`committee_view_cursors` is keyed by user and committee. Opening a committee's detail view advances its cursor; opening the overview does not clear every committee.

The page separates unread events/announcements from actionable join requests. The sidebar adds them:

- New committee-targeted events and announcements, excluding the caller's posts.
- Pending join requests that the caller may decide.

Content counts cover the caller's own committees, including for eboard. Eboard can also receive approval counts for other committees. Chairs receive approval counts only for committees they chair.

An event can appear in both Calendar and Committees counts, and an announcement in both Announcements and Committees. Each represents a separate reading location. Files and newly joined members are not included.

### Message counts {#messages-is-different-on-purpose}

Messages use per-message read state rather than tab cursors. Reading messages clears the applicable unread count.

### The report and ticket queues count what is still OPEN

`/member/reports` and `/admin/oversight` share `ModerationQueue` and `TicketQueue`. Their badge sums:

| Queue | Counted state |
| --- | --- |
| Reports | `status = 'open'` |
| Tickets | `status <> 'closed'`, including in-progress tickets |

Opening the page does not clear these counts. Access uses the same eboard/judicial permission check as the queue endpoints.

`QUEUE_BADGE_SINCE` supplies a fixed cutoff, excluding items from before the badge was introduced. These keys have no advancing tab cursor.

### A ticket's author is told when it is answered

The `tickets` key is an ordinary cursor count for updates to the caller's signed tickets. A reply, closure, or other status update can count; visiting Tickets clears it.

Anonymous tickets have no author to match. Deleted authors also do not receive counts. `tickets.updated_at` tracks changes, and the count requires `updated_at > created_at` so submission does not notify its own author.

### Meetings counts unanswered invitations, not new meetings

The count includes scheduled meetings that have not started and still have a `pending` response for the caller. It ignores the tab cursor.

`CLEARS_ON_ACTION_NOT_VIEW` prevents optimistic clearing on navigation. Responding clears the pending action. Meetings that have started or been cancelled no longer count.

Unanswered meetings do not appear in the invitee's calendar. Calendar inclusion requires acceptance or organizer status.

### Calendar is different too: unanswered RSVPs outrank "new"

`usePendingRsvpCount` in `lib/use-pending-rsvps.js` derives pending event answers from `GET /events`. It checks RSVP eligibility, required RSVP state, no recorded answer, and an event that has not ended.

`badgeFor` shows the pending-RSVP count when nonzero; otherwise it shows the new-event count. It does not add the two, which could count one event twice.

The hook polls every 60 seconds, compared with 30 seconds for tab notifications and 10 seconds for messages. `RSVP_CHANGED_EVENT` requests an immediate refresh after an answer. The badge and calendar page live in separate component trees.

## Reminders

| Record | Reminder times before start |
| --- | --- |
| Ordinary event or meeting | Two hours and 30 minutes |
| Required event | One day, two hours, and 30 minutes |

Required-event reminders use the title "Required event" and state that attendance is taken. Event writes rebuild scheduled jobs, and deletion removes them.

Reminders use iOS push. Members without an eligible app registration do not receive them.

## Email

Email availability is returned by `GET /notifications/channels`. The compose checkbox and Settings UI use that response. Earlier deployment notes recorded missing credentials; check the endpoint for the current state.

Senders opt in per announcement or event through **Also send this as an email**. Marking an event required selects the checkbox by default, but the sender can clear it.

### What members control

**Settings → Email Notifications** controls `email_enabled`, which defaults to true. Turning it off does not hide portal content or remove sidebar badges.

Push-category preferences belong to the iOS notification settings and are not shown as browser notification controls.

### Rules the system enforces

- Recipients must match the item's targeting and pass account/preference filters.
- Alumni use their personal address; other recipients use the applicable stored chapter/UGA address.
- Each recipient receives an individual message.
- An atomic send claim limits each post to one send attempt; edits do not resend it.
- Email failures are logged without failing the announcement or event operation.

A claimed send is not proof of successful delivery to every recipient.

### Setup

Configure `RESEND_API_KEY` and `EMAIL_FROM` on the API server and verify the sending domain with the email provider. Missing configuration disables email without disabling the underlying post.

The API checks configuration before claiming a send. This avoids marking a post emailed when email is unavailable, but does not imply that enabling email later automatically sends earlier posts.
