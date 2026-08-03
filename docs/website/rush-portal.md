---
sidebar_position: 6
---

# Rush Portal

The fifth portal, for prospective members during rush. Lives at **`/rushee`**.

:::danger Not `/rush`
`/rush` is the **public** rush marketing page — countdown timer, FAQ, schedule — linked from the homepage, code-of-conduct and members-list. Putting a portal `layout.jsx` there wraps that public page in the authenticated shell and breaks it for anyone not signed in.

The portal is `/rushee`. The middleware matcher covers `/rushee` and deliberately **not** `/rush`.
:::

## Why it exists

Rush is the one workflow Discord and GroupMe genuinely handle badly: 50+ people who aren't in the chapter server, no way to track who attended what, and bid decisions made from memory. Rushees get accounts, see what's announced, RSVP to events, check in by QR and vote in polls — without seeing anything internal.

## What rushees can and can't reach

`ktp-api/constants.js` exports two lists:

| Constant | Groups | Gates |
|---|---|---|
| `SHARED_ALBUM_GROUPS` | active, chair, alumni, eboard, pledge | Photos, documents, albums, committees, **member directory** |
| `RUSH_ACCESSIBLE_GROUPS` | the above **+ `rush`** | Announcements, polls, messages, reports |

:::tip Rush fails closed by default
`rush` is deliberately **absent** from `SHARED_ALBUM_GROUPS`. Anything gated on it is closed to rushees automatically — opening something to rush requires deliberately using the wider constant. That direction matters because rush accounts are created by strangers, not issued by eboard.
:::

Reports is open to rush on purpose: they can receive DMs, so they must be able to report harassment.

## Three things this changed elsewhere

### The member directory got a gate

`routes/members.js` previously had **only `requireAuth`**. That was safe when every account was invitation-created — there was no such thing as an authenticated stranger. Self-signup breaks that assumption, so it's now gated to `SHARED_ALBUM_GROUPS`. Without it, anyone who signed up could pull the chapter's names, emails and phone numbers.

### Rushees message leadership only

`GET /members/leadership` returns eboard + chairs with a reduced field set (no email, phone, major or pledge class). It's the only people-listing a rushee can reach, and it's what their Messages tab offers as recipients.

The restriction is enforced **server-side** in `messagesController.sendMessage` — `recipient_id` is just a value in a request body, so hiding the directory shapes what the app offers but doesn't stop anyone holding an id.

### Untargeted content is hidden from rush

Opening announcements/polls/events to rushees meant `audience IS NULL` — "All Members" — would have exposed **every untargeted post ever made**. The untargeted branch in `announcementModel`, `eventModel` and `pollModel` now also requires the viewer to hold a member group.

It tests for *holding a member group* rather than *not being rush*, so someone accepted into a pledge class who still carries the `rush` group keeps full access.

## Rush announcements are a separate table

`rush_announcements`, not an audience value on `announcements`.

Audience targeting means every internal announcement is one mis-ticked checkbox away from reaching people who aren't in the chapter. A separate table makes that structurally impossible — the two share no rows.

Reads are open to rush **and** members, so leadership can review what rushees were told without signing in as one. Writes are eboard + chair.

:::note Why events were NOT separated
`event_attendance.event_id` has a foreign key to `events(id)`, and the whole check-in chain — attendance token, the 30-minute grace window, QR generation, push targeting — keys off it. A `rush_events` table would mean duplicating the attendance system. Events use audience targeting instead.
:::

## Signup

See [Rush Signup](./rush-signup.md).

## Rushees in the member directory

Rushees get their own section in the directory, visible to **eboard, chair and active only**. Alumni and pledges have no role in rush, so they don't see the section — and because `memberModel.findAll` filters in SQL on a flag derived from the *caller's* group, those rows never reach their browser at all. `findById` applies the same rule and returns 404 rather than 403, since whether an id belongs to a rushee is itself the thing being withheld.

Rushees expose the same contact details as members — eboard needs to reach them about interviews and bids, which is the point of having them listed at all. The asymmetry is the other way round: `GET /members/leadership` gives *rushees* a deliberately narrower view of members, since they signed up through a public QR code and haven't joined anything yet.

**`users.about_me`** (migration `1785800000000`) is a free-text self-introduction shown in the directory and edited in Settings. It exists mostly for this section: a rushee has no pledge class, graduation date or exec title, so without it their card is a name and a major. The column is on every user rather than gated to rush, because there is nothing rush-specific about the data and a rush-only column would need migrating the day a rushee becomes a pledge. Capped at 600 characters in `userController.updateProfile`, which **truncates rather than rejects** — losing the tail of a bio beats throwing away someone's whole profile save.

:::warning GROUP_ORDER must match roleGroups.js
Before this section existed, `MemberDirectory`'s grouping did `GROUP_ORDER.includes(m.memberGroup) ? m.memberGroup : 'active'` — and `GROUP_ORDER` had no `rush`. Since `findAll` had no group filter either, **every rushee who completed their profile was already appearing in the directory, silently bucketed into Active members** while carrying a "Rushee" badge. Any new role added to `constants/roleGroups.js` must be added to `GROUP_ORDER` too, or it lands in Active and is mislabelled rather than erroring.
:::

## The public "How Rush Works" page

`/rush/how-it-works` explains the process to people who don't have an account yet. It's **public** — `/rush*` is deliberately excluded from the middleware matcher, and only `/rushee` (the portal) is gated. It shares the visual language of `/rush` so the two read as one site.

The four steps live in `RUSH_STEPS` in `app/rush/rush-content.js`, separated from the page layout so the copy can be reworded each semester without touching JSX:

1. **Make an account** — button on the page or the QR code at an info session, then sign in to the portal
2. **Come to events and talk to members** — attendance is scanned at each event
3. **Sign up for interviews** — towards the end of rush
4. **Check back for an update** — bids arrive as a direct message plus a push notification

The page fetches `getPublicRushSignup()` on mount. When signup is open it shows the signup button; when it's closed it says so plainly and points at `/rush` and Instagram, rather than rendering a dead button. That call never rejects — it resolves to `is_open: false` on any failure, so a backend hiccup hides the button instead of breaking a public page.

:::warning Two things the copy must not promise
Step 3 says interview signup details are **announced in the portal**. There is no interview-signup feature — writing it as a link would promise something that doesn't exist. Likewise step 4 is worded as an update you'll see, not an automated bid notification: bids are sent by leadership as a direct message, and there is no separate bid system.
:::

## Targeting rushees: the thing that catches people out

**An event or announcement with no audience set is invisible to rushees.** The untargeted branch of the visibility query requires the caller to hold a member group, so "no audience" means *all members*, not *everybody*. Rush only ever sees what is deliberately targeted at it.

This is correct and deliberate (otherwise opening the route to rushees would retroactively expose every internal post ever made), but it means **eboard must tick `Rushee` in the audience picker for anything rushees should see.** The picker used to label the untargeted state "Visible to everyone", which reliably produced rush events no rushee could open; it now says "Visible to all members. Rushees will not see this unless you tick Rushee."

:::warning Push recipients must mirror visibility
`eventModel.findRecipientIds` originally matched **every** user for an untargeted event, while `findAllForUser` hid that same event from rushees. The result: a rushee got a push reading "New chapter event: *(internal event title)*" and tapped through to a calendar that did not contain it, leaking internal titles to prospective members. The untargeted branch now requires a member group, exactly like the visibility query.

The invariant to preserve: **never notify someone about something they cannot open.** Any new notification path needs the same check.
:::

Testing the scalar `users.member_group` is safe in the push query even though `findAllForUser` deliberately tests the token-groups array instead. The array case has to handle someone holding both `rush` and `pledge` (Authentik keeps the old group until it is removed manually); the column holds exactly one value, and the only rows with a `NULL` member_group are soft-deleted ones, which `deleted_at IS NULL` already excludes.

## Portal notes

- Accent renders the same blue as Member; only Alumni keeps its own colour, and Admin is a per-user red/blue toggle
- `RushDashboard` is its own component — `PortalDashboard` fetches members and photos in a `Promise.all`, both closed to rush, so the first 403 would reject the batch and error the page
- **The `Promise.all` trap recurs.** `PollsPage` fetched `getPolls()` and `getCommittees()` in one `Promise.all`; `/api/committees` is gated on `SHARED_ALBUM_GROUPS`, so for a rushee that 403 discarded the polls too and the tab rendered permanently empty with no error. Any fan-out that mixes a rush-accessible endpoint with a member-only one must isolate the failure (`.catch(() => [])` per call, or `Promise.allSettled`). Grep for `Promise.all` before adding a tab to this portal
- **No Attendance tab.** `AttendancePage` lists events you can *manage*, so it renders empty for a rushee. Check-in is the QR code, which opens `/checkin/[eventId]/[token]` outside the portal
