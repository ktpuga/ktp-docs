---
sidebar_position: 1
---

# Overview

The **member portal** (`uga-ktp-website`, [ugaktp.com](https://ugaktp.com)) is a Next.js 16 app (App Router, Turbopack, Tailwind, shadcn/ui) that serves both the public marketing site and the logged-in member portals. It talks to `ktp-api` for all data — see [API Overview](../api/overview.md) for the backend side of everything described here.

---

## Portals

Every member is routed to one portal based on their Authentik group (see [Auth & Onboarding](../authentik/overview.md)):

| Group | Portal |
|-------|--------|
| `eboard` | `/admin` |
| `chair`, `active`, `alumni` | `/member` |
| `pledge` | `/pledge` |
| `rush` | `/rushee` — see [Rush Portal](./rush-portal.md) |

`proxy.ts` enforces these boundaries — visiting a portal you don't belong to redirects you to your actual one. It also gates `/complete-profile` for anyone who hasn't finished onboarding yet. (This file was `middleware.ts` until the [Next.js 16 migration](./nextjs-16-migration.md) renamed it; the logic is unchanged.)

**All four portals** share the `PortalShell` component (grouped sidebar nav, dark mode toggle, profile card, sign-out). The earlier inconsistency where `/pledge` had its own hand-rolled layout is resolved.

:::note `/alumni` was deleted — alumni share `/member` (2026-08-05)
It was a copy of the member portal in amber. Every route wrapped the **same** shared component with a different `theme` prop and slightly different copy; the only structural difference was that it had no Attendance tab, which is chair-only anyway.

It bought nothing, because `ktp-api` never distinguished the two: `alumni` has always been in `SHARED_ALBUM_GROUPS`, so an alumnus could already reach everything `/member` renders. What the duplicate did buy was a second place for every portal bug to hide — and it did, repeatedly (see the `GROUP_ORDER` and `Promise.all` traps elsewhere in these docs).

`/alumni` and `/alumni/:path*` now redirect to the `/member` equivalent, for bookmarks and links in past emails. The redirects are **temporary (307), not permanent** — a 308 is cached by browsers indefinitely, so if an alumni-only portal is ever wanted back, everyone who followed one would keep landing on `/member` with no way to clear it.

Alumni are still labelled **Alumni** in the sidebar: `PortalShell`'s `GROUP_PRIORITY` resolves the badge from the user's group, not from which portal they're in.
:::

### Accent colors

The portals are one visual family rather than colour-coded ones: `/member`, `/pledge` and `/rushee` all render the same blue, and `/admin` is the only portal whose colour is a **user preference** — eboard picks red or blue from Settings, stored per-browser under the `ktp-admin-accent` key. The `amber` palette that `/alumni` used still exists in `PALETTES` and is simply unused.

Because Admin's colour is no longer fixed, it can't be a hardcoded constant. `PortalAccentProvider` (in `components/portal/PortalAccentContext.jsx`) publishes the resolved palette from `PortalShell`, and any component at any depth reads it with `useAccentPalette()`. Admin-only components — Analytics, User Management, Announcements, Rush Signup, Rush Announcements, Homepage Photos, iOS Slideshow, Moderation — all use the hook, so an Admin page follows the toggle rather than staying maroon.

Two things deliberately stay hardcoded and should not be converted: **member-group identity colours** (the maroon chip that means "eboard" in the directory, charts and group chats) and **destructive/danger styling**. Those carry meaning independent of which portal you're in.

:::note
`accent` used to double as the key into `PortalShell`'s `NAV_GROUPING` map, so it selected the sidebar contents *and* the home href as well as the colour — repointing it emptied the sidebar. That coupling is gone: each layout now owns its own grouped `nav` and passes `homeHref` explicitly, and `accent` means only "which palette". Palettes live in one place, `PALETTES` in `components/portal/PortalAccentContext.jsx`.
:::

---

## Shared features across portals

The portals share a core feature set wired to the same backend, with permissions differing by group. One deliberate exception: **pledges have no Committees tab** (the route doesn't exist, it isn't merely hidden).

- **Dashboard** — upcoming events, recent announcements, recent photos, quick links. The landing page of all four portals, `/admin` included since 2026-08-12
- **Calendar** — chapter events, including committee meetings, targeted to whoever's allowed to see them. An event can ask for an **RSVP**, answered from the Upcoming events list beside the calendar; the sidebar badges until you answer ([RSVP](../api/endpoints.md#rsvp))
- **Committees** — browse committees and member counts; **request** to join a committee (eboard or that committee's chair approves) and leave any you are on; eboard creates committees and promotes/demotes chairs; a chair gets two scheduling buttons for their own committee — **New Meeting** (RSVP, private to invitees) and **Schedule Event** (calendar entry with optional QR attendance), see [Meetings](./meetings.md#meeting-or-event-the-committee-page-offers-both)

:::warning Joining a committee is not cosmetic, which is why it needs approval
A committee membership row grants the committee **group chat with its history**, read access to **everything restricted to that committee** (albums, folders, documents, events, meetings, announcements, polls), and eligibility to **run interviews**, which exposes rushee names.

Until 2026-08-11 anyone could grant themselves all of that by clicking Join, and nobody could take it back. Now the button says **Request to Join**, the request grants nothing on its own, and eboard or that committee's chair approves it. Chairs and eboard can also remove a member, which was previously impossible.

A pending request is stored separately from membership on purpose — putting it in the members table with a status flag would have granted the access at the moment of asking.
:::
- **Polls** — vote on chapter/committee polls; eboard creates polls (single- or multi-choice, optional scheduled auto-close) and sees who voted for what — see [API: Polls](../api/endpoints.md#polls)
- **Files & Photos** — shared photo albums + the eboard-managed document library, now including external links alongside real files ([Photos & Documents](./photos-and-documents.md))
- **Messages** — direct messages and group chats, including auto-managed committee chats ([Messaging](./messaging.md))
- **Directory** — browse members, view a profile, start a conversation, request a meeting. One tab per member group (E-Board, Chairs, Members, Pledges, Alumni, and Rushees during rush). Available in `/member`, `/pledge` and, since 2026-08-11, `/admin` ([Profiles & Directory](./profiles-and-directory.md))
- **Meetings** — request time with a member or a group; they accept or decline, and it lands on both calendars ([Meetings](./meetings.md))
- **Calendar subscription** — put every event you can see into Apple/Google/Outlook, kept up to date automatically ([Calendar Subscription](./calendar-subscription.md))
- **Settings** — edit your own profile (including profile picture, UGA and personal email, and an About Me), subscribe your calendar, review your blocked members (only shown if you have any), delete your account ([Safety & Moderation](#safety--moderation))

`/admin` additionally gets **Analytics** (the second tab on `/admin` itself — chapter metrics), **User Management** (`/admin/users` — real member data, plus eboard can change a member's group and set exec board titles from here), **Oversight** (`/admin/oversight` — the moderation queue and the activity log, one tab each, see below), and **Homepage Media** (`/admin/homepage-media` — the public chapter gallery on a Website tab, the in-app slideshow on an iOS App tab; still two separate systems, now one page). Announcement and poll creation, including audience targeting, lives at `/admin/announcements` and `/admin/polls`. **Events are created and edited on the Calendar** — an **Add event** button in its header for eboard, and an edit pencil beside the delete button on each event card, gated by the same rule as delete (eboard, or the event's own creator). They lived on an Events tab of `/admin/announcements` until 2026-08-31; the calendar is where somebody already is when they notice a time is wrong.

Analytics was `/admin` itself until 2026-08-12 — eboard was the one group whose portal did not open on the Dashboard. It now does, on the same `PortalDashboard` the other three portals use, in whichever accent the red/blue toggle is set to. Analytics kept every feature and simply moved one route down.

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
- **Block** — self-service, and available anywhere Report is: **a small block control sits directly beside the report control** on a member's directory profile, on every direct/group message, and on every photo tile and lightbox. A DM's header keeps a full labelled Block button, since it has no report control to pair with. Stops that person from messaging you (either direction) and hides their messages from your own DM and group chat views — they stay a group chat member, just invisible to you specifically. Reviewing your blocked list lives in Settings, but **only appears once you've actually blocked someone**: a "View blocked members" button with a count, which opens a popup listing each blocked member with an Unblock button. Members who've never blocked anyone see nothing about blocking in Settings at all.
- **Moderation queue** (the Reports tab of `/admin/oversight`, eboard only) — Open/History tabs, resolve or dismiss each report with an optional note for the record.
- **Content filtering & rate limiting** — message sends are checked against a basic profanity filter and capped at 20/minute/user server-side; a rejected or throttled send surfaces as a real error message, not a silent failure.
- **Account deletion** (Settings → Danger Zone) — self-service, type "delete" to confirm. **Anonymizes rather than hard-deletes**: your personal info is cleared and you're signed out immediately, but your existing messages/photos/committee history stay in place for other members (shown as coming from a deleted user) rather than disappearing out from under a shared conversation or album. Doesn't touch your actual Authentik/chapter membership — that's still an eboard-owned, separate action.
- **Privacy Policy & Community Guidelines** (`/privacy`, `/community-guidelines`) — public pages, linked from the site footer and Settings. **Content is a draft pending real leadership/legal review** — written from the App Store submission checklist's own requirements, not yet signed off as final chapter policy.

---

## Committees

DB-only membership, not a new Authentik group per committee — see [API: Committees](../api/overview.md#committees--committee_members-tables) for why. One shared page (not a new portal), available in `/member` and `/admin`. **Pledges don't get it** — the `/pledge/committees` route doesn't exist.

- **Anyone**: browse committees and member counts, join or leave any committee themselves.
- **Eboard**: create/delete committees, promote or demote a member to **chair**.
- **A committee's chair** (and eboard, for any committee): two separate buttons — **New Meeting** creates a private RSVP request for the committee; **Schedule Event** creates a calendar entry for everyone in it, with QR attendance on by default. [Which one to use](./meetings.md#meeting-or-event-the-committee-page-offers-both).

Every committee automatically gets its own linked Group Chat (see [Messaging](./messaging.md#group-chats)) — joining/leaving the committee joins/leaves the chat too.

---

## Dark mode

Available across the app via `PortalThemeProvider`/`ThemeToggle` — most portal components have `dark:` Tailwind variants.

---

## Loading skeletons

Added 2026-08-12 (PR #42). The dashboard shows shaped placeholders while its four API calls are in flight instead of the "Loading..." text it used to.

There are **two mechanisms**, and they are not interchangeable:

- **`auto-skeleton-react`** — a dependency, used in exactly one file, `components/portal/PortalDashboard.jsx`. Wrap a block in `<AutoSkeleton loading={loading}>` and it derives the placeholder from the real markup, so the skeleton cannot drift from the layout it stands in for. Mark a child `data-no-skeleton` to leave it out (used for the hover-only accent bar on the stat cards, which has nothing to stand in for).
- **Hand-rolled `animate-pulse` spans** — used for the sidebar's user block in `PortalShell.jsx` and for the name in the dashboard hero, where the placeholder is a single line of text and pulling in the wrapper would be more machinery than the job needs.

:::note PR #42's `PortalShell.jsx` diff looks enormous and is almost entirely reformatting
586 changed lines, of which the only behavioural change is two `animate-pulse` spans. The rest is one long `RevampedNavItem` signature reflowed across multiple lines. Don't go looking for a rewrite that isn't there.
:::

---

## Local development

```bash
npm install --legacy-peer-deps
npm run dev
```

`--legacy-peer-deps` is required, not optional. A bare `npm install` fails outright with `ERESOLVE` — `lucide-react@0.344.0` declares a peer of React 16/17/18 and this app is on React 19. See [Next.js 16 migration](./nextjs-16-migration.md#if-you-need-to-roll-back) for the full story, including why production is unaffected.

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
