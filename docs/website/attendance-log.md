---
sidebar_position: 15
---

# Attendance log and emergency requests

**Attendance log** appears in the member portal and the executive board portal. The existing **Attendance** page still runs QR check-in and manual attendance corrections.

## What members see

Members choose a semester and see their own attended events, missed events, counted absences, emergency waivers, and remaining free absences. The missed-events filter includes waived absences so a member can still see every event they missed.

- Four free absences per semester. Both excused and unexcused absences use this allowance.
- Only events with attendance enabled and a verified expected-attendee roster enter the tally.
- An event enters the tally when its scheduled start time arrives. Check-in remains open until 30 minutes after its end. An unmarked member is pending until that window closes.
- A recorded `present` mark counts as attended. A missing mark, `absent`, or `excused` counts as an absence after check-in closes.
- An approved emergency waiver removes that absence from the allowance. It does not create a check-in or change the underlying attendance mark.
- Totals update from saved attendance marks and waiver decisions. The page refreshes every 30 seconds while visible and when the browser regains focus. Refresh pauses during an open form or member-detail review; close it or use Refresh to load updates.

The Judicial Board determines semester dates. Authorized reviewers enter them with **Add semester** or **Edit semester dates**. Dates are inclusive, use the event's start date in `America/New_York`, and cannot overlap. Changing the dates recalculates which events belong to that semester. The system does not impose a penalty when the allowance is exceeded; it displays the count for review.

## Expected attendees and historical review

An API worker runs at startup and every minute. During an event's check-in window, it captures the active members, chairs, and executive board members expected by its group or committee audience. Test accounts, deleted accounts, and incomplete profiles are excluded. A captured roster does not change when someone later changes groups.

Migration `1791700000000_add-attendance-log.sql` imports active-member obligations from existing finalized rosters. Other completed events are flagged under **Chapter attendance → Historical rosters needing review**. They are excluded from totals until reviewed, and the page labels totals incomplete.

A Judicial Board or executive board member opens **Review roster**, checks the people who were expected using historical records, and records how the list was verified. Existing attendance rows are selected as a starting point; today's full membership is never automatically charged for a past event. The reviewer must confirm the selected count, including an intentionally empty roster. Verification does not change existing check-ins. A verified roster cannot be replaced by submitting the review again.

A member who becomes eligible after the automatic snapshot is not added to that event's obligation list. Membership or audience corrections after capture therefore need investigation before relying on that event's totals. If the API is unavailable for an entire check-in window, that event goes through historical review instead of guessing its roster.

## Emergency requests

A member opens **Request emergency waiver**, chooses an eligible upcoming event or a non-attended event on their verified record, and submits:

- A written explanation, up to 5,000 characters.
- One PDF, PNG, or JPEG document, up to 5 MB.

This creates a request in the Judicial Board and executive board queue. It does not send an email or grant a waiver automatically. Reviewers use **Emergency requests**, download the documentation, and approve or deny with a written decision note. The member sees their own status and note. Reviewers cannot decide their own requests.

Only one pending or approved request per member/event is allowed. A denied request can be submitted again with additional documentation. Decisions record the reviewer, time, explanation, and version. A second reviewer using an older version must refresh before saving. Revising a decision appends to the decision history; it does not erase the earlier decision.

## Access and documents

The API checks the authenticated user for every request. Members cannot choose another user ID for their own records or requests. Chapter totals, roster verification, the emergency queue, and decisions require `eboard` or membership in the committee with slug `judicial`. Being a chair of another committee does not grant access.

Documents are stored privately in Postgres as binary data, not in the shared document library or a public URL. Only the submitting member, Judicial Board, and executive board can download one. Metadata responses omit file bytes. Downloads use an authenticated website proxy with `private, no-store`, attachment disposition, `nosniff`, and a sandbox policy. The API checks the file signature and supplied type; it does not run an antivirus scan. Database backups include this documentation. Do not put explanations or file contents in application logs.

## API routes

All routes below require bearer authentication and a member group. The API also enforces the additional reviewer checks described above.

| Method and path | Purpose |
| --- | --- |
| `GET /attendance-log/access` | Whether the caller can manage the log |
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

1. Apply API migration `1791700000000_add-attendance-log.sql` before deploying the API that uses it.
2. Deploy the API, then the website. The earlier inactive-role migration does not create these tables.
3. Confirm the committee slug is `judicial`, and configure the semester dates agreed by that board.
4. Review flagged historical rosters before treating semester totals as complete.
5. Verify a member sees only their record, a reviewer can decide a synthetic request, and a manual attendance correction updates the tally.

The down migration deletes these new tables, including requests and evidence. Do not run it against a populated deployment without a separate data-preservation plan.