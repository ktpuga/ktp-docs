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
| `chair`, `active` | `/member` |
| `alumni` | `/alumni` — restored 2026-09-02, see below |
| `pledge` | `/pledge` |
| `rush` | `/rushee` — see [Rush Portal](./rush-portal.md) |

Order matters, and `alumni` is checked **after** `chair`/`active`: Authentik does not remove the old group when someone graduates, so an alumnus still marked active holds both and the more capable portal has to win.

`proxy.ts` enforces these boundaries — visiting a portal you don't belong to redirects you to your actual one. It also gates `/complete-profile` for anyone who hasn't finished onboarding yet. (This file was `middleware.ts` until the [Next.js 16 migration](./nextjs-16-migration.md) renamed it; the logic is unchanged.)

### Portal preview: eboard viewing a portal as a member

**Admin → Settings → View a portal as a member.** Eboard picks a group and lands in that portal seeing exactly what it sees — the same announcements, events, polls and documents, filtered to that audience.

It works by **becoming** the group's QA account, not by simulating one. Those accounts already existed: migration `1784600000000` created one per `member_group` for the team to verify permissions with, and they are already hidden from the directory and the member-count stat. The website sends `X-View-As: <authentik_id>` and `ktp-api` swaps `req.user` for that account.

:::tip Why impersonation rather than a "preview mode"
Roughly thirty call sites filter on `req.user.groups`, and more read `req.user.authentik_id` for committee membership, RSVP state and audience overlap. A parallel "what would a pledge see" implementation would have to mirror all of it — and it would drift, which is exactly how the duplicated portals grew their `GROUP_ORDER` and `Promise.all` bugs.

Becoming the account means every existing rule applies without being restated, so **the preview cannot disagree with the real thing**.
:::

:::danger `/events` forgot to honour it, and the calendar leaked
`applyViewAs` originally lived only inside `requireAuth`, under a comment saying every router mounts that "so a new route cannot forget to honour preview mode." **`GET /events` and `GET /events/:id` use `optionalAuth`** — they are the only two routes in the API that do — so they never ran it.

The consequence was specific and bad: `eventsController.getEvents` branches on `groups.includes("eboard")` to skip audience filtering entirely. During a preview `req.user` was still the real eboard caller, so **the calendar listed every event in the chapter, including ones deliberately hidden from rushees**, inside a portal whose announcements, polls and documents were all correctly filtered.

Not an escalation — eboard can read all of it anyway. But a preview exists to show what somebody else sees, and it was showing something nobody else sees. `applyViewAs` now runs in both middlewares, and `test/portalPreview.test.js` asserts it for each.

An **anonymous** caller who sends `X-View-As` on an `optionalAuth` route stays anonymous rather than getting a 403 — that route's contract is that it never rejects, and ignoring the header is also the least-privileged reading. An authenticated non-eboard caller still gets the 403.
:::

Four gates, all server-side in `middleware/auth.js`, and the UI is not one of them:

| # | Gate |
|---|---|
| 1 | A verified token — this runs after `verifyToken` |
| 2 | The **real** caller must be `eboard` |
| 3 | The target must have `is_test_account = true`, **checked in SQL** |
| 4 | The request must be a `GET` or `HEAD` |

:::danger Read-only is not about escalation
Previewing only ever **narrows** access — eboard viewing as a pledge can reach strictly less than eboard. The reason writes are refused is **attribution**: without it, eboard could post an announcement, send a message or RSVP while wearing the QA account, and the audit trail would name the wrong actor. A preview that can write is not a preview.

`req.realUser` keeps the genuine eboard identity for anything that needs to know who is actually there.
:::

Gate 3 is the one worth reading twice: the allowlist is a SQL predicate, not an id comparison in JavaScript, so **there is no request shape that aims the preview at a real member**. A real member's id and a nonexistent id return the *same* 404, so this cannot be used to probe whether a given `authentik_id` exists. `test/portalPreview.test.js` asserts all four gates.

Leaving preview is client-side — the cookie is deleted and that is all. That is the advantage over signing in as the QA account directly: leaving cannot strand anyone, and closing the browser leaves preview on its own.

:::warning The cookie grants nothing, and the banner is load-bearing
`ktp_view_as` names a target; it is not a credential. `ktp-api` re-checks the caller's own token on every request, so a forged or stale cookie yields a 403 or 404 rather than access. `proxy.ts` honours it only when the session is already `eboard`.

The banner is mounted at the **root layout**, not inside the portal layouts, so it follows you onto every page until you exit. This codebase has twice shipped bugs where two sessions coexisted in one browser and quietly disagreed, and both were invisible while happening. A preview that looks identical to the real portal is the same failure waiting: glance at an empty announcements list, conclude the chapter has none, and you were looking at a pledge's view without knowing.
:::

#### The browser has to render as the previewed account too

Swapping `req.user` fixes what the API *returns*. It does nothing about what the client decides to *draw*, and every portal control was gated on the next-auth session — which still said eboard. So a preview showed correctly filtered member data underneath **eboard's toolbar**: Create Event, the edit and delete pencils, Create Committee, the document-management tiers, bulk invite, the directory's leadership actions.

`lib/use-portal-viewer.js` is the seam. `usePortalViewer()` returns `{ groups, authentik_id, isPreview }` — the signed-in values normally, and the previewed account's while a preview is running. Every component that gates on a group or on "is this mine" reads from it instead of `useSession`.

The previewed group rides in a third cookie (`ktp_view_as_group`, raw slug) so the hook needs no round trip, and is expanded through the same chair-implies-active rule the API applies. Like the other two cookies it **grants nothing** — it decides what to render, never what is allowed, and ktp-api re-checks the real caller's token on every request.

The sidebar profile card is part of this: it used to fall back to `session.user` for the name, initials and group, so a preview showed the *previewing eboard member's* identity at the bottom of somebody else's portal. It now takes the identity from the fetched profile (which already arrives through `X-View-As`) and refuses the session fallback entirely while previewing.

:::warning One frame of the real session, accepted deliberately
The cookie is read in an effect, so the first paint uses the signed-in groups and an admin control can flicker once before disappearing. Reading it during render would mismatch the server-rendered HTML and break hydration; reading it in the layout would opt the public marketing pages out of static rendering — the regression `PreviewBanner` already documents. A one-frame flash of a button that cannot write is the cheapest of the three.
:::

#### Everything is clickable; only writes are inert

`PreviewGuard`, mounted in the root layout, used to swallow **every** button click. That did stop writes, but it also stopped tabs, modals, expanders and the calendar's month arrows — controls that issue no request at all and only move client state. Half of what a preview exists to show lives behind one of those, so the feature read as broken.

The rule is now inverted: **everything runs by default, and only controls that actually write are swallowed.** Those carry `data-preview-block`. Two additions matter:

- **Form submits are swallowed whether marked or not** — a form is unambiguously a write. `[data-preview-allow]` is the exception, and it is what keeps the banner's own Exit form working.
- **`change` is intercepted as well as `click`.** A `<select>` never fires a click on its option, so the attendance status dropdown reached the API *even under the old block-everything rule*.

A blocked interaction raises a toast — *"Preview only. Nothing was saved."* — rather than silently doing nothing. A control that does nothing reads as a bug, which is precisely the report that produced this rewrite.

:::tip Why a missed marker is safe
Gate 4 has not moved. `ktp-api` still refuses any non-`GET`/`HEAD` request in preview, so an unmarked control **cannot write**. It gets a 403, which crosses the Server Action boundary and surfaces as React's #441 digest — ugly, and worth fixing when spotted, but a **visible** failure.

That asymmetry is the entire reason the rule is "block the marked ones" and not "allow the marked ones": a mistake in this direction is annoying, and a mistake in the other direction is invisible.

The markers were placed from the **call graph**, not by eye: every exported `lib/portal-api.js` function that can reach a write (following delegation through `sendEventPayload`, `sendMultipart`, `adminMutate` and `interviewDelete`), then every `onClick`/`onChange`/`onSubmit` whose expression reaches one — including handlers passed down as props into child components.
:::

:::warning View receipts are dropped, not refused
`markConversationRead`, `markGroupChatRead`, `markCommitteeSeen` and the notification `seen` writes fire from an **effect**, not a click, so no click guard can swallow them — and they would 403 mid-render. `apiRequest` drops those four paths outright while a preview target is set.

That is the correct behaviour rather than a workaround: eboard reading a QA account's inbox must not mark that account's messages as read, or the preview quietly changes the thing it is supposed to be observing.
:::

**All four portals** share the `PortalShell` component (grouped sidebar nav, dark mode toggle, profile card, sign-out). The earlier inconsistency where `/pledge` had its own hand-rolled layout is resolved.

:::warning `/alumni` came BACK on 2026-09-02. The note below is history.
It is deliberately **not** the clone described below: no Committees, Meetings, Polls, Tickets or Calendar, because those are things a graduated member does not take part in. Six entries across two sections plus Account, in amber.

The deletion still earned its keep in one specific way. The `/alumni → /member` redirects were written `permanent: false` **precisely so this day would be cheap** — a 308 is cached by browsers indefinitely and would have stranded anyone who had followed one. Restoring the portal was therefore a deletion of two lines rather than a support thread. ⚠ And those redirects **had** to go: a redirect shadows a real route, so leaving them would have sent every `/alumni` request to `/member` and none of the new pages would ever have rendered.

If it ever drifts back into mirroring `/member` entry for entry, delete it again and route alumni to `/member` — that trade was correct the first time.
:::

:::note Why it was deleted in 2026-08 (historical)
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

The check-in window opens **30 minutes before the event starts** and closes **30 minutes after it ends** — scanning outside it is rejected, as is a stale or wrong code. It opens early because people queue before an event begins.

The QR itself carries a code that **rotates every 10 seconds**, so photographing the board is worthless; the server accepts the current period and the one before it, giving a scan 10–20 seconds to land.

### Scanning while signed out

Attendance is recorded against an account, so a scan by someone not signed in cannot count. That page now sends them to `/login?next=/checkin/…` and **brings them back to the check-in page afterwards** — previously the Sign in link dropped the destination and left them on their portal home, with nothing to suggest the check-in had not happened.

:::note They still scan once more, and that is not a bug
An Authentik round-trip takes longer than the code lives, so by the time they return the code in the URL has rotated. The returning page says so and points at the live code; the second scan is instant because they are signed in by then.

One scan end-to-end would mean the server capturing the scan *before* login — validating the code while fresh and holding it in a short-lived cookie to be claimed afterwards. That is a real bearer credential with a lifetime, and it was judged not worth introducing for a case that only affects people whose session has lapsed.
:::

:::danger `next` is an allowlist, never a sanitiser
`lib/next-path.js` matches the one URL shape this feature needs (`/checkin/<id>/<code>`) and returns null for everything else, falling back to normal portal routing.

A post-login redirect target is a textbook open-redirect hole: `/login?next=https://evil.example/login` would produce a convincing phishing page that the chapter's own domain sent you to, moments after a genuine sign-in. Denylisting `//`, `\\` and `://` is the usual approach and it leaks, because browsers disagree about what counts as a scheme. **Widening this means adding a pattern with a reason, not loosening the regex.**
:::

### Filtering the roster, and the CSV

The roster is **grouped by status** — present, excused, not marked, absent — alphabetical within each group, ordered in SQL so every client agrees. Rows therefore move as people scan themselves in, because the pane re-polls every few seconds.

Above the counts is a row of **group pills**, multi-select, showing only the groups actually on that roster: an event targeted at pledges never offers an Alumni pill, since filtering to zero reads as "no alumni came" rather than "no alumni were invited". Filtering runs in the browser over the roster already fetched, so it costs no request.

**Export CSV** downloads the roster as `Name, Group, Status, Checked In, Recorded`. `Recorded` is `Self (QR)`, `Manual`, or blank for a row nobody has touched — three distinguishable values, because a "Marked By" column would be blank both for a manual mark (the API returns `marked_by` as a bare id, with no name to print) and for an unmarked row, which is the one distinction the column exists to make.

Names come from the **frozen** `display_name`, so a member whose account was later deleted still exports under the name that was on the roster rather than a blank cell.

:::warning A filtered roster's counts describe the filter, not the event
Turn a pill on and every number in the counts row — including **"N expected"** — describes only the selected groups. The export does the same, and names the groups in its filename.

That is deliberate ("how many pledges missed this" is the question worth asking), and it is also the one way this feature does damage: `12 expected` copied into meeting minutes as the event's turnout. So whenever a filter is on, the pane states the filter and the full roster size directly beneath the counts, and the export filename carries the groups. **Do not remove either.** They are what make the narrowed numbers safe to read.
:::

The filter is **cleared when you switch events**. Carried across, it would silently hide people on the next roster, and a pill for a group nobody on it belongs to is not rendered at all — so nothing on screen would reveal that a filter was still on.

`member_group` on each row is the value **frozen when the roster was materialised**, not a live lookup. Filtering a spring event to Pledges therefore shows who was a pledge *that night*, not who is still one now the class has been initiated.

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
