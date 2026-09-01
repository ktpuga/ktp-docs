---
sidebar_position: 6
---

# Rush Portal

The fifth portal, for prospective members during rush. Lives at **`/rushee`**.

:::danger Not `/rush`
`/rush` is the **public** rush marketing page — countdown timer, FAQ, schedule — linked from the homepage, code-of-conduct and members-list. Putting a portal `layout.jsx` there wraps that public page in the authenticated shell and breaks it for anyone not signed in.

The portal is `/rushee`. The `proxy.ts` matcher covers `/rushee` and deliberately **not** `/rush`.
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

The poll create modal offers a **Rushees** pill, but `rush` is deliberately **not** in its `DEFAULT_AUDIENCE`. Reaching rushees therefore takes a deliberate tick, never a default — which is the UI half of the server rule above. (Contrast [albums and folders](./photos-and-documents.md), where the Rushee pill is *removed entirely*: rushees can never see photos or documents at all, so offering it there produced a dead Create button.)

:::warning Declare `ROLES` at module scope, not in the component body
Fixed 2026-08-12. `PollsPage`'s `ROLES` array was declared inside the component, below code that read it, which put it in a temporal dead zone — the create modal threw `Cannot access 'ROLES' before initialization` on render. It is static data with no dependency on props or state, so it belongs at module scope where hoisting order cannot bite.
:::

## The interest form

The chapter collected an interest form in Google Forms for years. It is now twelve questions on the **rushee's own profile builder** (`/rushee/settings`, and `/complete-profile` on first sign-in), so the answers hang off the account rather than living in a sheet nobody can link back to a person.

Nine of the twelve already had columns. Three did not, and were added in migration `1788700000000`:

| Column | Type | Question |
|---|---|---|
| `users.minors` | `TEXT` | "Minor(s) and Certificates?" |
| `users.gpa` | `NUMERIC(3,2)` | "GPA" |
| `users.heard_from` | `TEXT` | "How did you hear about KTP?" |

"Your Major(s)" reuses `users.major` unchanged — the form has always collected it as prose ("Computer Science and Finance"), and a plural array would mean rewriting every directory card, the public roster and the decision-night slide to render a list where they render a string, for no answer the existing box cannot hold. Only the label changed.

**"Timestamp" is `created_at`, not a question.** Google Forms stamps a submission; here the row already exists.

### The fields are rushee-only on the form and universal in the column

Same arrangement as `about_me` and `doing_now`: the columns are on every `users` row, the API validates them for every caller, and only `ProfileForm` decides who sees the inputs. A column gated to one group would need migrating the day somebody changes group, which at this chapter happens every spring.

:::danger Do not render these inputs for everyone "so the payload is consistent"
`buildProfilePayload` keys off `formData.has('gpa')` and **omits all three keys** when the inputs are absent, which tells `PUT /users/me/profile` to leave the stored values alone. That is the same `has`-not-`get` trick the UGA email field uses, and here it prevents real data loss: the day a rushee is given a pledge class the form stops rendering these fields, and without the omission their next unrelated profile save would write three nulls over the answers the pledge committee selected them on.

`AdminEditProfileModal` is the exact opposite and for the opposite reason — `PUT /admin/users/:id/profile` is a whole-row `UPDATE` that does not honour absent keys, so that modal must render all three for **everyone**. The two forms disagree on purpose.
:::

### GPA is a string in JSON

`NUMERIC` comes back from node-postgres as text, so `gpa` is `"3.75"` everywhere, never `3.75`. The validator returns a string on the way in too so the read and the write agree. A third decimal place is rejected rather than rounded, because Postgres silently stores `3.756` as `3.76`. The ceiling is **5**, not 4 — a first-semester rushee answers with a weighted secondary-school GPA.

## Resumes

A rushee uploads their own resume from `/rushee/settings`, in a card of its own beneath the interest form. The pledge committee and eboard read it from the per-rushee profile, where **View resume** opens it in a pop-up rather than a new tab.

**PDF and Word are both accepted, and they do not behave the same way on the way back out.** A browser can render a PDF inline, so it appears inside the modal; no browser can render `.doc` or `.docx`, so those are sent as a download and the modal says so instead of showing an empty frame. That was a deliberate trade: taking resumes in the format people actually have, at the cost of one file type that cannot be previewed.

| | |
|---|---|
| Upload / replace / remove | `PUT` and `DELETE /resumes/me` |
| Read | `GET /resumes/:id` — the rushee themselves, eboard, or the pledge committee |
| Limit | **10 MB**, the smallest cap of any upload here |
| Storage | ktp-api's own disk, `uploads/resumes` |

### Four columns on `users`, not a table

A person has exactly one resume, the same shape `minors`, `gpa` and `heard_from` already take. `resume_path` is the random on-disk name and `resume_filename` is what the rushee called it — the first finds the bytes, the second names the download, and **`resume_path` is deliberately absent from every client-facing projection**. Only the streaming handler reads it.

:::warning Deleting the row is only half of deleting a resume
A resume is the single most identifying document this system stores: name, phone, email and history in one file. Nulling the columns forgets **where** the file is without removing it, which leaves the bytes on disk and permanently unreachable.

So every path that clears the columns — `setResume` replacing an old file, `clearResume`, and `anonymize` on account deletion — returns the previous path so the caller can unlink it. Each does that with a `WITH previous AS (...)` CTE, because a plain `RETURNING` hands back the `NULL` that was just written, which is exactly the value that cannot find the file.
:::

### Why uploading is not gated on being a rushee

Anyone signed in may upload their own resume; only the rushee profile puts a button in front of one. Gating the write on the rush group would take the ability away at a moment nobody controls — someone accepted into a pledge class **keeps** the rush group in Authentik until an admin removes it, and loses it on an unrelated admin's schedule, partway through rush.

The card on the settings page is keyed on `member_group === 'rush'` rather than on the session groups that `ProfileForm`'s own `isRushee` uses. The two answer different questions: `ProfileForm` asks whether to show the rushee version of the form, this asks whether the pledge committee will be able to open the file — and that is decided by `userModel.findRusheeById`, which filters on `member_group = 'rush'`.

### These bytes come from outside the chapter

A rushee is not yet a member, and the website proxies their upload back under **its own origin**. Two headers are set by ktp-api and forwarded by `app/api/resumes/[id]/route.js`:

- `X-Content-Type-Options: nosniff` — stops a browser second-guessing the declared type
- `Content-Security-Policy: sandbox` — makes the document inert, which matters because a PDF can carry its own scripting

The stored `resume_mime` is handed straight to a `Content-Type` header, so a `CHECK` constraint restricts it to the three accepted values as well as the uploader's `fileFilter`. Dropping either header in the proxy would undo the protection in the one place it matters most.


## Rushee Data: the table that replaced the response sheet

One component, `components/rush/RushInterestTable.jsx`, rendered by two thin pages:

| Route | Audience |
|---|---|
| `/admin/rushees` (Rushee Data tab) | Eboard |
| `/member/rush-data` (Rushee Data tab) | The pledge committee |

Both routes now carry a **Presentation** tab beside the table (see [Decision night](./interviews.md#the-presentation-write-up)), and a **per-rushee profile** at `/admin/rushees/[id]` and `/member/rush-data/[id]` — same two-routes-one-component shape, reached by clicking any row of the table.

### Events attended

The profile carries an **Events attended** card, directly under the interview because it answers the same question in the same breath: did this person actually show up. Both are things the chapter observed, unlike the interest form and the resume below them, which are what the rushee said about themselves.

It lists only events the rushee was marked **present** at, oldest first. Excused, absent and never-marked rows exist in `event_attendance` and are deliberately not shown — see [`GET /rush-data/:id`](../api/endpoints.md#get-rush-dataid).

:::warning An empty list does not mean they came to nothing
A rushee only lands on an attendance roster for an event whose audience includes `rush`, and somebody still has to take attendance. So an empty card can equally mean **no officer ever opened the roster**.

The empty state says exactly that, in those words, rather than showing a bare "none". On decision night a blank attendance panel is read as evidence about the rushee, and it is the one place where the system's own gap looks identical to the candidate's.
:::

**Two routes rather than one, because no single route can serve both.** `proxy.ts` hard-gates `/admin` to the `eboard` group, and it redirects an eboard-only account *away* from `/member`. It also cannot help here at all: the rule involves committee membership, which lives in Postgres and deliberately never in the JWT, so the proxy has nothing to check.

**Neither route is the access boundary.** Any member of the member portal can type `/member/rush-data`; the API answers `403` and the component renders the refusal. The nav entry is hidden by `useRushDataAccess`, which asks `GET /rush-data/access` — the same shape as the Interviews tab, so an entry cannot appear for someone the endpoint would then refuse.

### How the pledge committee gets in

`committees.slug = 'pledge'`, a switch eboard flips from the committee's own detail page (**"This is the pledge committee"**).

A stable machine name rather than a name match: committees are free-form rows, so "the pledge committee" is not something the schema knows, and `name LIKE '%pledge%'` would make the access rule a substring — renaming it to "New Member Education" would silently lock everyone out, and a second committee with "pledge" in its name would silently let them in.

The switch is **eboard-only, not the chair of that committee** — a chair who could set it on their own committee would be granting themselves the GPAs and the interview notes it gates. `slug` rides on every committee shape so the card badges it for all members: an access grant nobody can see is one nobody audits.

**At most one committee holds it**, enforced by a partial unique index. Turning it on somewhere else **moves** it, so the control says so out loud before you click.

When no committee is marked, eboard sees a **"No pledge committee is set"** banner on the committees list. That is not decoration: until one is marked, every rush surface is eboard-only and the pledge committee is locked out with nothing anywhere explaining why — which somebody would otherwise debug as a broken permission.

:::info This replaced `can_view_rush_data`
Migration `1789000000000`. The old flag was **not broken** and this is not a repair — eboard had set it on the Pledge committee and it was answering correctly. What changed is that four surfaces now ask the same question (the table, the rushee profile, the write-up and interview signup), and a column named `can_view_rush_data` can only honestly gate the first. One identity beats four booleans that can disagree about who the pledge committee is.

The column still exists and is dead; dropping it is a second migration. The website's old toggle called `PUT /committees/:id/rush-data-access`, which the API had already deleted — so every click `404`ed silently until the control was replaced.
:::

### The export

An **Export CSV** button, built in the browser from data the page already fetched. Google Sheets imports it with File > Import; Excel opens it on double-click.

It exports **what is on screen, filter included** — the search box is how somebody narrows to the people they are working on, and an export that ignored it would hand over the whole cohort under a filename saying otherwise.

`lib/csv.js` is shared and handles three things that are easy to get wrong:

- **A UTF-8 BOM.** Excel does not detect UTF-8 in a `.csv` and falls back to the system codepage, so without it every accented name opens mangled — and a name is exactly what nobody re-checks before mailing the sheet around.
- **Formula injection.** A cell beginning `=`, `+`, `-`, `@` or a control character is executed on open by both Sheets and Excel. These values are typed by people outside the chapter into a sheet eboard opens, so `=IMPORTXML(...)` in a "how did you hear about KTP" box is a real exfiltration path. Each is prefixed with a single quote, which neither program displays. **The check runs before quoting** — wrapping in double quotes does not disarm a formula.
- **CRLF and RFC 4180 quoting**, so a multi-major answer like `Computer Science, Finance` stays one cell instead of shifting every column after it.

The table shows 8 of the 13 columns; submission date, preferred name, personal email, phone and date of birth are export-only, and the footer says so.

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

Rushees appear in **one** place: the **Rushees** tab of the member directory. They were pulled out of the undifferentiated chapter list on 2026-08-04 — a rushee is a prospective member, and mixing them in made "who is actually in this chapter" a question you had to read badges to answer.

That separation survived the 2026-08-11 rework, which turned the whole directory into [a tab bar over a grid of profile cards](./profiles-and-directory.md#a-tab-bar-over-a-grid-of-profile-cards-2026-08-11), one tab per member group. Rushees are simply the last tab now instead of a separate page — still their own list, never blended into the chapter's.

:::note The exclusion is in SQL, and it's two conditions
`memberModel.findAll` only returns rushees when they are **explicitly asked for by group** (`?group=rush`, which the directory's second call sends):

```js
if (!includeRush || groupFilter !== "rush") {
  sql += ` AND member_group IS DISTINCT FROM 'rush'`
}
```

`includeRush` remains the *permission* half, derived from the caller's own group. Both must hold — so `?group=rush` without permission returns an empty list rather than a 403, because whether an id belongs to a rushee is itself the thing being withheld.

**This has a non-obvious consequence for messaging.** The New Message picker is sourced from `/members`, so removing rushees from it silently removed leadership's ability to start the interview and bid conversations that leadership↔rushee DMs exist for. `getMessageableMembers` therefore makes a *second* call to `?group=rush` for leadership and merges the results. Anything else sourcing a person-picker from `/members` needs the same treatment.
:::

Visible to **every member group** (`RUSH_VISIBLE_TO` in `membersController`). This started narrower — eboard/chair/active only — and was widened 2026-08-03: pledges are around during rush and often help run it, and alumni ask who's coming through. The filtering is in SQL on a flag derived from the *caller's* group, so for anyone not admitted those rows never reach the browser at all. `findById` applies the same rule and returns 404 rather than 403, since whether an id belongs to a rushee is itself the thing being withheld.

### The Rushees tab appears and disappears on its own

It's there during rush and gone the rest of the year, with no toggle to remember. **How that works changed on 2026-08-11** — the mechanism is now the same one that hides an empty Alumni tab, rather than anything rush-specific.

**Now:** the directory draws a tab only for a group it actually has people in. `/members` never returns rush rows, so the directory asks for them separately (`getMemberDirectoryWithRushees`); out of season, or for a viewer the API withholds them from, that call comes back empty and there is no tab. No permission branch in the component, because "no rushees" and "not allowed" produce the identical empty list.

**Before:** **Rushees** was a sidebar entry of its own in all three portals, gated on `GET /members/rush-count > 0`, pointing at `/member/rushees`, `/pledge/rushees` and `/admin/rushees` — each of them `MemberDirectory` with `onlyGroup="rush"`. Those three pages, the `onlyGroup` prop, the `useRushCount` hook and the `getRushCount` server action are all deleted.

:::warning `GET /members/rush-count` still exists and now has no caller
The endpoint is unchanged and still returns **0 rather than 403** for anyone who may not see rushees. Nothing in the website reads it any more. It was left in place rather than removed with the website change — if you want it gone, that's an API change to make deliberately, not a leftover to assume is load-bearing.
:::

The Rushees tab also drops the **Pledge Class** column (a rushee has no pledge class — that's what they're rushing for, so the column was a full width of dashes) and reads "N rushees signed up" where the other tabs read "N of M members in chapter".

:::warning GROUP_ORDER must match roleGroups.js — this has now bitten twice
`MemberDirectory` bucketed rushees into **Active** because its `GROUP_ORDER` had no `rush`. The identical omission in `UserManagementPage`'s own `GROUP_ORDER` then showed every rushee to eboard as **"unassigned"** — `normalizeGroup()` falls back to that for anything not in the list.

Both are fixed. Any role added to `ktp-api/constants/roleGroups.js` must be added to *both* lists, or it silently mislabels rather than erroring.
:::

Rushees expose the same contact details as members — eboard needs to reach them about interviews and bids, which is the point of having them listed at all. The asymmetry is the other way round: `GET /members/leadership` gives *rushees* a deliberately narrower view of members, since they signed up through a public QR code and haven't joined anything yet.

**`users.about_me`** (migration `1785800000000`) is a free-text self-introduction shown in the directory and edited in Settings. It exists mostly for this section: a rushee has no pledge class, graduation date or exec title, so without it their card is a name and a major. The column is on every user rather than gated to rush, because there is nothing rush-specific about the data and a rush-only column would need migrating the day a rushee becomes a pledge. Capped at 600 characters in `userController.updateProfile`, which **truncates rather than rejects** — losing the tail of a bio beats throwing away someone's whole profile save.

:::warning GROUP_ORDER must match roleGroups.js
Before this section existed, `MemberDirectory`'s grouping did `GROUP_ORDER.includes(m.memberGroup) ? m.memberGroup : 'active'` — and `GROUP_ORDER` had no `rush`. Since `findAll` had no group filter either, **every rushee who completed their profile was already appearing in the directory, silently bucketed into Active members** while carrying a "Rushee" badge. Any new role added to `constants/roleGroups.js` must be added to `GROUP_ORDER` too, or it lands in Active and is mislabelled rather than erroring.
:::

## The public "How Rush Works" page

`/rush/how-it-works` explains the process to people who don't have an account yet. It's **public** — `/rush*` is deliberately excluded from the `proxy.ts` matcher, and only `/rushee` (the portal) is gated. It shares the visual language of `/rush` so the two read as one site.

The four steps live in `RUSH_STEPS` in `app/rush/rush-content.js`, separated from the page layout so the copy can be reworded each semester without touching JSX:

1. **Make an account** — button on the page or the QR code at an info session, then sign in to the portal
2. **Come to events and talk to members** — attendance is scanned at each event
3. **Sign up for interviews** — the Interviews tab, towards the end of rush
4. **Check back for an update** — bids arrive as a direct message plus a push notification

It is also linked from **`/login`**, under "Not a member yet?" — see [Sign-In Flow](./sign-in.md#sign-up-for-rush). `/login` deliberately links *here* rather than to the Authentik invitation URL, because this page already handles rush being closed and `/login` would otherwise need to know about it.

The page fetches `getPublicRushSignup()` on mount. When signup is open it shows the signup button; when it's closed it says so plainly and points at `/rush` and Instagram, rather than rendering a dead button. That call never rejects — it resolves to `is_open: false` on any failure, so a backend hiccup hides the button instead of breaking a public page.

:::warning Signed in? The button becomes "Sign out to sign up"
Creating a new account on a browser that already has one open is what mixes the two identities together — Authentik ends up holding the new rushee while the site's own cookie still holds the old member, and the member's session is later silently rewritten as the rushee. See [Two sessions in one browser](./sign-in.md#two-sessions-in-one-browser).

So when `useSession()` reports an authenticated visitor, the CTA becomes **Sign out to sign up**, calling `logoutEverywhere()`. They land back on `/login`, which carries a **Sign up for rush** link straight back here — now signed out.

Two details that are easy to undo by accident:

- The page waits for `useSession()` to resolve before rendering **either** branch. The session lookup and the signup-status call race, and if the status wins, a signed-in visitor gets a live signup link for a beat — long enough to click.
- **This is the second line of defence, not the first.** Most rushees scan a QR code that goes straight to Authentik and never load this page at all. `/auth/start` is the guard that catches those, and it has to keep working on its own.
:::

:::warning What the copy must not promise
Step 3 was reworded once [Interviews](./interviews.md) shipped — it previously said signup details would be *announced*, because no such feature existed. It now describes the Interviews tab, but still has to read correctly **before** eboard publishes a schedule, since the tab isn't there until they do.

Step 4 is deliberately worded as an update you'll see, not an automated bid notification: bids are sent by leadership as a direct message, and there is no separate bid system.
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
- **No Meetings tab.** Replaced by [Interviews](./interviews.md) at `/rushee/interviews`. `/meetings` is gated on `SHARED_ALBUM_GROUPS`, so the API refuses rush tokens outright — this is the one portal without it

:::info The Promise.all trap does not apply to the calendar
`EventsCalendar.loadCalendarItems` fans out to events, meetings **and** interviews. `/meetings/calendar` 403s for a rushee, which under a bare `Promise.all` would blank the whole rush calendar — exactly the `PollsPage` failure above. Each of the two extra calls already carries its own `.catch(() => [])`, so a 403 degrades to an empty list instead of taking the chapter events with it. Keep that per-call catch when adding a fourth source.
:::
