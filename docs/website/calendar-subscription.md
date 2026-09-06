---
sidebar_position: 9
---

# Calendar Subscription

Members can subscribe to their chapter calendar in Apple Calendar, Google Calendar, or Outlook. In **Settings → Calendar Subscription**, create a link and choose **Subscribe**. The `webcal://` URL requests a subscription rather than a one-time file download.

## Calendar feeds and meetings {#why-this-instead-of-calendly}

The feed adds visible chapter events to a member's calendar. [Meetings](./meetings.md) handles scheduling and invitations. Together they replaced the former Calendly integration, removed by migration `1786300000000`.

## The URL is the credential

`GET /calendar/feed/:token.ics` does not require a bearer token. Calendar clients fetch the subscription URL without going through the website's login flow.

`users.calendar_feed_token` is a separate credential with these properties:

- Generated from 32 random bytes and encoded as base64url.
- Grants access only to that user's calendar feed.
- Created when requested rather than for every account.
- Replaced by `POST /calendar/feed`; the previous URL then returns `404`.
- Cleared during account anonymization. Token lookup also excludes deleted users.

Keep feed URLs private. Regenerate a disclosed link and update subscriptions that used the old one.

## Feed visibility {#it-cannot-leak-more-than-the-portal}

Chapter events come from `eventModel.findAllForUser`, which also filters portal events. Rushees receive only events visible to their group. `test/calendarFeed.test.js` checks that internal titles do not appear in a rushee's feed.

### Three sources, one rule each

| Source | Function | Included when |
| --- | --- | --- |
| Events | `eventModel.findAllForUser` | Visible to the user |
| [Meetings](./meetings.md) | `meetingModel.findForCalendar` | Not cancelled, and the user organized it or responded `going` |
| [Interviews](./interviews.md) | `interviewModel.findForCalendar` | The user booked the slot |

Each source performs its own filtering. The controller merges the results without maintaining another visibility rule.

UIDs include a source prefix, such as `ktp-event-meeting-4@…`, so equal numeric IDs in different tables do not overwrite one another in calendar clients.

Without a bearer token, the feed derives groups from stored `member_group` and applies `expandImpliedGroups`. This includes `active` for chairs and eboard, matching normal API authorization.

## The ICS serializer

`services/icalendar.js` implements the subset of RFC 5545 needed by the feed. It emits UTC timestamps without recurrence, alarms, or timezone definitions.

`test/icalendar.test.js` covers:

- **Escaping:** escape backslashes before commas, semicolons, and newlines.
- **Folding:** break lines at 75 octets with CRLF and a leading continuation space. Count UTF-8 bytes and do not split a code point.
- **Line endings:** use CRLF throughout.
- **Stable UIDs:** derive them from stored IDs so a refresh updates an existing event.
- **Invalid dates:** omit events without a usable start and omit an end that precedes the start.
- **Empty results:** return a valid empty calendar.

## Refresh timing, and what to tell members

Calendar clients control polling. A feed change may take hours to appear, and the refresh hints `REFRESH-INTERVAL` and `X-PUBLISHED-TTL` do not guarantee a deadline.

Use the portal or notifications for recent schedule changes. The Settings page should explain that a subscription is not an immediate-update channel.

## Proxying

`app/api/calendar/feed/[token]/route.js` proxies the public subscription URL to the API. It uses `dynamic = "force-dynamic"` so framework caching does not add another delay. The website uses explicit proxy handlers rather than a generic `/api/*` rewrite.
