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

## Profile pictures

Members upload a profile picture from **Settings** (or during onboarding at `/complete-profile` — both use the same shared `ProfileForm` component). Uploading happens immediately on file select, independent of the rest of the profile form's save button — you don't need to click a separate "Save" to update just your picture.

Uploads accept **JPEG, PNG, WebP, HEIC/HEIF, AVIF, GIF, and TIFF** up to **25MB**, and are converted server-side to a resized JPEG before storage — so members can upload straight from a phone camera roll without converting anything first. See [API: `PUT /users/me/profile-picture`](../api/endpoints.md#put-usersmeprofile-picture) for why the conversion exists and what it does to EXIF data.

Pictures are stored in Immich and served through `/api/users/:id/profile-picture/media`, which is generalized to **any** member's id, not just your own — this is what lets the Directory, `/admin/users`, and message threads all show other members' pictures. If a member hasn't set one, the request 404s and the UI falls back to showing their initials.

:::warning Use `<img onError>`, not Radix `Avatar`
The fallback is implemented with a plain `<img>` and an `onError` handler throughout the portal. Radix's `AvatarFallback` (in `components/ui/avatar.jsx`) has a real quirk where it can stay visible even after the image successfully loads — that produced an "avatars only ever show initials" bug here more than once. Prefer the plain pattern for anything new.
:::

A profile picture is also what gets a member onto the [public roster](./overview.md#public-roster-members-list) — members without one are excluded from that page entirely.

---

## The profile form

One component, `components/profile/ProfileForm.jsx`, serves both onboarding at `/complete-profile` and Settings; eboard's "edit anyone" modal (`components/admin/AdminEditProfileModal.jsx`) is a deliberate non-reuse of it, but posts the same payload through `lib/profile.js`'s `buildProfilePayload`. On the API side both land in the **same normalizer**, so the rules cannot drift apart on the route with more authority. The per-field rules are documented once, at [API: `PUT /users/me/profile`](../api/endpoints.md#put-usersmeprofile).

Two of them are worth knowing here because the form is what produces the value:

- **Graduation is a semester and a year**, not a date. The form composes it from a `Spring`/`Fall` dropdown and a **free-text** four-character year box, so `"Spring abcd"` is something the real UI can submit; the API rejects it. Nothing is lost by that strictness, because `parseGraduationDate` already discards a value it cannot split back apart, leaving the picker blank and clearing the column on the next save. The client and the server agree.
- **Date of birth is sent as `YYYY-MM-DD`**, which `<input type="date">` produces and `normalizeUserProfile` trims the stored timestamp down to. A value in any other spelling is a 400.

:::warning `updateProfile` returns `{ error }` — the same rule as `updateUsername` above
It used to go through `apiPut`, which **throws** on a non-ok response, and a thrown Server Action error has its message replaced in production by React's #441. That was survivable while the only 400s were the UGA-email rule (which the form pre-empts on the client) and a malformed LinkedIn URL.

Once every field validates, it is not: a phone number with too few digits, a graduation that is not a semester and a year, a date of birth in the future and a name made of spaces are all failures the member has to read to fix. `lib/portal-api.js` now returns `{ error }` so they arrive as the API's own message.
:::

---

## Member Directory

:::note LinkedIn buttons (2026-08-05)
Members with a LinkedIn URL get a link under their name in three places: the directory row, the directory profile modal, and their card on the public `/members-list` roster (where `ProfileCard` already had a LinkedIn slot that nothing was filling).

`linkedin_url` was added to `memberModel`'s `findAll`, `findById` and `findPublicRoster` projections — it had been stored since the beginning but selected by none of them.

**It is the first profile field to become an `href`**, which is why it arrived with validation on both sides: `services/urls.js` in the API (see [API: Input validation](../api/overview.md#input-validation)) and `linkedinHref()` in `lib/portal-format.js` at render. A value that fails either rule renders no button rather than a broken or hostile link.

On the public roster this is the only contact-ish field — still no email, phone, major or pledge class. A LinkedIn profile is already a public professional page, and that roster exists to be found.
:::

`/member/directory` and `/pledge/directory` list chapter members (name, major, pledge class, graduation, group badge). `/admin` has no Directory — eboard uses User Management instead.

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
