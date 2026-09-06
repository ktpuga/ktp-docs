---
sidebar_position: 6
---

# Rush Portal

The prospective-member portal lives at `/rushee`. Rushees can read rush announcements, RSVP to events, check in by QR code, vote in polls, message leadership, and sign up for interviews.

`/rush` is the public page with the schedule, FAQ, and signup information. Keep its routes outside the authenticated portal layout. `proxy.ts` matches `/rushee`, not `/rush`.

## Why it exists

The portal keeps signup details, event attendance, and interview information attached to each candidate's account. Internal chapter content remains subject to API permissions.

## What rushees can and can't reach

`ktp-api/constants.js` defines the two main route-level group lists:

| Constant | Groups | Routes |
|---|---|---|
| `SHARED_ALBUM_GROUPS` | active, chair, alumni, eboard, pledge | Photos, documents, albums, committees, member directory |
| `RUSH_ACCESSIBLE_GROUPS` | Those groups plus rush | Announcements, polls, messages, reports |

Rushees can report content because they can receive messages. Being authenticated alone does not grant access to member routes.

## Access rules {#three-things-this-changed-elsewhere}

### Member directory {#the-member-directory-got-a-gate}

`routes/members.js` requires both authentication and a group in `SHARED_ALBUM_GROUPS`. Public self-registration means that an authenticated account may belong to someone who has not joined the chapter.

### Rushees message leadership only

`GET /members/leadership` returns eboard and chairs with a reduced set of fields, excluding email, phone, major, and pledge class. The rush message picker uses this list.

`messagesController.sendMessage` also checks the recipient server-side. Hiding recipients in the UI does not prevent a caller from submitting another ID.

### Untargeted content is hidden from rush

For announcements, polls, and events, a null audience means all member groups. A rush-only account does not see that content. The visibility queries check whether the caller holds a member group, so someone with both `rush` and `pledge` still receives member access.

The poll audience picker includes Rushees, but `rush` is absent from `DEFAULT_AUDIENCE`. Albums and document folders omit the Rushee option because those routes do not admit rush accounts.

Keep static role lists such as `ROLES` at module scope and declared before use.

## The interest form

The interest questions appear in the rushee profile builder at `/rushee/settings` and during first-login profile completion at `/complete-profile`.

Most answers use existing profile columns. Migration `1788700000000` added:

| Column | Type | Question |
|---|---|---|
| `users.minors` | `TEXT` | Minor(s) and Certificates? |
| `users.gpa` | `NUMERIC(3,2)` | GPA |
| `users.heard_from` | `TEXT` | How did you hear about KTP? |

“Your Major(s)” uses the existing free-text `users.major` field. The account's `created_at` supplies the submission timestamp.

### Form visibility and stored data {#the-fields-are-rushee-only-on-the-form-and-universal-in-the-column}

These columns exist on every user row. `ProfileForm` decides when to show the rush inputs; API validation applies whenever the fields are submitted.

`buildProfilePayload` uses `formData.has()` to omit fields that are absent from the form. The self-service profile endpoint leaves omitted values unchanged. This preserves a rushee's answers when their role changes and their new settings form no longer shows the questions.

The admin profile endpoint performs a whole-row update. `AdminEditProfileModal` therefore renders all three fields for every user so an unrelated edit does not clear them.

### GPA is a string in JSON

node-postgres returns `NUMERIC` as text, so GPA is represented as `"3.75"`. Validation also returns a string. More than two decimal places are rejected instead of relying on database rounding. The maximum is 5 to allow weighted secondary-school GPAs.

## Resumes

The resume card appears below the interest form in rushee settings. The candidate, eboard, and authorized pledge-committee members can read the file through the resume endpoint.

| Operation | Details |
|---|---|
| Upload, replace, remove | `PUT` and `DELETE /resumes/me` |
| Read | `GET /resumes/:id` |
| Accepted formats | PDF, DOC, DOCX |
| Maximum size | 10 MB |
| Storage | API disk, `uploads/resumes` |

The profile opens a resume modal. PDFs are previewed inline; Word files are downloaded, with an explanation in the modal.

### Resume columns {#four-columns-on-users-not-a-table}

Each user has one resume. The four columns on `users` hold the storage path, original filename, MIME type, and upload timestamp. `resume_path` identifies the stored file and is excluded from client-facing profile projections.

Replacement, removal, and account anonymization return the old path so the caller can unlink the file. The model uses a `WITH previous AS (...)` CTE to retain that path when updating the row. Clearing the columns alone would leave the file on disk.

### Upload permissions {#why-uploading-is-not-gated-on-being-a-rushee}

Any authenticated user may upload their own resume. The settings card is shown when the stored `member_group` is `rush`. The profile form separately uses session groups to choose its fields.

This distinction matters after a role change: Authentik may temporarily retain an older group, while `findRusheeById` uses the stored `member_group = 'rush'` to identify candidates for committee access.

### Response headers {#these-bytes-come-from-outside-the-chapter}

The API sets these headers, and `app/api/resumes/[id]/route.js` forwards them:

- `X-Content-Type-Options: nosniff`, to prevent MIME sniffing.
- `Content-Security-Policy: sandbox`, to restrict document behavior in supporting browsers.

A database constraint limits `resume_mime` to the accepted types, alongside the upload filter. Preserve the headers when changing the website proxy.

## Rushee Data: the table that replaced the response sheet

`components/rush/RushInterestTable.jsx` serves two routes:

| Route | Audience |
|---|---|
| `/admin/rushees` | Eboard |
| `/member/rush-data` | Pledge committee |

Both include a Presentation tab and link to a per-candidate profile at the corresponding `/[id]` route. See [Interviews](./interviews.md#the-presentation-write-up).

### Events attended

The profile lists events with a present attendance record, oldest first. Excused, absent, and unmarked rows are omitted.

An empty list is not proof that the person attended nothing. Attendance may never have been recorded, or the candidate may not have been included in an event's roster. The UI explains this limitation. See [the endpoint](../api/endpoints.md#get-rush-dataid).

The two website routes accommodate the portal routing rules. The API enforces access using database committee membership; the JWT does not contain that membership. `useRushDataAccess` asks `GET /rush-data/access` to decide whether to show the navigation entry.

### How the pledge committee gets in

Eboard designates the committee by setting `committees.slug = 'pledge'` from its detail page. Access depends on this stable slug, not a match against the committee name.

Only eboard can change the designation. A partial unique index allows at most one pledge committee, and designating another moves the role. If none is set, the committee list shows eboard a warning and committee-based rush access is unavailable.

Migration `1789000000000` replaced the older `can_view_rush_data` flag with this shared committee identity. The old column remains unused; the former `PUT /committees/:id/rush-data-access` endpoint has been removed.

### The export

Export CSV uses the data already fetched and includes only rows matching the current filter.

`lib/csv.js` handles UTF-8 BOM output, CRLF line endings, CSV quoting, and spreadsheet formula protection. Values beginning with formula or control characters receive a single-quote prefix before CSV quoting. Quoting a cell alone does not prevent spreadsheet formula interpretation.

The table displays 8 of the 13 exported columns. Submission date, preferred name, personal email, phone, and date of birth are export-only; the table footer explains this.

## Rush announcements are a separate table

Rush announcements use `rush_announcements` rather than sharing rows with internal announcements. Members and rushees can read them; eboard and chairs can write them.

Events use audience targeting in the existing `events` table. Their attendance records, tokens, check-in windows, and notifications rely on the shared event ID.

## Signup

See [Rush Signup](./rush-signup.md).

## Rushees in the member directory

The directory groups profiles into tabs. Rushees appear in their own tab, separate from initiated members.

`memberModel.findAll` returns rush rows only when the caller is allowed to see them and explicitly requests `?group=rush`:

```js
if (!includeRush || groupFilter !== "rush") {
  sql += ` AND member_group IS DISTINCT FROM 'rush'`
}
```

All member groups are included in `RUSH_VISIBLE_TO`. A caller without access receives an empty list; individual lookups return 404.

Leadership's message picker makes a second `?group=rush` request and merges those results with the regular member list. Other people pickers that need to include candidates must request them explicitly too.

### Tab visibility {#the-rushees-tab-appears-and-disappears-on-its-own}

The directory shows tabs only for groups returned by the API. `getMemberDirectoryWithRushees` makes the separate rush request, so an empty rush result means there is no Rushees tab. This depends on the stored roster, not a seasonal timer.

The older separate rushee-directory pages and `useRushCount` hook have been removed. `GET /members/rush-count` remains in the API but has no website caller.

The Rushees tab omits pledge class and displays a signup count. Keep the role lists in `MemberDirectory` and `UserManagementPage` aligned with `constants/roleGroups.js` when adding a role.

Authorized member viewers can see candidate contact details. The reverse lookup, `GET /members/leadership` for rush accounts, exposes fewer fields.

`users.about_me` supplies a self-introduction for any member group. The profile endpoint truncates it to 600 characters.

## The public "How Rush Works" page

`/rush/how-it-works` is public. Its four steps live in `RUSH_STEPS` in `app/rush/rush-content.js`:

1. Create an account and sign in.
2. Attend events and meet members.
3. Use the Interviews tab when a schedule is available.
4. Check for an update from leadership.

Bids are sent manually through messages; there is no separate automated bid system.

The page is linked from `/login` and fetches `getPublicRushSignup()` on mount. Open signup shows the signup link. Closed signup, including a failed status request, shows the closed state with links to the rush page and Instagram.

For an authenticated visitor, the button reads **Sign out to sign up** and calls `logoutEverywhere()`. The page waits for `useSession()` to resolve before showing either button. This avoids offering a new-account link while an existing website session is still being loaded.

Direct QR links may bypass this page, so the guard at `/auth/start` must also handle an existing session. See [Two sessions in one browser](./sign-in.md#two-sessions-in-one-browser).

## Targeting rushees {#targeting-rushees-the-thing-that-catches-people-out}

Select Rushee in an event's audience picker when rushees should see it. An unset audience means all member groups.

Push recipient selection must follow the same audience rules as the content query. An untargeted event should not send its title to rush-only users who cannot open it.

Visibility queries use the caller's group array, while notification recipient queries use the stored `users.member_group`. Keep role synchronization and multi-group behavior in mind when changing either query.

## Portal notes

- Member, pledge, and rush portals use blue. Alumni uses amber; admin has a per-browser red/blue preference.
- `RushDashboard` avoids member-only requests made by `PortalDashboard`.
- Isolate optional member-only requests in shared components. A rejected request inside a bare `Promise.all` can discard otherwise valid rush data.
- Rushees have no Attendance tab. QR check-in opens `/checkin/[eventId]/[token]` outside the portal.
- Rushees use Interviews instead of Meetings. The meetings API does not admit rush accounts.
- `EventsCalendar.loadCalendarItems` catches failures for its additional meeting and interview sources separately, preserving the event calendar if either source is unavailable.
