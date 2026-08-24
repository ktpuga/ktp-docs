---
sidebar_position: 4
---

# Profiles & Directory

## Profile pictures

Members upload a profile picture from **Settings** (or during onboarding at `/complete-profile` — both use the same shared `ProfileForm` component). Uploading happens immediately on file select, independent of the rest of the profile form's save button — you don't need to click a separate "Save" to update just your picture.

Pictures are stored in Immich and served through `/api/users/:id/profile-picture/media`, which is generalized to **any** member's id, not just your own — this is what lets the Directory, `/admin/users`, and message threads all show other members' pictures. If a member hasn't set one, the request 404s and the frontend's `AvatarImage` component automatically falls back to showing initials — no special-casing needed anywhere it's used.

---

## Member Directory

`/member/directory` and `/alumni/directory` list chapter members (name, major, pledge class, graduation, group badge). Clicking any member opens a **profile view** — a modal with their photo, group, major, pledge class, graduation date, and email, plus two actions:

- **Email** — a `mailto:` link, if they have an email on file
- **Message** — jumps straight into a direct-message conversation with them, in whichever portal you're currently in (`/member/messages?with=<id>`, `/alumni/messages?with=<id>`, etc. — the target portal is derived from the current URL, not hardcoded, so this works the same from any portal that has a Directory)

---

## Admin: User Management

`/admin/users` (eboard only) shows real member data — search, group filter, profile-complete filter, refresh button. Each member's group is an editable dropdown right on their row: picking a new value calls Authentik directly to move them there, then updates immediately (no waiting for their next login) — see [Operations: Changing a Member's Group](../operations/member-management.md#changing-a-members-group). There is still **no way to remove/deactivate a user from this page** — member removal remains an Authentik-side operation (see [Member Management](../operations/member-management.md)), not something the website UI does.
