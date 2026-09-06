---
sidebar_position: 4
---

# Profiles & Directory

## Usernames

`UsernameEditor.jsx` lets members rename their account from Settings through `PUT /users/me/username`. This changes their Authentik login identifier as well as the application display value.

The API writes Authentik first, then Postgres. A failed mirror can be repaired by later synchronization. Profile updates do not write `username` from an older access token.

Validation allows 3 to 32 characters from `[a-zA-Z0-9._-]`. Authentik service-account permissions must allow user changes. A collision returns `409`; an upstream failure returns `502`.

The Server Action returns expected failures as `{ error }` so production React error masking does not replace the explanation. Username saving is separate from the profile form.

Application identity and foreign keys use `authentik_id`. Historical audit/report labels may retain the name recorded at the time. Rename operations are audited.

## What you're doing now, and your own links

`doing_now` is an optional free-text line, commonly used for alumni work or study. The API validates it for every role even when a particular form does not display it.

Members can add up to five labeled web links. Incomplete rows return a row-specific error; empty unfilled UI rows are omitted.

Both fields can appear on the public roster for eligible members. Public cards check links with `safeExternalHref()` before rendering; rejected URLs produce no chip. Write-time validation and rendering checks both matter for older stored rows.

## Pronouns

The profile form offers common presets and a Custom field. The API accepts optional text up to 40 characters rather than limiting values to the presets. No answer stores null and renders nothing.

Pronouns are portal-only. Public roster queries must omit them, including direct public member lookups. `test/pronouns.test.js` checks the projections.

### Eboard's edit modal renders the field because it must

`PronounsField.jsx` is shared with `AdminEditProfileModal`. The admin profile write replaces all profile fields, so the modal must retain existing pronouns and other values while editing unrelated fields.

## Birthdays

Directory responses expose only month and day:

```sql
TO_CHAR(dob, 'MM-DD') AS birthday
```

The raw birth date is not included in ordinary directory projections. Public roster queries expose neither `dob` nor `birthday`. Missing birthdays render no row.

Formatting in SQL avoids converting a calendar date through UTC. Website `formatBirthday` builds a label from separate month/day values without parsing the stored string as a timestamp.

## Traits

Eboard can assign up to six string captions, each up to 80 characters. `CaptionPill` renders them alongside role information in the directory and public roster.

Migration `1788200000000` converted the former label/value objects into strings. `traitText()` also handles legacy objects so they are not passed directly as React children.

Traits are display text, not permission-bearing roles. They use the eboard-only `PUT /admin/users/:id/traits` endpoint and are not accepted as ordinary profile fields.

The admin Save operation writes traits before the profile. A rejected trait therefore prevents the later profile write, but the two requests are not a transaction.

## Choosing not to be on the public roster

**Settings → Public Roster** controls public listing eligibility. Eligible profiles are included by default unless opted out.

Opting out removes the profile from public list/detail access and prevents the public media route from serving its picture. It does not remove the profile from the authenticated member directory.

## Profile pictures

Settings and onboarding use the shared profile-picture control. Selecting a file starts upload independently of the profile Save button.

Accepted formats are JPEG, PNG, WebP, HEIC/HEIF, AVIF, GIF, and TIFF, up to 25 MB. The server creates a resized JPEG. See [Profile-picture upload](../api/endpoints.md#put-usersmeprofile-picture) for processing and decoder limitations.

The website proxies pictures through `/api/users/:id/profile-picture/media`. Missing images return `404` and display initials. Existing portal components use an image error handler for fallback; follow that pattern when adding an avatar.

A picture is one of the public-roster eligibility requirements, alongside the other roster filters.

### Picture updates and caching {#changing-a-picture-updates-it-everywhere-and-that-took-work}

`lib/avatar.js` versions avatar URLs with the asset ID, which changes on upload. This refreshes changed pictures without adding a new timestamp on every render.

API projections that support avatars need the version field. An upload also broadcasts the profile-picture-changed event so persistent layouts can refetch the current profile and update their avatar.

## The profile form

`components/profile/ProfileForm.jsx` serves onboarding and Settings. The separate admin modal shares `buildProfilePayload` and API validation but uses a different route and field visibility.

Key input rules:

- Onboarding relies on the enrollment email already synchronized to the account. Settings can edit it.
- `formData.has('email')` distinguishes an omitted input from an explicit clear. Non-alumni required-email validation can use a stored address when the key is absent.
- Configure enrollment email collection before omitting it from onboarding; otherwise a required value may have no visible input.
- Graduation is a season and four-digit year, not a timestamp.
- Birth date is sent as `YYYY-MM-DD`.
- `minors`, `gpa`, and `heard_from` appear on the rushee form. Hidden inputs are omitted so later member edits preserve recruitment data.
- Admin writes replace all profile fields, so the admin modal includes recruitment fields for every target role.

`formatGraduationDate` checks legacy ISO input explicitly and otherwise preserves the stored semester string. Passing `Fall 2027` to a permissive date parser can produce January instead.

Expected profile errors return structured results from the Server Action and can identify the field. See [Profile validation](../api/endpoints.md#put-usersmeprofile).

## Member Directory

`MemberDirectory.jsx` is shared by portal directory pages. It loads member information, supports group tabs, and opens a profile modal.

LinkedIn URLs are validated on write and through `linkedinHref()` before rendering. Public links are part of the intended roster projection, while private contact/profile fields remain excluded.

### Group tabs and cards {#a-tab-bar-over-a-grid-of-profile-cards-2026-08-11}

`MEMBER_GROUP_ORDER` defines Eboard, Chairs, Members, Pledges, Alumni, and Rushees. Empty groups have no tab. `chosenGroup` is a preference; the displayed group falls back to an existing tab if data changes.

Counts follow the visible group and search. Chapter-member totals exclude rushees.

#### The card

Cards show a name and available photo, username, major, pledge class, and role information. Missing optional fields are omitted. The group tab supplies context without repeating the same group badge on every card.

Initials use a deterministic gradient from `lib/seed.js` so the same profile has a consistent appearance. Role text uses the portal accent.

#### Group colours that survive dark mode

`readableGroupText(hex, dark)` adjusts lightness and saturation for the current theme while retaining group hue. Tabs include a colored dot even when inactive; profile group badges use the same color treatment.

#### Search, sort, and the phone

Search filters names and usernames within the active tab. Tabs are derived from unfiltered data so typing does not remove navigation. Sorting uses last name in either direction.

On narrow screens, tabs use scrolling, snap points, edge fades, and chevrons. Fades use the panel's card color.

`getMemberDirectoryWithRushees` combines the ordinary member list and a separate rushee request. If the rush request fails, the ordinary directory can still render; framework redirects must propagate.

The profile modal offers eligible actions:

| Action | Behavior |
| --- | --- |
| Email | Shows available addresses and opens a mail link |
| Message | Opens the current portal's DM path |
| Meeting | Opens the meeting form where allowed |
| Report | Files a profile report |
| Block | Applies the caller's block |

Report and Block are hidden on the caller's own profile.

For alumni, directory SQL masks the stored UGA-email field and uses personal email. The stored UGA value is retained for administrative correction. This is keyed to resolved `member_group`, not merely the presence of `alumni` among raw token groups.

## Admin: User Management

`/admin/users` supports search, role and profile-completion filters, and refresh. A search spans groups and renders results together rather than hiding matches behind the active group tab.

Inline controls change:

- **Group:** Authentik first, then stored application role. Existing token claims may remain older until refreshed.
- **Exec role:** application role ID and copied label, without an Authentik call.

### Exec roles

Load `GET /admin/exec-roles?includeInactive=1` once for the page. Retired roles stay visible for their current holders but are omitted from new-assignment choices.

The manager can create, rename, reorder, retire, and delete roles. Renaming updates holders' copied titles. Deleting an assigned role returns `409`; retiring retains assignments. Slugs are stable and not editable.

UI holder counts derive from the loaded users. Unmatched legacy `exec_title` text appears as a disabled "Typed as" option until a stored role is selected.

Account removal remains an Authentik operation; the page does not deactivate or delete login accounts.

### Editing someone else's profile

`AdminEditProfileModal` edits the selected user's fields rather than using the editor's session role to choose inputs.

- Username has its own save action.
- Pictures upload on selection; removal clears the profile reference while retaining the asset for review.
- Deleted/anonymized accounts return `404`.
- All profile fields must be retained because this route replaces the row's editable fields.
- UGA Email remains visible to the administrator even for alumni.
- Profile changes are recorded in the activity log.

The modal shares payload construction and validation with the member form, not its session-dependent presentation. See [Admin profile updates](../api/endpoints.md#put-adminusersauthentikidprofile).
