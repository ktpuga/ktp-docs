---
sidebar_position: 4
---

# Profiles & Directory

## Usernames

Members change their own username from **Settings**, inline on the header card (`components/profile/UsernameEditor.jsx`). It was eboard-managed until 2026-08-07.

:::warning A username is a login credential, not a profile field
This is the only thing on the Settings page that writes to **Authentik** as well as our database, because Authentik owns login identifiers — the new name is what the member types to sign in.

The order is fixed: **Authentik first, then Postgres.** A name Authentik rejects as taken leaves both systems untouched; writing ours first would leave the portal showing a username the member cannot actually log in with.

It also needs an Authentik permission that is **not granted by default** — see [Authentik: `Can change User`](../authentik/overview.md#api-tokens--service-accounts). Without it every rename returns `502`. That missing grant is why the first attempt at this feature was reverted.
:::

It is a **separate endpoint** (`PUT /users/me/username`) and a separate control from the main profile form, rather than another field in it. A rename can fail with something the member has to act on — "that name is taken" — and inside the main form that failure surfaces as a whole-form error on a save that was really about their bio.

Two behaviours that look like bugs and are not:

- **`upsert` re-syncs the username on every login.** That is what stops Postgres drifting from Authentik: an eboard rename made directly in Authentik reaches the portal at next sign-in, and a rename that succeeded in Authentik but failed to mirror repairs itself.
- **`updateProfile` deliberately does not write `username`.** It receives the value from the access token, which still carries the *old* name for the rest of the session after a rename — so writing it would silently undo the rename the next time the member edited anything else.

Validation (`services/usernames.js`) is deliberately permissive: 3–32 characters of `[a-zA-Z0-9._-]`. Length matters because the portal renders `@name` inside table cells; ASCII-only matters because mixed-script homoglyphs let two visually identical usernames exist in a directory people scan by eye rather than read.

:::warning The server action must return `{ error }`, never throw
Every failure here is one the member has to read — "that name is taken", "renames are unavailable right now". A **thrown** Server Action error has its message replaced in production by React's generic *"An error occurred in the Server Components render"* (error **#441**), so throwing turns all of them into that one string.

This shipped wrong on the first deploy: the Authentik 403 became a 502, the 502 threw, and the member saw React #441 rendered as the field's error message. `updateUsername` in `lib/portal-api.js` now returns `{ error }`, matching `uploadProfilePicture`. Any new action whose failure is meant to be read by a person needs the same treatment.
:::

Usernames are **display-only everywhere else** — every lookup, foreign key and permission check uses `authentik_id`, so a rename breaks nothing. The one place it lingers is history: the moderation queue and activity log record `@name` at the time of writing, so a report filed against an old name still shows that name. Renames are themselves recorded in the [activity log](./activity-log.md), since it captures every mutating request.

---

## What you're doing now, and your own links

Two fields added 2026-08-11.

**Both "what you're doing now" and your links now appear on the public roster.** The original scope was member-side only for both, and both were reversed: an alumnus saying what they're up to, with a link to their portfolio, is the point of a public alumni page. Anyone who would rather not be on that page at all can turn themselves off it entirely, below.

That makes the render-time URL check load-bearing rather than defensive. A list of arbitrary member-supplied URLs rendered as live hrefs on an **unauthenticated** page is the highest-exposure thing on the site, so the roster card runs every one through `safeExternalHref()` before rendering and drops anything that isn't plain `http(s)` — it does not trust that write-time validation covered rows written before that validator existed.

**"What you're doing now"** is one line of free text for what an alumnus is up to after graduation: *"SWE at Google"*, *"Law school at Emory"*, *"Taking a year off"*. Free text rather than a company/title pair precisely so it can hold the second and third of those as comfortably as the first. It shows directly under the badges on a directory card, because for an alumnus it is usually the thing somebody opened the profile to find out.

**Links** are up to five labelled URLs, shown as chips at the bottom of the card. The row wraps and re-spaces as links are added.

Only alumni are *asked* for the "doing now" field, but the column is on every member and the API validates it for everyone. That is deliberate and follows `about_me`: a column gated to one group has to be migrated the day somebody changes group, which happens here every spring. Eboard's edit-anyone modal shows both fields for everybody, since the point of that modal is correcting what someone typed into the wrong box.

:::warning Links are an href, which is not the same as text
Every link URL is validated and stored canonicalised by the API, and validated *again* by the website before it is rendered. That is not redundancy for its own sake. React escapes a hostile string rendered as text, and does nothing whatsoever about `javascript:` inside an `href` — and `new URL()` is not a check either, since it parses `javascript:alert(1)` perfectly happily. This exact pair was already got wrong once in document links.

A link that fails validation renders as **no chip**, rather than a dead or hostile one.
:::

A link with a label but no address, or an address with no label, is rejected with a message naming the row. An empty row you added and never filled in is simply dropped, so clicking "Add a link" and changing your mind never fails the save.

## Pronouns

Optional, set by the member on their own profile form. A dropdown of common presets — he/him, she/her, they/them, he/they, she/they — plus **Custom…**, which reveals a free-text box.

The presets are a **convenience, not a vocabulary**. The column is plain `TEXT` and the API validates only the length (≤40), so the Custom box is a real escape hatch rather than a sixth preset. Nothing checks the value against the list, deliberately: a list of pronouns is never complete, and an enum would need a migration per person to fix that.

Choosing nothing stores `NULL`, which is *unanswered* rather than an answer. The directory renders nothing at all for it — not an empty pill, and not "prefer not to say" as though it were a stated position.

:::caution Member portal only, and the public roster must stay that way
Pronouns appear on the directory card and the profile modal, both behind login. They are **not** on the public `/members-list` roster.

That is enforced by the SELECT lists in `models/memberModel.js` — `findPublicRoster` and `findPublicRosterMember` do not name the column — and by nothing else. `/members-list` is unauthenticated and search-indexable, and somebody can be out inside the chapter without being out on a public web page.

`test/pronouns.test.js` asserts both directions against the real model source: absent from the two public queries, present in the two portal ones. If that call is ever reversed, reverse it deliberately rather than letting it arrive with a `u.*`.
:::

### Eboard's edit modal renders the field because it must

`components/profile/PronounsField.jsx` is shared by the member's own form and eboard's `AdminEditProfileModal`, for the same reason `LinksField` is: the admin write is **whole-row**, and both forms build their body with the shared `buildProfilePayload`. A modal that rendered no pronouns input would still send `pronouns: null` and blank the member's answer every time eboard corrected their major — which is exactly the bug `links` once had.

## Birthdays

The directory profile panel shows a member's birthday as **month and day only** — "March 14", never a year.

That is not a display choice. `GET /members` returns a `birthday` field formatted as `MM-DD` **in SQL**, and the raw `dob` column is not in the projection at all:

```sql
TO_CHAR(dob, 'MM-DD') AS birthday
```

:::warning The year never leaves Postgres, and that is the whole design
The chapter wanted birthdays so people can say happy birthday. A full date of birth published to ~100 members also publishes **everyone's age**, which nobody asked for and which a member cannot take back once it has been on a page.

Formatting in the query rather than in the client means no consumer of `/members` can recover the year — not the website, not the iOS app, not anything written later. Adding `dob` to that `SELECT` would undo it in one word, so a test asserts against the real query source rather than trusting this paragraph.
:::

:::note Formatted in SQL, not in JavaScript — this is a correctness bug, not a preference
`dob` is a `DATE`. Handing `"1998-03-14"` to `new Date()` parses it as **UTC midnight**, which renders as the 13th in any negative-offset timezone, including this chapter's. Everyone's birthday would show one day early, and a January 1st birthday would appear as December 31st.

`TO_CHAR` never converts a timezone, so the day cannot shift. `formatBirthday` on the website builds the label from the month and day as separate numbers for the same reason — it never constructs a `Date` from the string. This is the same trap `services/validate.js` documents as `dateOnly`.
:::

**Absent for most of the chapter.** `dob` is optional on the profile form, so `birthday` is `null` for anyone who never filled it in and the row simply does not render.

**Portal only.** The public roster queries (`findPublicRoster`, `findPublicRosterMember`) select neither `dob` nor `birthday`, exactly as they omit `pronouns`. `/members-list` is unauthenticated and indexable; a birthday behind the portal login is a different thing from one on the open internet.

## Traits

Eboard can type up to six short **captions** onto any member: *Pledge Chair*, *Fintech*, *Atlanta, GA*. Each is one plain string, up to 80 characters.

They render as **pills beside the member's group badge**, on the directory card, in the profile modal, and on the public roster — deliberately the same treatment a chair's committee caption gets. A trait reading "Pledge Chair" should be indistinguishable from the caption a real chair gets, which is the point of them, so both come from one `CaptionPill` component rather than two lookalike styles that can drift.

:::note They used to be label/value pairs
Until migration `1788200000000` a trait was `{ label, value }` and rendered as a bordered definition list down the card. That shape made eboard invent a label for things that don't have one, and it read as a table rather than a caption. Existing rows were converted by joining the halves as `"label: value"`.

Both cards coerce an un-migrated pair through `traitText()` rather than rendering it directly. React **throws** on an object child, so without that, deploying the site before running the migration would take the public roster down rather than merely look wrong.
:::

This generalises the exec title, which is the same idea fixed to one label. Exec titles stay exactly as they are; a trait is additive, a role is not.

Set them from **Admin → Users → Edit** on any member. Up to six, label ≤40 characters, value ≤80.

:::info Why members can't set their own traits
These land on a page with no authentication, so they are chapter-authored rather than self-authored. That distinction is enforced by the *routes*, not by a permission check: `traits` is deliberately not one of the profile fields, so there is no shape of request to `PUT /users/me/profile` that reaches the column. The only writer is the eboard-only `PUT /admin/users/:id/traits`.

A member's own free-text field is **"What you're doing now"** above — that one is theirs, and it is also public.
:::

Traits save through their own endpoint, so the edit modal performs two writes behind one Save button. Traits go first on purpose: a rejected trait then leaves the rest of the profile untouched, rather than reporting an error on a form whose other changes have already been committed.

## Choosing not to be on the public roster

**Settings → Public Roster** controls whether a member appears on [ugaktp.com/members-list](https://ugaktp.com/members-list), the chapter page anyone on the internet can load. Everyone is on it by default, exactly as before this setting existed.

Turning it off does two things, and the second is the one that matters: the member disappears from the list, **and** their photo stops being served from the public media route. Hiding someone from the list alone would leave their picture fetchable by anyone who knew their id, which is a promise the toggle would not be keeping.

Nothing inside the portal changes. They stay in the member directory, keep their profile, and everything else they filled in was never public in the first place. Before this shipped, the only way off the roster was to delete your profile picture, which also removed you from the directory everybody actually uses.

---

## Profile pictures

Members upload a profile picture from **Settings** (or during onboarding at `/complete-profile` — both use the same shared `ProfileForm` component). Uploading happens immediately on file select, independent of the rest of the profile form's save button — you don't need to click a separate "Save" to update just your picture.

Uploads accept **JPEG, PNG, WebP, HEIC/HEIF, AVIF, GIF, and TIFF** up to **25MB**, and are converted server-side to a resized JPEG before storage — so members can upload straight from a phone camera roll without converting anything first. See [API: `PUT /users/me/profile-picture`](../api/endpoints.md#put-usersmeprofile-picture) for why the conversion exists and what it does to EXIF data.

Pictures are stored in Immich and served through `/api/users/:id/profile-picture/media`, which is generalized to **any** member's id, not just your own — this is what lets the Directory, `/admin/users`, and message threads all show other members' pictures. If a member hasn't set one, the request 404s and the UI falls back to showing their initials.

:::warning Use `<img onError>`, not Radix `Avatar`
The fallback is implemented with a plain `<img>` and an `onError` handler throughout the portal. Radix's `AvatarFallback` (in `components/ui/avatar.jsx`) has a real quirk where it can stay visible even after the image successfully loads — that produced an "avatars only ever show initials" bug here more than once. Prefer the plain pattern for anything new.
:::

A profile picture is also what gets a member onto the [public roster](./overview.md#public-roster-members-list) — members without one are excluded from that page entirely.

### Changing a picture updates it everywhere, and that took work

Until 2026-08-11, changing your photo appeared not to work. The upload succeeded every time; what you were looking at was cache. The media proxy sends no `Cache-Control` and its URL is keyed on the member id alone, so the address of your picture was identical before and after the change and the browser had no reason to fetch it again. Every avatar in the portal was affected, plus the public roster.

The fix is a version on the URL, and the version is the **Immich asset id**. Immich issues a new asset per upload, so it changes exactly when the picture does and never in between. That last part matters as much as the first: a timestamp would also have busted the cache, and would have re-downloaded every avatar in the directory on every page load forever.

All of it lives in `lib/avatar.js` on the website. Two consequences worth knowing:

- **API responses now carry the asset id wherever they carry a member id**, including the public roster (`profilePictureAssetId`) and the blocked-members list (`profile_picture_asset_id`). A projection that omits it silently reverts the fix for that one surface, so it is covered by a test rather than by convention.
- **The sidebar updates without a refresh.** It sits in a layout that reads your profile once per full page load, so a new URL alone would not have reached it. The upload broadcasts an event and the sidebar re-reads.

---

## The profile form

One component, `components/profile/ProfileForm.jsx`, serves both onboarding at `/complete-profile` and Settings; eboard's "edit anyone" modal (`components/admin/AdminEditProfileModal.jsx`) is a deliberate non-reuse of it, but posts the same payload through `lib/profile.js`'s `buildProfilePayload`. On the API side both land in the **same normalizer**, so the rules cannot drift apart on the route with more authority. The per-field rules are documented once, at [API: `PUT /users/me/profile`](../api/endpoints.md#put-usersmeprofile).

Four of them are worth knowing here because the form is what produces the value:

- **The onboarding form does not ask for the UGA email; the Settings form does.** The Authentik enrollment prompt collects the address now and `POST /users/sync` seeds it onto the row at first login, so it is already on file before anyone reaches `/complete-profile`. The field stays on the Settings form so it remains correctable.

  The mechanism is worth reading before touching either form. `buildProfilePayload` uses `formData.has('email')` for this one key, so a form that does not render the input omits the key entirely rather than sending `null` — and the API treats those two differently: an **absent** key defers to the address already stored, while an **explicit null** is someone clearing the field and is still refused. Re-rendering the input on the builder without following that chain will 400 every first save.

  :::warning Deploy order
  Configure the Authentik prompt **before** shipping a website that omits the field. In between, a new non-alumni member has nothing seeding the column and no input to type into, so their first save is a 400 they cannot clear. The API keeps that 400 deliberately — the alternative is a `profile_complete` account with no UGA address, which is the one identity fact the chapter relies on.
  :::


- **Graduation is a semester and a year**, not a date. The form composes it from a `Spring`/`Fall` dropdown and a **free-text** four-character year box, so `"Spring abcd"` is something the real UI can submit; the API rejects it. Nothing is lost by that strictness, because `parseGraduationDate` already discards a value it cannot split back apart, leaving the picker blank and clearing the column on the next save. The client and the server agree.
- **Date of birth is sent as `YYYY-MM-DD`**, which `<input type="date">` produces and `normalizeUserProfile` trims the stored timestamp down to. A value in any other spelling is a 400.
- **The three rush interest fields (`minors`, `gpa`, `heard_from`) render for rushees only**, and use the same `formData.has` mechanism as the UGA email above — for a different reason and with higher stakes. See [Rush Portal: the interest form](./rush-portal.md#the-interest-form). `AdminEditProfileModal` renders them for *everyone*, because the admin route is a whole-row `UPDATE` that does not honour absent keys; the two forms disagree on purpose.

:::danger Never pass a semester string to `new Date()` — the NaN guard will not catch it
Fixed 2026-08-12. `formatGraduationDate` in `lib/portal-format.js` used to call `new Date(value)` on the stored value and fall back to the raw string only if the result was `NaN`. It never was: V8's lenient legacy date parser ignores the word it does not recognise and keeps the year, so **`new Date('Fall 2027')` is 1 January 2027**, not an Invalid Date.

The guard therefore never fired, and every member's graduation rendered as "Jan &lt;year&gt;" — right year, wrong month, for the entire chapter at once, on both the profile card and the directory.

It now matches an ISO prefix explicitly for legacy rows written before the column held a semester, and returns anything else as stored. The ISO branch rebuilds the date in **local** time from the captured month and year rather than passing the string to `new Date()`, which parses ISO as UTC midnight and lands on the previous month for anyone west of UTC — the same day-shift trap as `dateOnly` on the API side.
:::

:::warning `updateProfile` returns `{ error }` — the same rule as `updateUsername` above
It used to go through `apiPut`, which **throws** on a non-ok response, and a thrown Server Action error has its message replaced in production by React's #441. That was survivable while the only 400s were the UGA-email rule (which the form pre-empts on the client) and a malformed LinkedIn URL.

Once every field validates, it is not: a phone number with too few digits, a graduation that is not a semester and a year, a date of birth in the future and a name made of spaces are all failures the member has to read to fix. `lib/portal-api.js` now returns `{ error }` so they arrive as the API's own message.
:::

---

## Member Directory

:::note LinkedIn buttons (2026-08-05)
Members with a LinkedIn URL get a link under their name in the directory profile modal and on their card on the public `/members-list` roster (where `ProfileCard` already had a LinkedIn slot that nothing was filling). It used to sit on the directory row as well; the card grid that replaced those rows carries only the fields listed below, so the modal is now the one place it appears inside the portal.

`linkedin_url` was added to `memberModel`'s `findAll`, `findById` and `findPublicRoster` projections — it had been stored since the beginning but selected by none of them.

**It is the first profile field to become an `href`**, which is why it arrived with validation on both sides: `services/urls.js` in the API (see [API: Input validation](../api/overview.md#input-validation)) and `linkedinHref()` in `lib/portal-format.js` at render. A value that fails either rule renders no button rather than a broken or hostile link.

On the public roster this is the only contact-ish field — still no email, phone, major or pledge class. A LinkedIn profile is already a public professional page, and that roster exists to be found.
:::

`/member/directory`, `/pledge/directory` and `/admin/directory` list chapter members (name, `@username`, major, pledge class, and a role line for eboard and chairs). All three are the same `components/portal/MemberDirectory.jsx`; only the title, blurb and accent differ.

### A tab bar over a grid of profile cards (2026-08-11)

The directory used to be one scrolling table with a heading rule between each group. It is now a tab bar, one tab per group in `MEMBER_GROUP_ORDER` (**E-Board, Chairs, Members, Pledges, Alumni, Rushees**), over a responsive grid of profile cards. Same data, same profile modal on click.

Three things fall out of the tabs:

- **A group with nobody in it gets no tab.** This is what replaced the rush-count check that used to gate the old sidebar entry: out of season, or for a viewer the API withholds rushees from, the rush half of the fetch is empty and the tab isn't drawn. No permission branch in the component, and none needed.
- **The count line under the grid follows the open tab.** It reads "N rushees signed up" on the rush tab and "N of M members in chapter" everywhere else. That total excludes rushees deliberately: they now arrive in the same fetch, so a plain `members.length` would quietly report a bigger chapter than there is. With a search term on screen it reads "N of M matching …" instead, because the number under a list should be the length of the list above it.
- **The active tab is derived, not stored.** `chosenGroup` is only a preference; the tab actually rendered is the first one that still exists. A chapter that loses its last rushee mid-session falls back rather than staring at a tab that isn't there.

#### The card

A card carries the photo, the name, `@username`, major, pledge class, and the exec title or chaired committees, and **deliberately no group badge** — the tab you are on already says the group, and repeating it on all 61 cards is noise. The modal still shows one.

Every field except the name can be null, and on the Rushees tab the pledge class is null for **everyone**, so that whole tab renders the sparse variant. Each block is conditional and the card is centred, which is what lets a photo-and-name-only card still look composed rather than broken. There are no dash placeholders on a card; those belong to table cells.

The role line is coloured by the **portal accent**, not the member group's colour. Only around 14 of ~94 people have a role at all, so colouring it by group would put a second group marker on exactly the cards that least need one.

Members who have never uploaded a photo get **initials on a gradient seeded from their id** (`lib/seed.js`, the same djb2 helper behind the empty-album covers). A tab of 60 rushees is mostly initials, and one accent colour for all of them is 60 identical circles with nothing to catch the eye on. The seed is the id, so a member's tile is the same colour on the card and in the modal it opens, on every device and every reload.

#### Group colours that survive dark mode

The six `GROUP_COLOR` swatches were picked to sit on a white card: dark and saturated, which is exactly wrong on a dark one. The first tab bar ducked that by keeping every label on `text-foreground` and letting the colour appear only in a 2px underline, so group identity barely read at all.

`readableGroupText(hex, dark)` keeps the hue, which is the identity, and re-derives only the lightness for the theme on screen: light mode holds the swatch near 34% L with a saturation floor, dark mode lifts it to 70% and pulls saturation back so a bright hue on near-black doesn't vibrate. Deriving beats a second hardcoded palette — a group added to `GROUP_COLOR` gets its dark variant for free, and the two can't drift. The same function now colours the group badge in the profile modal, which had the identical problem.

Structurally, **every tab carries a solid dot in its group's hue whether it is selected or not.** Colouring only the active tab leaves five of the six unlabelled at any moment.

#### Search, sort, and the phone

**Search** filters within the open tab, on name and `@username`. It exists for the Rushees tab, where 60+ cards is past the point where scanning works. The tabs are built from the unfiltered groups, so searching can never make a tab vanish underneath the person typing.

**Sort** is still the one control it always was: last name, ascending or descending.

Six tabs with counts do not fit a phone, and the first version was a bare horizontally scrolling row with no sign that anything lay past the right edge. It now has scroll-snap, a fade on whichever side has more to show, and a chevron button that appears and disappears with it. The fades resolve to `card`, not `background`: the tab bar sits inside the directory panel, and fading to the page colour would draw a pale block across it.

:::note The directory makes two API calls, not one
`/members` deliberately omits rushees (see [Rush portal](./rush-portal.md#rushees-in-the-member-directory)), so a directory that wants a Rushees tab has to ask for them separately. `getMemberDirectoryWithRushees` in `lib/portal-api.js` fires both and concatenates, so the browser still makes one round trip.

The rush half is allowed to fail and returns `[]`. The API already answers `[]` rather than 403 for a caller who may not see rushees, so a rejection there means a real backend problem — and that should cost the Rushees tab, not the whole directory. A `NEXT_REDIRECT` still propagates, or the page renders that string instead of navigating.
:::

Clicking any member opens a **profile view** — a modal with their photo, group, major, pledge class, graduation date, and email, plus:

- **Email** — a `mailto:` link, if they have an email on file. Members carry two addresses, **UGA Email** and **Personal Email**; both rows render when both exist, and the button prefers the UGA one

:::note Alumni have no UGA email
A UGA address stops working at graduation, so alumni don't have one anywhere in the product: the profile form doesn't offer the field (their remaining input is labelled just **Email**), and the API returns `email: null` for them, so the directory shows one address and the button targets it.

Withholding it is a **correctness** fix, not a privacy one. The mailto prefers `email` over `personal_email`, so a stale UGA address left in the payload would silently send mail to a dead inbox.

It's enforced in `memberModel`'s SQL rather than in the component, for the same reason the rushee rules are — filtering a payload client-side is a display choice, not a boundary, and a component-level check would miss the iOS app entirely.

The stored value isn't deleted; it's masked at read time, so an alumnus who was mis-grouped and later corrected still has their address. The matching write-side guard is `preserveEmail` in `userModel.updateProfile`: `PUT /users/me/profile` is a whole-row upsert where absent keys become `NULL`, so without it an alumnus editing their bio would erase the address on file. See [API: `GET /members`](../api/endpoints.md#get-membersid).

The rule keys off the resolved `member_group`, never the raw `groups` array — Authentik doesn't drop someone's old group when they graduate.
:::
- **Message** — jumps straight into a direct-message conversation with them, in whichever portal you're currently in (`/member/messages?with=<id>`, `/pledge/messages?with=<id>`, etc. — the target portal is derived from the current URL, not hardcoded, so this works the same from any portal that has a Directory)
- **Request a meeting** — proposes a time through the [meetings](./meetings.md) flow; they accept or decline
- **Report** — flags the profile itself to eboard's review queue (see [Safety & Moderation](./overview.md#safety--moderation))
- **Block** — stops them from messaging you and hides their messages from your own view, self-service, no eboard approval needed. It's the small button immediately beside Report at the top-left of the profile card (it used to be a full-width button at the bottom), and the same pairing appears on any of their messages and photos

The last two aren't shown on your own profile.

---

## Admin: User Management

`/admin/users` (eboard only) shows real member data — search, group filter, profile-complete filter, refresh button. Two things are editable inline on each row:

- **Group** — picking a new value calls Authentik directly to move them there, then mirrors it immediately, with no waiting for their next login. See [Operations: Changing a Member's Group](../operations/member-management.md#changing-a-members-group).
- **Exec title** — free text (e.g. "President", "VP of Finance"), shown on the directory and the public roster. Purely a display label: it makes no Authentik call and isn't validated against the member's group, though it's only ever surfaced for eboard.

There is still **no way to remove or deactivate a user from this page** — member removal remains an Authentik-side operation (see [Member Management](../operations/member-management.md)), not something the website UI does.

### Editing someone else's profile

Each row has an **Edit** button opening a modal that can change everything on that person's profile: names, date of birth, major, graduation, both emails, phone, pledge class, LinkedIn, About Me, their username, and their profile picture (replace or remove). The chapter is a private organisation running its own directory, so correcting a member's profile text is ordinary housekeeping — mostly fixing what people typed in the wrong box, and removing the occasional thing that doesn't belong there.

Three parts of the design are deliberate:

- **Username saves on its own button**, separate from the rest of the form. It's the only field that writes to Authentik, and the only one that can fail with something specific ("that name is already taken") that would otherwise be buried inside an unrelated bio edit.
- **Profile pictures upload on select**, with no separate save step, exactly like the member's own picture field. Same 25MB cap and same server-side re-encode. The stored Immich asset is kept even after a removal, so a contested takedown can still be reviewed.
- **Anonymized accounts are not editable.** Anyone who used "delete my account" had their PII erased on purpose, and the API returns `404` rather than let an edit write names back into that row.

:::note This is the most powerful write in the app
It changes what a person's own profile says about them, under their name, with no notification to them. Every one of the three routes is recorded in the [activity log](./activity-log.md) automatically — by the global middleware, not by anything the controller remembers to call. If you're wondering who changed someone's bio, that's where it is.
:::

The modal is **not** a reuse of the shared `ProfileForm`. That component decides which fields to show by reading the *session* — `isRushee` and `isAlumni` describe whoever is logged in, which here is the eboard member, not the person being edited. It would show the wrong field set and post to the wrong route. The two share what actually matters instead: `buildProfilePayload`, so both send identical bodies, and the API's `services/profileFields.js`, so both are validated by identical rules.

One field differs on purpose: **UGA Email is shown here even for alumni**, though alumni don't see it on their own form and it's masked in the directory. This is the surface for fixing bad stored data, so it shows what's really in the row.
