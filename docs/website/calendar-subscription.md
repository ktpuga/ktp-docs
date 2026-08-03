---
sidebar_position: 9
---

# Calendar Subscription

Members can subscribe to their chapter calendar from Apple Calendar, Google Calendar or Outlook. Every event they're allowed to see appears in their own calendar app and keeps updating on its own, with no further action.

Set it up in **Settings → Calendar Subscription**. The member creates a link, clicks **Subscribe** (a `webcal://` URL, which is what makes a client subscribe rather than download a one-off snapshot), and that's it.

## Why this instead of Calendly

Calendly was never going to do this. It writes to exactly two calendars — the account owner's and the booker's — and has no idea the chapter roster exists, so a chapter event created in the portal could never reach a member's calendar through it. That's a *calendar feed* problem, which is a completely different mechanism. Calendly was removed entirely on 2026-08-02 (migration `1786300000000`) once this and [meetings](./meetings.md) had replaced both halves of it.

## The URL is the credential

`GET /calendar/feed/:token.ics` is **unauthenticated**. It is the only unauthenticated read path in the API that returns member-visible data, and that is deliberate: a calendar client cannot log in, hold a session, or refresh an access token. It stores a URL, sometimes for years, and re-fetches it on a schedule of its own choosing. An access token would expire within the hour with nothing able to renew it.

So `users.calendar_feed_token` is a dedicated credential rather than a reused JWT:

- **32 bytes of CSPRNG output, base64url.** Unguessable, not merely unique. A UUID would be fine on entropy but reads as an identifier, and people treat identifiers as safe to paste into shared documents.
- **Single purpose.** It grants exactly one capability: read this person's visible events. It cannot be used against any other endpoint.
- **Revocable independently.** Regenerating the token is what revokes a leaked link. It doesn't touch their password or session, and every client subscribed to the old URL starts 404ing immediately.
- **NULL until requested.** Generating one for everybody up front would create hundreds of live credentials nobody asked for.
- **Cleared by `anonymize()`.** Otherwise a deleted account's calendar would keep serving chapter events forever. `findByCalendarFeedToken` also checks `deleted_at IS NULL` as a second line.

`POST /calendar/feed` both creates and regenerates, on purpose — they're the same operation, and a separate "regenerate" route would imply the old link survives until you call it.

## It cannot leak more than the portal

The feed calls `eventModel.findAllForUser`, the **same** function the portal and iOS app use. It does not reimplement the audience filter. Doing so would make it a second place visibility can be wrong, and a wrong answer in a calendar feed is one that keeps getting re-fetched for months.

A rushee's feed therefore contains rush-targeted events and nothing else, for exactly the same reason their portal calendar does. `test/calendarFeed.test.js` asserts this against a real database, including that internal event titles don't appear anywhere in the rendered file.

:::warning Group derivation
The feed has no bearer token, so it rebuilds the caller's groups from the stored `member_group` and runs them through `expandImpliedGroups` — the same function `middleware/auth.js` applies to a normal request. That function is exported for this reason rather than duplicated.

Without it a **chair** would silently miss every actives-targeted event in their calendar, because their `member_group` column says `chair` while the event targets `active`.
:::

## The ICS serializer

`services/icalendar.js` is a hand-rolled RFC 5545 writer. No dependency: this repo already can't run `npm audit fix` because of the React 19 peer conflict on the website side, so every package has a real ongoing cost, and the subset a read-only feed needs is small. It is **not** a general iCalendar library — no recurrence, no alarms, no timezones. Everything is emitted as UTC, which sidesteps `VTIMEZONE` entirely.

Two functions do the work that actually goes wrong, and both fail *silently* — the file still imports, it just imports wrong. They're tested directly in `test/icalendar.test.js`.

**Escaping** (§3.3.11). Comma and semicolon are field separators, so an unescaped comma in "Info Session, Boyd 208" splits the field and the title arrives truncated. Backslash must be escaped **first**; escaping it afterwards would double-escape the backslashes the other rules just introduced.

**Folding** (§3.1). Lines fold at 75 **octets**, not characters, with a CRLF and a single leading space continuing the line. The distinction matters because an emoji in an event title is four bytes in UTF-8: counting characters lets a line exceed the limit, and splitting on a character boundary computed from a byte budget can cut a multi-byte sequence in half and corrupt it. The implementation walks code points and only breaks between whole ones.

Also worth knowing:

- **CRLF everywhere.** A bare LF is the most common reason a hand-built `.ics` is rejected outright, and it's invisible in a diff.
- **UIDs are stable**, derived from the event row id. A random UID per render would make every refresh duplicate the whole calendar instead of updating it.
- **Unrepresentable events are dropped, not emitted broken.** An event with no start can't be expressed; an event whose end precedes its start makes some clients discard it silently, so `DTEND` is omitted instead.
- **An empty calendar is still a valid document.** Clients treat a malformed feed as a subscription error and some stop retrying.

## Refresh timing, and what to tell members

Calendar apps decide for themselves how often to re-poll. Apple is usually within the hour; **Google can take up to a day** and it is not configurable. `REFRESH-INTERVAL` and `X-PUBLISHED-TTL` are advisory and Google ignores them.

So the feed is excellent for "my whole semester is in my calendar" and useless for "the meeting moved twenty minutes ago". Push notifications cover the urgent case. The Settings UI says this outright, because a member who doesn't know it will report the feature as broken.

## Proxying

There is no generic `/api/*` rewrite in the website — every proxied path is an explicit route handler. `app/api/calendar/feed/[token]/route.js` is what makes the subscription URL work, and it is public, matching `app/api/homepage-photos`. It sets `dynamic = "force-dynamic"`: the feed changes whenever an event does, and framework-level caching would serve a stale calendar on top of the client's own refresh delay.
