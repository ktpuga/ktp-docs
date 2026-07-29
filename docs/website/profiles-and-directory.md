---
sidebar_position: 4
---

# Profiles & Directory

## Profile pictures

Members upload a profile picture from **Settings** (or during onboarding at `/complete-profile` — both use the same shared `ProfileForm` component). Uploading happens immediately on file select, independent of the rest of the profile form's save button — you don't need to click a separate "Save" to update just your picture.

Uploads accept **JPEG, PNG, WebP, HEIC/HEIF, AVIF, GIF, and TIFF** up to **25MB**, and are converted server-side to a resized JPEG before storage — so members can upload straight from a phone camera roll without converting anything first. See [API: `PUT /users/me/profile-picture`](../api/endpoints.md#put-usersmeprofile-picture) for why the conversion exists and what it does to EXIF data.

Pictures are stored in Immich and served through `/api/users/:id/profile-picture/media`, which is generalized to **any** member's id, not just your own — this is what lets the Directory, `/admin/users`, and message threads all show other members' pictures. If a member hasn't set one, the request 404s and the UI falls back to showing their initials.

:::warning Use `<img onError>`, not Radix `Avatar`
The fallback is implemented with a plain `<img>` and an `onError` handler throughout the portal. Radix's `AvatarFallback` (in `components/ui/avatar.jsx`) has a real quirk where it can stay visible even after the image successfully loads — that produced an "avatars only ever show initials" bug here more than once. Prefer the plain pattern for anything new.
:::

A profile picture is also what gets a member onto the [public roster](./overview.md#public-roster-members-list) — members without one are excluded from that page entirely.

---

## Member Directory

`/member/directory`, `/alumni/directory`, and `/pledge/directory` list chapter members (name, major, pledge class, graduation, group badge). `/admin` has no Directory — eboard uses User Management instead.

Clicking any member opens a **profile view** — a modal with their photo, group, major, pledge class, graduation date, and email, plus:

- **Email** — a `mailto:` link, if they have an email on file
- **Message** — jumps straight into a direct-message conversation with them, in whichever portal you're currently in (`/member/messages?with=<id>`, `/alumni/messages?with=<id>`, etc. — the target portal is derived from the current URL, not hardcoded, so this works the same from any portal that has a Directory)
- **Schedule** — link-out to their personal Calendly, if they've set one in Settings
- **Report** — flags the profile itself to eboard's review queue (see [Safety & Moderation](./overview.md#safety--moderation))
- **Block** — stops them from messaging you and hides their messages from your own view, self-service, no eboard approval needed

The last two aren't shown on your own profile.

---

## Admin: User Management

`/admin/users` (eboard only) shows real member data — search, group filter, profile-complete filter, refresh button. Two things are editable inline on each row:

- **Group** — picking a new value calls Authentik directly to move them there, then mirrors it immediately, with no waiting for their next login. See [Operations: Changing a Member's Group](../operations/member-management.md#changing-a-members-group).
- **Exec title** — free text (e.g. "President", "VP of Finance"), shown on the directory and the public roster. Purely a display label: it makes no Authentik call and isn't validated against the member's group, though it's only ever surfaced for eboard.

There is still **no way to remove or deactivate a user from this page** — member removal remains an Authentik-side operation (see [Member Management](../operations/member-management.md)), not something the website UI does.
