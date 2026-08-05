---
sidebar_position: 13
---

# Sign-In Flow

`/login` is the only entry point to every portal, and it serves two audiences that want opposite things: a member who already has an Authentik session and shouldn't have to click anything, and a prospective rushee who has no account at all and needs somewhere to start.

## Two entry points, and the difference matters

| Route | Question it asks | Used when |
|---|---|---|
| **`/login`** | *Could* you get in? | Someone arrived at a protected page, or followed a "portal" link. We don't know whether they have an account at all. |
| **`/auth/start`** | Get me in. | We already know they want the portal — straight out of enrollment, or `/auth/redirect` finding no session of ours. |

`/login` probes silently with `prompt=none`. `/auth/start` does a full, ordinary sign-in.

:::danger `prompt=none` cannot sign in a brand-new account
This shipped broken and is the reason `/auth/start` exists. A rushee finished the Authentik enrollment flow, was handed back to the site, and landed on `/login` being offered a **Sign in with KTP SSO** button — seconds after creating the account they were already signed into.

The session was fine. `prompt=none` means "answer without any interaction," and **granting an OIDC application's first-time consent is interaction**, so Authentik has no choice but to return an error. Existing members never saw it because their consent was granted long ago.

A full sign-in has neither problem: it's silent when a session exists *and* it can complete consent. So the rule is — **probe only when you don't know; never when you do.**
:::

## The silent probe

On arrival, `SilentSignIn` asks Authentik whether this browser already has a session — using OIDC's `prompt=none`:

```js
signIn('authentik', { callbackUrl: '/auth/redirect' }, { prompt: 'none' });
```

`prompt=none` means "answer immediately and render nothing." The IdP replies with an authorization code if there's a session, or `error=login_required` if there isn't. Either way it never shows a login form of its own.

That last part is the whole point. **Without it, an unauthenticated visitor is dropped on Authentik's login form — a page that has no concept of rush and no way back.** With it, they bounce straight back to our page, where "Sign up for rush" exists.

Members get the other half of the deal: their probe succeeds, and they're in the portal without ever seeing a button.

:::note Verified against the real Authentik, 2026-08-04
Three legs, each checked separately rather than assumed:

| Request | Result |
|---|---|
| `signIn(…, { prompt: 'none' })` | `prompt=none` appears on the authorize URL (absent without it) |
| `GET /application/o/authorize/?…&prompt=none`, no session | `302` → `…/callback/authentik?error=login_required`, **no login form** |
| `GET /api/auth/callback/authentik?error=login_required` | `302` → `/login?error=OAuthCallbackError` |

The control request — same URL minus `prompt=none` — redirects to `/if/flow/default-authentication-flow/` instead, which is the trap being avoided.
:::

### Why every failure mode is safe

The probe is only ever an optimisation. If it fails for any reason — `consent_required`, a network hiccup, JavaScript blocked, `signIn()` never navigating — the visitor sees the ordinary **Sign in with KTP SSO** button and the manual flow they had before. A 6-second timer guarantees this: the spinner is never a dead end.

## Telling "no account" apart from "sign-in broke"

Auth.js reports only **its own** error type in the URL, never the provider's. So a probe that correctly found no session comes back as:

```
/login?error=OAuthCallbackError
```

— byte for byte what a genuinely broken sign-in produces.

Left alone, that means the single most common arrival at this page (someone who has never had an account) is greeted with a red *"We couldn't complete sign-in"* banner describing an error that didn't happen.

`lib/sso.js` disambiguates with a short-lived cookie:

| | Cookie set | Banner |
|---|---|---|
| Probe found no session | `ktp_sso_probe=1` | none — just the sign-in options |
| Real failure after a click | cleared by `SignInButton` | red error banner |

A cookie rather than `sessionStorage` because the decision is made while rendering `/login` **on the server**. `SameSite=Lax` so it survives the top-level redirect back from Authentik, and `max-age=120` because it describes one in-flight round trip, not a preference.

`SignInButton` clears the mark on click: a deliberate click means anything that goes wrong from there is a real failure and should be reported as one.

## The two things that would loop

`/login` suppresses auto-start in two cases, and both are load-bearing:

- **`?error=…`** — auto-retrying a flow that just failed is an infinite redirect between us and Authentik, and nobody ever sees why it broke.
- **`ktp_signed_out=1`** (set by `logoutEverywhere`) — without it, "sign out" lands here and is immediately undone, and if Authentik's session somehow survived the RP-initiated logout, signing out becomes *impossible*.

It's `httpOnly` with a 120-second `max-age` and expires on its own: a Server Component can't delete a cookie, so `/login` can't clear it after reading. Two minutes survives the round trip through Authentik's end-session endpoint and is short enough that the next real visit auto-signs-in normally.

:::warning The cooldown is time-boxed, and each entry point gets its OWN slot
`takeAutoSignInSlot(name)` in `lib/sso.js` is the backstop against an attempt that returns *without* an error param and restarts on arrival.

It stores a **timestamp with a 30-second cooldown**, not a permanent "already tried" flag. A loop re-enters within milliseconds; a session that expires an hour later deserves a fresh attempt. A permanent flag silently switches auto-sign-in off for the rest of the tab's life — the feature appears to work, then quietly stops.

**`/login` and `/auth/start` must not share a slot.** They did at first, to stop them ping-ponging, and it broke the exact journey it was meant to protect:

1. Visitor opens `/login` → the probe runs and **takes the shared slot**
2. They click **Sign up for rush**, enrol, and Authentik hands them to `/auth/start`
3. Under 30 seconds have passed, so the slot is still held — by a probe that had nothing to do with this sign-in
4. `/auth/start` bounces them to `/login`, which now won't probe either

The tell was that signing up from `/rush` directly worked perfectly while signing up *from the login page* did not — same URL, same flow, different browser state. Sharing was never necessary: `/login` only ever redirects to Authentik, never to `/auth/start`, so the two cannot ping-pong. Each loop is self-contained and each guard catches its own.
:::

A third loop guard lives in `auth.ts`: `token.error = undefined` on a completed sign-in. `proxy.ts` sends any errored session to `/login`, so an `error` surviving a fresh sign-in would be a `/login → Authentik → /login` loop rather than the single visible failure it used to be.

## Sign up for rush

Beneath the SSO button, `/login` offers **Sign up for rush**, pointing at [`/rush/how-it-works`](./rush-portal.md#the-public-how-rush-works-page).

It links to the explainer page rather than straight to the Authentik invitation URL, because that page already handles the closed case: when rush signup isn't open it says so and points at `/rush` and Instagram instead of rendering a dead button. `/login` therefore needs no knowledge of whether rush is open, and can't get it wrong.

The link is always shown. It's a link to an informational page, not a signup button, so there is no state in which it misleads.

## What a visitor actually sees

| State | Spinner | SSO button | Rush button | Error banner |
|---|---|---|---|---|
| Fresh visit (probe running) | ✅ | — | — | — |
| Member with a session | ✅ then redirected to their portal | — | — | — |
| Probe found no session | — | ✅ | ✅ | — |
| Sign-in genuinely failed | — | ✅ | ✅ | ✅ |
| Just signed out | — | ✅ | ✅ | — ("You've been signed out.") |

## Where a new account lands

The enrollment invitation's `signup_url` carries `next=<site>/auth/start` (built in `ktp-api/services/authentikAdmin.js`). So the moment enrollment finishes:

```
Authentik enrollment → /auth/start → full SSO (silent, session already exists)
   → /auth/redirect → proxy.ts sees profile_complete=false → /complete-profile
```

`/auth/redirect` **also** sends a session-less visitor to `/auth/start` rather than `/login`. That matters for more than tidiness: invitation QR codes already printed on flyers carry the old `next=…/auth/redirect`, and this is what makes those keep working.

:::note Verify `next=` on the next real enrollment
Authentik honours `?next=` on flow executors — its own internal redirects use it — but ours is an **absolute, external** URL, and some versions validate that against an allow-list. If it's ever rejected the failure is soft: the rushee simply stays on Authentik's page, exactly as before the parameter existed. Nothing breaks; they just have to find the site themselves.
:::
