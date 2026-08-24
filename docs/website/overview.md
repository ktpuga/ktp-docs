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

`middleware.ts` enforces these boundaries — visiting a portal you don't belong to redirects you to your actual one. It also gates `/complete-profile` for anyone who hasn't finished onboarding yet.

Three of the four portals (`/member`, `/admin`, `/alumni`) share a common `PortalShell` component (sidebar nav, dark mode toggle, sign-out) — `/pledge` still uses its own hand-rolled layout, a known inconsistency, not a bug.

---

## Shared features across portals

All four portals get the same core feature set, wired to the same backend (only permissions differ by group):

- **Dashboard** — upcoming events, recent announcements, recent photos, quick links
- **Calendar** — chapter events, including committee meetings, targeted to whoever's allowed to see them
- **Committees** — browse committees and member counts; join/leave any committee yourself; eboard creates committees and promotes/demotes chairs; a chair can schedule a meeting scoped to their own committee (shows on the calendar, optionally with a Calendly link for RSVP/sign-up)
- **Files & Photos** — shared photo albums + the eboard-managed document library ([Photos & Documents](./photos-and-documents.md))
- **Messages** — direct messages and group chats, including auto-managed committee chats and the eboard chat ([Messaging](./messaging.md))
- **Directory** — browse members, view a profile, start a conversation, optionally book time via their personal Calendly link (`/member` and `/alumni` only — [Profiles & Directory](./profiles-and-directory.md))
- **Settings** — edit your own profile (including profile picture and personal Calendly link)

`/admin` additionally gets **User Management** (`/admin/users` — real member data, plus eboard can change a member's group directly from here) and **Homepage Photo management** (curating the public chapter gallery shown on the actual homepage). Announcement/event creation, including audience targeting, lives at `/admin/announcements`.

---

## Committees

DB-only membership, not a new Authentik group per committee — see [API: Committees](../api/overview.md#committees--committee_members-tables) for why. One shared page (not a new portal), added to all four portals:

- **Anyone**: browse committees and member counts, join or leave any committee themselves.
- **Eboard**: create/delete committees, promote or demote a member to **chair**.
- **A committee's chair**: schedule a meeting scoped to their own committee — shows on everyone's calendar who's in that committee, with an optional Calendly link for RSVP or slot booking.

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
