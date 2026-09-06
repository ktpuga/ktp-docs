---
sidebar_position: 1
---

# Overview

`uga-ktp-website` serves [ugaktp.com](https://ugaktp.com), including the public site and authenticated portals. It uses Next.js 16 with the App Router, Turbopack, Tailwind, and shadcn/ui. Portal data comes from the separate `ktp-api` deployment. See [API Overview](../api/overview.md).

## Portals

The website chooses a portal from the user's Authentik groups, in this order:

| Group | Portal |
|---|---|
| `eboard` | `/admin` |
| `chair`, `active` | `/member` |
| `alumni` | `/alumni` |
| `pledge` | `/pledge` |
| `rush` | `/rushee` |

A user with both active and alumni groups lands in the member portal. `proxy.ts` redirects users who visit a different portal and handles profile-completion routing. API authorization remains separate from these website redirects. See [Auth & Onboarding](../authentik/overview.md).

All five portals use `PortalShell` for navigation, theme controls, the profile card, and sign-out.

The alumni portal has a smaller navigation menu: dashboard, announcements, directory, contact sheet, files, messages, and settings. It was restored in September 2026; the former redirects to `/member` have been removed.

### Portal preview: eboard viewing a portal as a member

From **Admin → Settings → View a portal as a member**, eboard can preview a group's QA account.

The website sends `X-View-As: <authentik_id>`. After validating the real caller's token, the API applies these checks:

| Check | Requirement |
|---|---|
| Caller | Eboard |
| Target | A database row with `is_test_account = true` |
| Method | `GET` or `HEAD` |

The API then replaces `req.user` with the QA account and retains the real caller in `req.realUser`. Existing audience and ownership queries run against that account. This shows the QA account's data and memberships, which may differ from an individual member's.

`applyViewAs` runs in both `requireAuth` and `optionalAuth`, including the public event routes. An anonymous request on an optional-auth route stays anonymous. An authenticated non-eboard caller cannot use the preview header.

The target predicate is checked in SQL. A real-member target and a nonexistent target both return 404.

The `ktp_view_as` cookie identifies the target; it does not authorize access. The API checks the real caller on each request, and `proxy.ts` only honors the cookie for eboard sessions. Exiting preview clears the preview cookies. The root-layout banner identifies the active preview on every page.

#### Rendering the previewed account {#the-browser-has-to-render-as-the-previewed-account-too}

`usePortalViewer()` in `lib/use-portal-viewer.js` returns `{ groups, authentik_id, isPreview }`. Components use it for group-based controls and ownership checks instead of reading the real session directly.

The `ktp_view_as_group` cookie supplies the preview group and uses the API's chair-implies-active expansion. These client values affect rendering only. The sidebar uses the fetched QA profile and avoids falling back to the real user's session while previewing.

The hook reads cookies in an effect, so the first paint can briefly show a control for the real user's groups. API permissions still apply.

#### Preview interactions {#everything-is-clickable-only-writes-are-inert}

`PreviewGuard` allows navigation, tabs, and modals. It blocks write controls marked `data-preview-block` and displays “Preview only. Nothing was saved.”

The guard handles clicks, changes, and form submissions. `data-preview-allow` exempts the Exit form. Message composers use `data-preview-block-enter` to block plain Enter-to-send while allowing Shift+Enter and IME composition.

Every authenticated fetch in `lib/portal-api.js` must include `previewHeader()`, including direct fetches for multipart uploads, messages, profiles, and interview notes. Otherwise, the API sees the real account without knowing that preview is active and may accept a write as that account.

The API rejects non-GET/HEAD requests that carry the preview header. A missing UI marker can therefore produce an error, but a missing request header bypasses that preview-specific check.

Automatic conversation-read, group-read, committee-seen, and notification-seen writes are dropped by `apiRequest` while previewing. Reading a preview should not change its unread state.

### Accent colors

Member, pledge, and rush use blue. Alumni uses amber. Admin supports a red/blue preference stored per browser as `ktp-admin-accent`.

`PortalAccentProvider` publishes the palette through `useAccentPalette()`. Shared palette definitions live in `components/portal/PortalAccentContext.jsx`. Each layout supplies its own navigation and `homeHref` separately from its accent.

Member-group badges and destructive controls keep their semantic colors regardless of the portal palette.

## Shared features across portals

Features share components and API routes, but navigation and permissions differ by portal:

| Feature | Behavior |
|---|---|
| Dashboard | Upcoming content, recent activity, and links appropriate to the portal |
| Calendar | Audience-filtered events, RSVP, and permitted meeting/interview entries |
| Committees | Membership requests, approvals, member management, and scheduling |
| Polls | Single- or multiple-choice voting, audience targeting, optional closing time |
| Files & Photos | Albums, documents, and external links |
| Messages | Direct messages and group chats |
| Directory | Profile cards grouped by member role |
| Meetings | Invitations with accept/decline responses |
| Calendar subscription | A personal feed for an external calendar |
| Settings | Profile editing, account controls, and applicable preferences |

Rush has its own dashboard and restricted feature set. Pledges have no Committees route. Alumni navigation omits committees, meetings, polls, tickets, and calendar.

Admin also provides analytics, user management, rush management, oversight, and homepage media. Events are created and edited from the calendar. Homepage Media separates website content from the iOS slideshow.

See [Messaging](./messaging.md), [Meetings](./meetings.md), [Profiles & Directory](./profiles-and-directory.md), [Photos & Documents](./photos-and-documents.md), and [Notifications](./notifications.md) for details.

## Attendance

Events can enable QR-code attendance:

1. The organizer enables attendance on the event.
2. Eboard or the event's creator opens the attendance roster and displays the QR code.
3. A member scans it and opens `/checkin/[eventId]/[token]`.
4. The website calls a Server Action, which sends the user's bearer token and attendance code to the API.
5. The page displays success or the returned error. Organizers can also mark people present, excused, or absent manually.

The event check-in window opens 30 minutes before the start and closes 30 minutes after the end. The HMAC code rotates every 10 seconds; the API accepts the current and previous periods. A particular code therefore has about 10 to 20 seconds of validity. A recent photo can still work within that interval.

Authentication can fail before the attendance controller runs. An authenticated website session does not by itself prove that the API access token is valid. See [Sign-In Flow](./sign-in.md) for token refresh and session handling.

### Scanning while signed out

The check-in page sends an unauthenticated visitor to `/login?next=/checkin/…` and returns them after sign-in. The original attendance code may have expired during login, requiring another scan of the live QR code.

`lib/next-path.js` accepts only the supported `/checkin/<id>/<code>` return-path shape. Unsupported values fall back to normal portal routing. Add explicit patterns if another return destination is needed.

### Filtering the roster, and the CSV

The API orders the roster by status: present, excused, not marked, then absent, with names alphabetical within each group. The website polls for updates.

Group filters operate on the fetched roster. Counts and CSV exports reflect the selected groups, and the UI also shows the full roster size. Export filenames include the filter. The filter clears when switching events.

CSV columns are `Name, Group, Status, Checked In, Recorded`. Recorded is Self (QR), Manual, or blank for an untouched row.

Names and groups come from the roster's saved `display_name` and `member_group` values. Later profile edits, role changes, or account deletion do not rewrite those historical values.

The Attendance tab appears for chairs in `/member` and eboard in `/admin`. Other users check in through the QR page. API checks determine which events an organizer can manage.

See [API: Attendance](../api/endpoints.md#attendance).

## Public roster (`/members-list`)

The public chapter page reads [`GET /roster`](../api/endpoints.md#roster-public), separate from the authenticated directory.

Eligible eboard, chairs, active members, and alumni appear with public profile fields. The response excludes contact details such as email and phone, as well as major, date of birth, and pledge class.

Pledges, rush accounts, incomplete profiles, test accounts, profiles without a photo, and users who opted out are excluded. For a missing member, check both eligibility and public-roster preference. See [Profiles & Directory](./profiles-and-directory.md).

## Safety & Moderation

- **Reports:** Profiles, messages, and photos can be reported to the eboard moderation queue.
- **Blocking:** Users can block or unblock other users. Blocking prevents direct-message exchange and hides blocked users' messages from the blocker's views. It does not remove someone from a group chat.
- **Blocked list:** Settings shows the list when the user has blocked someone.
- **Moderation:** Eboard reviews open and historical reports in `/admin/oversight`, with resolution notes.
- **Rate limits:** Direct and group message sends are limited to 20 per minute per user on their respective routes.
- **Account deletion:** The self-service action anonymizes the API profile and signs the user out. Shared history remains associated with a deleted user. Authentik account administration is a separate operation.

`/privacy` and `/community-guidelines` are public and linked from the footer and Settings. Their documented review status is draft pending chapter review.

See [Reports & Moderation](../api/endpoints.md#reports--moderation) and [Messaging](./messaging.md). The current API has no profanity filter.

## Committees

Committee membership lives in Postgres, separate from Authentik role groups.

Eligible members can browse committees, request membership, and leave. A pending request grants no membership access. Eboard or the committee's chair approves requests and can remove members. Eboard creates or deletes committees and assigns chairs.

Membership can grant access to committee-restricted content and group chats whose audience references the committee. It does not create a separate linked chat automatically.

A committee chair can schedule a private meeting request or a committee event with attendance. See [Meeting or event](./meetings.md#meeting-or-event-the-committee-page-offers-both).

Pledge-committee designation also controls rush-data access. Interview management and note permissions have additional rules; see [Interviews](./interviews.md).

## Dark mode

`PortalThemeProvider` and `ThemeToggle` control the portal theme. Components use Tailwind `dark:` variants.

## Loading skeletons

`PortalDashboard.jsx` uses `auto-skeleton-react` to derive placeholders from the dashboard markup while data loads. `data-no-skeleton` excludes decorative elements.

The sidebar user block and dashboard name use smaller `animate-pulse` placeholders.

## Local development

```bash
npm install --legacy-peer-deps
npm run dev
```

The install flag accommodates the manifest's React peer-dependency mismatch. Production uses the same flag. See [Next.js 16 migration](./nextjs-16-migration.md).

Use `.env.example` for the complete variable list:

| Variable | Purpose |
|---|---|
| `AUTH_URL` | Local website origin, usually `http://localhost:3000` |
| `API_URL` | API deployment to use; choose the local/test API for development that writes data |
| `AUTH_SECRET` | A local secret, generated with `openssl rand -base64 32` |
| `AUTHENTIK_CLIENT_ID` / `AUTHENTIK_CLIENT_SECRET` | Credentials for the configured OIDC provider |

The provider must allow the local callback URI. A remote public API is reachable without LAN access, but requests still affect that deployment's data.

## Common gotcha: stale `.next` build cache

After branch switches or merges, missing generated modules or decompression errors can come from inconsistent `.next` output. Stop the development server, remove its generated build directory from the website repo, and restart:

```bash
rm -rf .next
npm run dev
```

PowerShell equivalent:

```powershell
Remove-Item -Recurse -Force .next
npm run dev
```

If the error remains after rebuilding, investigate it as a code or dependency issue.
