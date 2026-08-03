---
sidebar_position: 1
---

# Overview

The **member portal** (`uga-ktp-website`, [ugaktp.com](https://ugaktp.com)) is a Next.js 15 app (App Router, Tailwind, shadcn/ui) that serves both the public marketing site and the logged-in member portals. It talks to `ktp-api` for all data — see [API Overview](../api/overview.md) for the backend side of everything described here.

---

## Portals

Every member is routed to one portal based on their Authentik group (see [Auth & Onboarding](../authentik/overview.md)):

| Group | Portal |
|-------|--------|
| `eboard` | `/admin` |
| `chair`, `active` | `/member` |
| `alumni` | `/alumni` |
| `pledge` | `/pledge` |
| `rush` | `/rushee` — see [Rush Portal](./rush-portal.md) |

`middleware.ts` enforces these boundaries — visiting a portal you don't belong to redirects you to your actual one. It also gates `/complete-profile` for anyone who hasn't finished onboarding yet.

**All five portals** share the `PortalShell` component (grouped sidebar nav, dark mode toggle, profile card, sign-out). The earlier inconsistency where `/pledge` had its own hand-rolled layout is resolved.

### Accent colors

The portals are one visual family rather than four colour-coded ones: `/member`, `/pledge` and `/rushee` all render the same blue, `/alumni` keeps amber, and `/admin` is the only portal whose colour is a **user preference** — eboard picks red or blue from Settings, stored per-browser under the `ktp-admin-accent` key.

Because Admin's colour is no longer fixed, it can't be a hardcoded constant. `PortalAccentProvider` (in `components/portal/PortalAccentContext.jsx`) publishes the resolved palette from `PortalShell`, and any component at any depth reads it with `useAccentPalette()`. Admin-only components — Analytics, User Management, Announcements, Rush Signup, Rush Announcements, Homepage Photos, iOS Slideshow, Moderation — all use the hook, so an Admin page follows the toggle rather than staying maroon.

Two things deliberately stay hardcoded and should not be converted: **member-group identity colours** (the maroon chip that means "eboard" in the directory, charts and group chats) and **destructive/danger styling**. Those carry meaning independent of which portal you're in.

:::note
`accent` doubles as the key into `PortalShell`'s `NAV_GROUPING` map, so it selects the sidebar contents as well as the colour. Repointing a portal's `accent` to share another's palette empties its sidebar — recolour the palette entry instead.
:::

---

## Shared features across portals

The portals share a core feature set wired to the same backend, with permissions differing by group. Two deliberate exceptions: **pledges have no Committees tab** (the route doesn't exist, it isn't merely hidden), and **`/admin` has no Directory** — eboard uses User Management instead.

- **Dashboard** — upcoming events, recent announcements, recent photos, quick links
- **Calendar** — chapter events, including committee meetings, targeted to whoever's allowed to see them
- **Committees** — browse committees and member counts; join/leave any committee yourself; eboard creates committees and promotes/demotes chairs; a chair gets two scheduling buttons for their own committee — **New Meeting** (RSVP, private to invitees) and **Schedule Event** (calendar entry with optional QR attendance), see [Meetings](./meetings.md#meeting-or-event-the-committee-page-offers-both)
- **Polls** — vote on chapter/committee polls; eboard creates polls (single- or multi-choice, optional scheduled auto-close) and sees who voted for what — see [API: Polls](../api/endpoints.md#polls)
- **Files & Photos** — shared photo albums + the eboard-managed document library, now including external links alongside real files ([Photos & Documents](./photos-and-documents.md))
- **Messages** — direct messages and group chats, including auto-managed committee chats and the eboard chat ([Messaging](./messaging.md))
- **Directory** — browse members, view a profile, start a conversation, request a meeting. Available in `/member`, `/alumni`, and `/pledge` ([Profiles & Directory](./profiles-and-directory.md))
- **Meetings** — request time with a member or a group; they accept or decline, and it lands on both calendars ([Meetings](./meetings.md))
- **Calendar subscription** — put every event you can see into Apple/Google/Outlook, kept up to date automatically ([Calendar Subscription](./calendar-subscription.md))
- **Settings** — edit your own profile (including profile picture, UGA and personal email, and an About Me), subscribe your calendar, manage your blocked members list, delete your account ([Safety & Moderation](#safety--moderation))

`/admin` additionally gets **User Management** (`/admin/users` — real member data, plus eboard can change a member's group and set exec board titles from here), **Reports** (`/admin/reports` — the moderation queue, see below), **Homepage Photos** (the public chapter gallery), and **iOS Homepage Slideshow** (the in-app slideshow — a separate system from the website gallery). Announcement/event/poll creation, including audience targeting, lives at `/admin/announcements` and `/admin/polls`.

---

## Attendance

Events can opt into QR-code attendance tracking. The flow:

1. Whoever creates the event enables attendance on it.
2. Eboard or the event's creator opens the **Attendance** tab and displays the generated QR code.
3. Members scan it while signed in, landing on `/checkin/[eventId]/[token]`, which records them as present.
4. The organizer can view who checked in and manually correct anyone's status to present, excused, or absent.

The check-in window is the event's own start-to-end time plus a **30-minute grace period** — scanning outside it is rejected, as is a stale or wrong token.

Regular members have no attendance UI beyond the confirmation screen after a scan. The Attendance tab appears only for **chairs** (in `/member`) and **eboard** (in `/admin`). Alumni and pledges don't have it at all.

See [API: Attendance](../api/endpoints.md#attendance) for the endpoints.

---

## Public roster (`/members-list`)

A public "meet the chapter" page — no login required — showing eboard, committee chairs, active members, and alumni with their photos and titles.

It reads the separate public [`GET /roster`](../api/endpoints.md#roster-public) endpoint rather than the authenticated directory, and deliberately exposes far less: no email, phone, major, DOB, or pledge class.

Who does **not** appear:

- **Pledges** — initiated members only
- **Incomplete profiles**
- **Test accounts**
- **Anyone without a profile picture** — deliberate, to encourage members to upload one

That last rule surprises people. If a member asks why they aren't on the public roster, a missing profile picture is the first thing to check.

---

## Safety & Moderation

Added to support real content moderation and the iOS app's App Store review requirements (an app with messaging and user-uploaded photos needs reporting, blocking, and a way to delete your own account). See [API: Reports & Moderation](../api/endpoints.md#reports--moderation) and [API: Users — blocking](../api/endpoints.md#post-usersidblock) for the backend routes.

- **Report** — a Report button on member profiles, direct/group messages, and photos submits a reason + optional explanation to eboard's queue. The reporter isn't shown to anyone but eboard.
- **Block** — self-service from a member's profile or a DM's header. Stops that person from messaging you (either direction) and hides their messages from your own DM and group chat views — they stay a group chat member, just invisible to you specifically. Manage your full blocked list from Settings.
- **Moderation queue** (`/admin/reports`, eboard only) — Open/History tabs, resolve or dismiss each report with an optional note for the record.
- **Content filtering & rate limiting** — message sends are checked against a basic profanity filter and capped at 20/minute/user server-side; a rejected or throttled send surfaces as a real error message, not a silent failure.
- **Account deletion** (Settings → Danger Zone) — self-service, type "delete" to confirm. **Anonymizes rather than hard-deletes**: your personal info is cleared and you're signed out immediately, but your existing messages/photos/committee history stay in place for other members (shown as coming from a deleted user) rather than disappearing out from under a shared conversation or album. Doesn't touch your actual Authentik/chapter membership — that's still an eboard-owned, separate action.
- **Privacy Policy & Community Guidelines** (`/privacy`, `/community-guidelines`) — public pages, linked from the site footer and Settings. **Content is a draft pending real leadership/legal review** — written from the App Store submission checklist's own requirements, not yet signed off as final chapter policy.

---

## Committees

DB-only membership, not a new Authentik group per committee — see [API: Committees](../api/overview.md#committees--committee_members-tables) for why. One shared page (not a new portal), available in `/member`, `/admin`, and `/alumni`. **Pledges don't get it** — the `/pledge/committees` route doesn't exist.

- **Anyone**: browse committees and member counts, join or leave any committee themselves.
- **Eboard**: create/delete committees, promote or demote a member to **chair**.
- **A committee's chair** (and eboard, for any committee): two separate buttons — **New Meeting** creates a private RSVP request for the committee; **Schedule Event** creates a calendar entry for everyone in it, with QR attendance on by default. [Which one to use](./meetings.md#meeting-or-event-the-committee-page-offers-both).

Every committee automatically gets its own linked Group Chat (see [Messaging](./messaging.md#group-chats)) — joining/leaving the committee joins/leaves the chat too.

---

## Dark mode

Available across the app via `PortalThemeProvider`/`ThemeToggle` — most portal components have `dark:` Tailwind variants.

---

## Local development

```bash
npm install
npm run dev
```

Key environment variables (see `.env.example` for the full, annotated list):

- `AUTH_URL=http://localhost:3000` — must also be a registered redirect URI on the `ktpapp` Authentik provider, or SSO login fails locally
- `API_URL` — for local website dev, point at the **public** `https://api2.ugaktp.com` rather than the internal IP, unless you're also running ktp-api's own code locally
- `AUTH_SECRET` — generate your own (`openssl rand -base64 32`); never reuse the production value
- `AUTHENTIK_CLIENT_ID` / `AUTHENTIK_CLIENT_SECRET` — same values work locally and in production (same Authentik provider)

---

## Common gotcha: stale `.next` build cache

After heavy git operations (branch switches, merges, stashes), you may see errors like `Cannot find module './431.js'` or `invalid code lengths set` even though "Compiled successfully" printed first. This is stale/inconsistent `.next` output, not a real code problem:

```bash
rm -rf .next      # PowerShell: Remove-Item -Recurse -Force .next
npm run dev
```
