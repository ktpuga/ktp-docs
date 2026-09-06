---
sidebar_position: 13
---

# Sign-In Flow

The website has separate entry paths for a general portal visit, enrollment, and account switching. Each must handle both the website session and Authentik's browser session.

## Two entry points, and the difference matters

| Route | Behavior without a website session |
| --- | --- |
| `/login` | Probe for an existing SSO session with `prompt=none` |
| `/auth/start` | Start ordinary interactive-capable sign-in |
| `/login?switch=1` | Request `prompt=login` to choose credentials again |

Enrollment uses `/auth/start` because a new account may need first-time consent. A silent probe cannot complete a flow that requires interaction.

Both entry pages show a chooser when a healthy website session already exists.

## Two sessions in one browser

| Session | Established by | Ended by |
| --- | --- | --- |
| Website JWT cookie | NextAuth sign-in | Website sign-out or expiry |
| Authentik SSO cookie | Authentik sign-in or enrollment | Authentik logout flow |

Clearing one does not prove that the other ended. A refresh token also does not identify which account currently holds the browser's Authentik session.

The documented deployment uses `ktpapp-invalidation` to end the Authentik session and return to the website:

| Recorded flow | Stages | Recorded behavior |
| --- | --- | --- |
| `default-provider-invalidation-flow` | No user-logout stage | Application logout could leave SSO active |
| `default-invalidation-flow` | User logout | Ends SSO but returns to Authentik |
| `ktpapp-invalidation` | User logout, then redirect | Ends SSO and returns to `https://ugaktp.com/` |

These observations came from the deployed Authentik version investigated in August 2026. Recheck its configuration after upgrades rather than assuming every default flow has the same stages.

The investigation also found that Authentik 2026.2 did not use the outgoing `post_logout_redirect_uri` or `id_token_hint` to choose the logout destination. The configured Redirect stage supplied it. The website still sends standard logout parameters.

### Building the `ktpapp-invalidation` flow

The documented configuration is:

1. Create a Redirect Stage named `ktpapp-invalidation-redirect`, mode Static, target `https://ugaktp.com/`.
2. Create an Invalidation flow with slug `ktpapp-invalidation` and Authentication set to No requirement.
3. Bind the existing `default-invalidation-logout` stage at order 0.
4. Bind the redirect stage at order 10.
5. Select this flow as the `ktpapp` provider's Invalidation flow.

Logout must run before the redirect. Keeping this in a provider-specific flow avoids changing the destination for every application using the brand default.

Verify by signing out and opening Authentik directly. If its authenticated session remains, inspect the selected flow and stages.

### Three Authentik settings with "logout" in the name

| Setting | Purpose |
| --- | --- |
| Provider Invalidation flow | Logout behavior and flow stages |
| Provider Redirect URIs | Allowed sign-in callbacks |
| Backchannel logout URI | Server endpoint receiving logout notifications |

The website does not implement a backchannel logout receiver. Do not point that setting at a normal page.

`logoutEverywhere` skips the Authentik round trip when no ID token is available. This avoids a recorded end-session path that could send an already signed-out browser to a login form. The guard does not prove the SSO session ended.

### The chooser

`components/auth/AlreadySignedIn.jsx` identifies the current website account and offers:

- **Continue to my portal**, linking to `/auth/redirect`.
- **This isn't me**, submitting `switchAccount`.

It is a Server Component with a form action, so action redirects are handled by the framework.

This matters on shared browsers: enrollment can establish a new Authentik session while an older website session remains. Automatically choosing the older website cookie could open the wrong person's portal.

### Switching accounts {#switchaccount--and-why-it-is-not-logouteverywhere}

`switchAccount()` in `lib/auth-actions.js` clears the website cookie and redirects to `/login?switch=1`. That path requests `prompt=login` instead of silently reusing Authentik's session.

It does not call `logoutEverywhere`. Switching the application account and ending the identity-provider session are separate operations.

### Where each guard sits

| Entry | No healthy website session | Healthy website session |
| --- | --- | --- |
| `/login` | Silent probe unless suppressed | Chooser |
| `/login?switch=1` | Full sign-in with `prompt=login` | Switch action normally cleared it first |
| `/auth/start` | Ordinary sign-in | Chooser |
| `/rush/how-it-works` | Signup information/link | Sign-out-before-signup action |

Printed signup QR codes go straight to Authentik. Their return path must retain the `/auth/start` guard; the explainer page is not guaranteed to have been visited.

The explainer waits for session resolution before showing its signup action so a faster status request does not briefly expose the wrong branch.

### Refreshing group claims {#stale-groups-were-the-other-half-of-roles-get-messed-up}

`refreshAccessToken()` updates groups and the stored ID token when the token endpoint supplies refreshed claims. Missing claims retain their previous values rather than clearing membership.

The refresh helper decodes the ID token received directly from the token endpoint. That helper is not a general verifier for browser-supplied input and must not be reused as one.

Role changes can therefore reach a session on refresh, but stored application data, current token claims, and Authentik membership remain distinct states to inspect when diagnosing a mismatch.

## The silent probe

`SilentSignIn` requests:

```js
signIn('authentik', { callbackUrl: '/auth/redirect' }, { prompt: 'none' });
```

The provider can return a code when no interaction is needed, or an error such as `login_required` or `consent_required`. The page then offers manual sign-in and rush information.

### Manual fallback {#why-every-failure-mode-is-safe}

The probe is optional. A six-second UI timeout reveals manual controls if navigation does not complete. Network errors, consent requirements, and unavailable JavaScript must not leave the visitor with only a spinner.

## Telling "no account" apart from "sign-in broke"

Auth.js can report `OAuthCallbackError` for both a failed silent probe and a failed user-requested login. `lib/sso.js` uses a short-lived `ktp_sso_probe` cookie to distinguish those paths.

The probe marker uses SameSite Lax and a 120-second lifetime so server-rendered `/login` can read it after the redirect. `SignInButton` clears the marker before manual sign-in, allowing a subsequent failure to show an error banner.

A failed probe does not establish that the person has no account; it means silent sign-in did not complete.

## The things that would loop

Auto-start is suppressed for:

- An error query parameter.
- The `ktp_signed_out` cooldown cookie.
- Account-switch mode, which uses its own interactive path.
- A healthy website session, which shows the chooser.

The signed-out cookie is HTTP-only and lasts 120 seconds.

`takeAutoSignInSlot(name)` uses separate `probe`, `start`, and `switch` slots with a 30-second cooldown. Sharing one slot could let an earlier probe suppress the sign-in immediately following enrollment.

A cooldown renders **Try signing in again** instead of redirecting automatically to another entry page. That gives the visitor a way out of a redirect cycle.

A completed sign-in clears `token.error`. Otherwise proxy handling of an old error could reject a freshly established session.

## Sign up for rush

`/login` links to `/rush/how-it-works` rather than directly to an invitation. The explainer handles open and closed signup states and can show the appropriate next step. See [Rush portal](./rush-portal.md#the-public-how-rush-works-page).

## Visitor states {#what-a-visitor-actually-sees}

| State | UI |
| --- | --- |
| Probe running | Progress indicator, followed by manual fallback if needed |
| Healthy website session | Account chooser |
| Probe did not complete sign-in | SSO button and rush information |
| Manual sign-in failed | Sign-in controls with an error banner |
| Just signed out | Confirmation and manual controls |
| Account switch | Interactive sign-in |

## Where a new account lands

Invitation URLs built by `services/authentikAdmin.js` carry a return destination to `/auth/start`.

On a browser without an older website session:

```text
Enrollment -> /auth/start -> ordinary SSO -> /auth/redirect
  -> /complete-profile when required -> portal
```

With an existing website session:

```text
Enrollment -> /auth/start -> account chooser
  -> switchAccount -> /login?switch=1 -> interactive SSO
  -> profile completion or portal
```

The chooser does not independently compare the Authentik account with the website cookie. It asks the person to confirm the visible account instead of treating any existing session as the intended identity.

`/auth/redirect` sends session-less visitors to `/auth/start`, preserving older printed invitations that return through that route. Verify the enrollment return URL against the deployed Authentik flow; a rejected external destination can leave the visitor on Authentik.

## Attendance refresh and cookie persistence

Check-in and officer QR-code Server Actions use server-only `getActionAccessToken`. It invokes Auth.js's writable session update, persists replacement cookies including chunked sessions, and reads the bearer from the updated cookie jar. The JWT callback owns refresh and deduplication; access and refresh tokens are not exposed in browser session JSON.

This fixes a reproduced mismatch where `auth()` refreshed internally but a later `getToken` read the old bearer from incoming headers. The installed no-argument `auth()` path did not forward its internal Set-Cookie response.

The accessor is for writable Server Actions/Route Handlers, not Server Component rendering. Other shared portal helpers retain their existing path. Run `scripts/test-attendance-auth.cjs` after Auth.js upgrades because the integration uses `unstable_update`.

Missing/failed sessions and API `401` responses redirect check-in to login with an allowlisted return path. An attendance code may expire during login; authentication does not extend its validity. Normal `403` refusals reach the check-in screen as messages. Unexpected failures return a safe message with an attempt reference.

Correlated website/API `[checkin_attempt]` records distinguish credential, transport, attendance-rule, and write failures. Current callbacks refresh on imminent expiry or claims older than three minutes when invoked. A one-hour provider lifetime alone does not establish that the historical incident is resolved.
