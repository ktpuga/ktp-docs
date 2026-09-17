---
sidebar_position: 15
---

# Attendance log and emergency requests

Attendance has three views:

- **Community > Attendance**: your own mandatory chapter-event record and emergency requests.
- **Committees > Judicial Board > Attendance log**: chapter totals, historical roster review, and emergency decisions. Executive board members reach the same tools under **People > Judicial Board**.
- **Committees > Committee attendance**: a chair's own committee event totals. Executive board members can choose any committee under **Events > Committee attendance**.

**Check-in management** still runs QR check-in and manual attendance corrections. Members who only need their own record do not see reviewer controls on the personal page.

## What members see

Members choose a semester and see their own attended events, missed events, counted absences, emergency waivers, and remaining free absences. In chapter and committee logs, **View events** opens the member record in a modal over the page. Close it with **Close record**, Escape, or the backdrop. The missed-events filter includes waived absences so a member can still see every event they missed.

- Four free absences per semester for mandatory chapter events. Absent marks and closed unmarked obligations use this allowance. Excused marks do not; record ordinary excuses as Absent. Committee events have separate totals with no four-absence allowance.
- Only calendar events explicitly marked **Mandatory attendance**, with QR tracking enabled and a verified expected-attendee roster, enter a tally. QR tracking alone does not make an event mandatory.
- An event enters the tally when its scheduled start time arrives. Check-in remains open until 30 minutes after its end. An unmarked member is pending until that window closes.
- A recorded `present` mark counts as attended. A missing mark or `absent` counts as an absence after check-in closes. An `excused` mark is recorded separately and does not consume the allowance.
- An approved emergency waiver removes that absence from the allowance. It does not create a check-in or change the underlying attendance mark.
- Totals update from saved attendance marks and waiver decisions. The page refreshes every 30 seconds while visible and when the browser regains focus. Refresh pauses during an open form or member-detail review; close it or use Refresh to load updates.

**Excused** counts completed absences marked excused through check-in management that have not been emergency-waived. It is separate from counted absences and never consumes a free absence. **Emergency waived** counts approved emergency absences separately. A waived event appears only in that column, even if its underlying attendance mark is excused. Pending events do not enter either count until check-in closes. Committee logs show Excused but do not expose private emergency decisions.

The Judicial Board determines semester dates. Authorized reviewers enter them with **Add semester** or **Edit semester dates**. Dates are inclusive, use the event's start date in `America/New_York`, and cannot overlap. Changing the dates recalculates which events belong to that semester. The system does not impose a penalty when the allowance is exceeded; it displays the count for review.

## Mandatory events and committee scope

The calendar event form and committee event form have a **Mandatory attendance** checkbox. It defaults off. Turning it on also enables QR tracking; turn mandatory off before disabling tracking. An optional event can still offer QR check-in without counting absences.

An event with no targeted committees belongs to the chapter tally. An event with one or more targeted committees belongs to those committee logs and is excluded from the chapter allowance, even if it also targets a member group. A shared event appears once in each relevant committee log. Use no committee targets for chapter-wide events such as chapter, technical development, or professional development sessions.

The separate **Meetings** feature remains invitation/response based. It is not included in these attendance totals and does not gain QR check-in.

Committee log access checks actual committee chair assignments in the database, not just the general `chair` role. A chair cannot choose another committee ID to read its log. Committee totals show attended, absent, and pending counts with per-event detail. Chairs do not receive emergency explanations, documents, or waiver decisions. Historical committee rosters needing review are flagged for the Judicial Board or executive board, who verify them from the reviewer page.

Existing events default to non-mandatory when the new migration runs. Mark the events you intend to count explicitly; existing check-in records are preserved. An older client that omits `mandatoryAttendance` while editing preserves the existing setting. New required-event reminders and email labels follow the mandatory setting. The migration removes old day-ahead event reminders and resets their required wording because existing events start optional; meeting reminders are unchanged.

## Expected attendees and historical review

An API worker runs at startup and every minute. During a mandatory event's check-in window, it captures the active members, chairs, and executive board members expected by its group or committee audience. Test accounts, deleted accounts, and incomplete profiles are excluded. A captured roster does not change when someone later changes groups.

Migration `1791700000000_add-attendance-log.sql` imports active-member obligations from existing finalized rosters. They only enter totals after the event is marked mandatory. Other completed events are flagged under **Chapter attendance → Historical rosters needing review**. They are excluded from totals until reviewed, and the page labels totals incomplete.

A Judicial Board or executive board member opens **Review roster**, checks the people who were expected using historical records, and records how the list was verified. Existing attendance rows are selected as a starting point; today's full membership is never automatically charged for a past event. The reviewer must confirm the selected count, including an intentionally empty roster. Verification does not change existing check-ins. A verified roster cannot be replaced by submitting the review again.

A member who becomes eligible after the automatic snapshot is not added to that event's obligation list. Membership or audience corrections after capture therefore need investigation before relying on that event's totals. If the API is unavailable for an entire check-in window, that event goes through historical review instead of guessing its roster.

## Emergency requests

A member opens **Request emergency waiver**, chooses an eligible upcoming event or a non-attended event on their verified record, and submits:

- A written explanation, up to 5,000 characters.
- One PDF, PNG, or JPEG document, up to 5 MB.

This creates a request in the Judicial Board and executive board queue. It does not send an email or grant a waiver automatically. Reviewers use **Emergency requests**, preview the documentation in a dialog, and approve or deny with a written decision note. The member sees their own status and note. Reviewers cannot decide their own requests.

New emergency requests apply to mandatory chapter events, not committee events. Only one pending or approved request per member/event is allowed. A denied request can be submitted again with additional documentation. Decisions record the reviewer, time, explanation, and version. A second reviewer using an older version must refresh before saving. Revising a decision appends to the decision history; it does not erase the earlier decision.

## Access and documents

The API checks the authenticated user for every request. Members cannot choose another user ID for their own records or requests. Chapter totals, roster verification, the emergency queue, and decisions require `eboard` or membership in the committee with slug `judicial`. Being a chair of another committee does not grant access.

Documents are stored privately in Postgres as binary data, not in the shared document library or a public URL. Only the submitting member, Judicial Board, and executive board can access one. Metadata responses omit file bytes. Previews use an authenticated website proxy with `private, no-store`, `nosniff`, and a sandbox policy. The API returns an attachment; the website changes successful PDF, PNG and JPEG responses to inline disposition, preserving the filename. The API checks the file signature and supplied type; it does not run an antivirus scan. Database backups include this documentation. Do not put explanations or file contents in application logs.

## API routes

All routes below require bearer authentication and a member group. The API also enforces the additional reviewer checks described above.

| Method and path | Purpose |
| --- | --- |
| `GET /attendance-log/access` | Reviewer access plus committees the caller chairs (all committees for executive board) |
| `GET /attendance-log/committees/:committeeId?semester_id=` | Separate committee totals and records, checked against chair assignments or executive board access |
| `GET /attendance-log/semesters` | Semester choices |
| `POST /attendance-log/semesters` | Create semester, reviewer only |
| `PUT /attendance-log/semesters/:id` | Update semester name/dates, reviewer only |
| `GET /attendance-log/mine?semester_id=` | Caller records, totals, upcoming eligible events, incomplete-history flag |
| `GET /attendance-log/members?semester_id=` | Chapter totals, reviewer only |
| `GET /attendance-log/members/:userId?semester_id=` | Member event detail, reviewer only |
| `GET /attendance-log/incomplete?semester_id=` | Events needing roster review, reviewer only |
| `GET /attendance-log/rosters/:eventId` | Historical roster choices, reviewer only |
| `PUT /attendance-log/rosters/:eventId` | Save verified `user_ids` and required `note`, reviewer only |
| `GET /attendance-log/excuses/mine?semester_id=` | Caller requests only |
| `GET /attendance-log/excuses?semester_id=` | Reviewer queue |
| `POST /attendance-log/excuses` | Multipart `event_id`, `explanation`, and `document` |
| `PUT /attendance-log/excuses/:id` | Reviewer decision: `status`, `note`, and current `version` |
| `GET /attendance-log/excuses/:id/document` | Owner/reviewer attachment download |

## Rollout

1. Apply `1791700000000_add-attendance-log.sql` if not already applied, then `1791800000000_separate-mandatory-attendance.sql`, before deploying this API version.
2. Deploy the API, then the website. The earlier inactive-role migration does not create these tables.
3. Confirm the committee slug is `judicial`, and configure the semester dates agreed by that board.
4. Mark the calendar events that should count as mandatory and review flagged historical rosters before treating semester totals as complete.
5. Verify a member sees only their record, a reviewer can decide a synthetic request, and a manual attendance correction updates the tally.

The down migration deletes these new tables, including requests and evidence. Do not run it against a populated deployment without a separate data-preservation plan.

## Full event history

Personal attendance and View events include started events in the selected semester that are visible to the member, plus events with their saved attendance or RSVP even if their membership later changed. Optional events appear without requiring an RSVP. Calendar visibility uses the current stored role and committee memberships because historical visibility is not recorded. Verified mandatory obligations still use the saved roster.

Each row has `mandatory_attendance` and `counts_toward_total`. Only verified required rows in the current log have `counts_toward_total: true`; supplemental history rows are false. This keeps chapter and committee totals separate and prevents optional events or unverified history from consuming free absences. A required event outside the current tally is labeled accordingly. Current committee members may have history with zero counted events.

An optional event without a check-in says No attendance recorded, with the member's RSVP when available. An RSVP never becomes proof of attendance. Show missed required events only excludes supplemental history, and emergency waiver choices still include only eligible required chapter events. Reviewers without access to a supplemental event see Private event; its source ID is omitted.

## Scheduling conflicts and popups

The event table includes scheduling conflicts for that member. It checks every overlapping calendar event, regardless of audience, required status, RSVP, check-in, or whether it appears in the member history. This includes rush events targeted at a different group and events the member declined. Meetings still require an organizer or accepted-invite relationship, and interviews still require a booking or interviewer assignment. Calendar overlap alone does not prove attendance. Event conflicts include the recorded attendance status when available, so an attended rush event is distinguished from an event with no attendance record. A shared boundary is not an overlap: a meeting ending exactly when an event starts is excluded. Cancelled meetings, declined invitations, and unclaimed interview slots are excluded.

Conflicts are information for the reviewer. They do not mark attendance, excuse an absence, or grant an emergency waiver. The lookup uses retained schedules and assignments, so deleted or changed appointments may no longer describe the original conflict.

Each conflict includes its type and start/end times. Event titles follow calendar visibility. Meeting titles are visible only to that meeting's organizer or invitees, even when the reviewer is on the executive board. Interview round titles are visible to the member involved, the pledge committee, and executive board. Other viewers see a private meeting/interview/event label and its time. No participant lists, candidate identities, messages, locations, or source IDs are included.

Personal records, member detail, and committee records return a `conflicts` array per attendance record. Entries contain `type` (`event`, `meeting`, or `interview`), `title` (nullable), `starts_at`, `ends_at`, and `attendance_status` (null for meetings and interviews). Chapter summary responses do not run this lookup. No additional migration is needed; deploy the API before the website for conflict details.

View events, emergency request forms, emergency review, semester editing, and historical roster review open above the page. Errors stay inside the form, and unsuccessful submissions preserve its contents. Close, Escape, or clicking outside dismisses a popup; saving temporarily disables dismissal.


The chapter attendance table shows Member, Attended / total, Absences, Excused, Emergency waived, and Record. Free left and Over allowance are omitted from the table. The allowance calculation and the summary cards in personal attendance and the member-detail popup are unchanged.


Required event titles appear blue in the history table in light and dark mode. The revised Excused rule applies to existing saved Excused marks as well as new ones. It changes calculated totals, not stored attendance marks, and requires no migration. The required-event denominator still includes excused events; Excused is not treated as Attended.


## Response badges and document previews

**Emergency excuse responses** links members to their requests and displays the number of unread current-semester decisions. The reviewers' **Emergency requests** button shows requests awaiting review. Viewing a page does not acknowledge decisions; the existing **Mark attendance updates as read** action persists read state across devices.

**Preview documentation** opens an in-page dialog, not a new tab. Close, Escape and backdrop dismissal return to the attendance page; closing restores focus. The preview uses up to 90% of the viewport height with a visible header and Close button. PNG and JPEG images use contain sizing to fit the available area. PDFs use the browser viewer with `view=Fit` and collapsed navigation panes; support for these settings depends on the browser. Multi-page PDFs can still require internal scrolling. These are layout defaults, not a guarantee that long documents remain readable without zooming.
