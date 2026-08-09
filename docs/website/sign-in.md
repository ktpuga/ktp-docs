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

Both of them ask a third question first — **is somebody else already signed in on this browser?** — and neither will answer it by guessing. See [Two sessions in one browser](#two-sessions-in-one-browser).

:::danger `prompt=none` cannot sign in a brand-new account
This shipped broken and is the reason `/auth/start` exists. A rushee finished the Authentik enrollment flow, was handed back to the site, and landed on `/login` being offered a **Sign in with KTP SSO** button — seconds after creating the account they were already signed into.

The session was fine. `prompt=none` means "answer without any interaction," and **granting an OIDC application's first-time consent is interaction**, so Authentik has no choice but to return an error. Existing members never saw it because their consent was granted long ago.

A full sign-in has neither problem: it's silent when a session exists *and* it can complete consent. So the rule is — **probe only when you don't know; never when you do.**
:::

## Two sessions in one browser

A browser holds **two** sessions, not one:

| | Set by | Cleared by |
|---|---|---|
| **Ours** — the NextAuth JWT cookie | completing sign-in on the site | `signOut()`, or 30 days |
| **Authentik's** — its own SSO cookie | signing in *or enrolling* at `auth.ugaktp.com` | RP-initiated logout (`logoutEverywhere`) — **only if the provider's Invalidation flow is the right one**, see below |

:::danger "Sign out" signs you out of the website, not Authentik
Reported and diagnosed 2026-08-09. This is the enabler for everything else on this page, including [rush enrollment renaming an existing account](../authentik/enrollment.md).

The URL is not the problem. `${AUTHENTIK_ISSUER}end-session/` matches the `end_session_endpoint` in Authentik's discovery document exactly — verified against the live server. What the endpoint *does* is decided by the OAuth2 provider's **Invalidation flow**, and Authentik ships two with confusingly similar names:

| Flow | What it ends |
|---|---|
| `default-provider-invalidation-flow` | the **application** session only — the authentik SSO session survives |
| `default-invalidation-flow` | runs a `user_logout` stage: really signs out of authentik. This instance's brand default (`/flows/-/default/invalidation/` redirects to it) |

New OAuth2 providers default to the **provider-scoped** one. It is a trap because logout still looks like it worked: `post_logout_redirect_uri` is honoured and the browser lands back on `/login` reading "You've been signed out."

**Fix: Providers → ktpapp → Invalidation flow → `default-invalidation-flow`.**

**Verify:** sign out, then open `https://auth.ugaktp.com/` directly. Still signed in ⇒ not fixed. Nothing on our side can detect this — a `refresh_token` is not tied to the browser session — so it will not surface as an error anywhere.
:::

:::warning Where sign-out lands is an Authentik allow-list, not just our code
`logoutEverywhere` asks Authentik to return the browser to `${AUTH_URL}/` — the homepage. Authentik honours that **only if the URI matches an entry in the provider's Redirect URIs list exactly**, trailing slash included; it uses that same list for post-logout redirects. A URI that isn't on the list is silently ignored and the person is left parked on `auth.ugaktp.com`.

So the string in `lib/auth-actions.js` and the list in **Applications → Providers → ktpapp → Redirect URIs** are one setting in two places. Change one, change the other:

| Environment | Entry to add (Strict) |
|---|---|
| Production | `https://ugaktp.com/` |
| Local dev | `http://localhost:3000/` |

This is also why the "just signed out" marker is a **cookie** and not a `?signedout=1` query param — the param would have to be allow-listed too, and getting it wrong doesn't degrade gracefully, it strands people on the IdP.
:::

### Three Authentik settings with "logout" in the name

They are unrelated to each other, and two of them are easy to reach for when the third is the problem:

| Setting | Decides | Ours must be |
|---|---|---|
| **Invalidation flow** (on the provider) | whether Authentik's own SSO session actually ends | `default-invalidation-flow` — the provider-scoped one ends only the app session |
| **Redirect URIs** (on the provider) | where the browser lands afterwards; the same list gates `post_logout_redirect_uri` | must include `https://ugaktp.com/` **as its own entry** — the OAuth callback URLs already there do not cover it under Strict matching |
| **Backchannel logout URI** | a server-to-server `POST` of a signed `logout_token` from Authentik to the app | **blank** |

The last one is the trap: its help text reads *"Required for OpenID Connect Logout functionality"*, which sounds mandatory. It refers to **backchannel** logout, a different half of the spec from the **RP-initiated** logout we use (browser → `end_session_endpoint` with `id_token_hint` → redirect). Ours needs no backchannel URI, and there is no endpoint in the website that could receive one — pointing it at the homepage just makes Authentik POST logout tokens at a page that answers 405.

Implementing it later would be poor value: backchannel logout exists for apps holding revocable server-side sessions, and ours are stateless JWT cookies. Honouring a logout token would mean a revocation denylist checked on every request, for a case `logoutEverywhere` already covers from the browser.

:::note No `id_token_hint`, no logout
`logoutEverywhere` skips the round trip entirely when it has no id_token, because end-session without a hint answers `302 → /if/flow/default-authentication-flow/` — the **login** flow. Authentik can't tell whose session to end, so it asks the visitor to sign in first. Following that lands someone who pressed "sign out" on a login form, still signed in, having achieved nothing.
:::

Nothing keeps them in step, and there is no cheap way to notice when they disagree. A `refresh_token` is not tied to the browser session, so ours goes on renewing itself perfectly happily while Authentik's belongs to somebody else entirely.

:::danger How accounts used to overwrite each other
Both entry points used to redirect to `/auth/redirect` the moment they saw *any* session. On a browser with one person signed in and another person enrolling, that plays out like this:

1. A member is signed in. Both cookies say **member**.
2. Someone opens the rush signup link on the same browser — usually a **QR code from a flyer**, which points straight at Authentik. Enrollment creates a rushee and Authentik's cookie becomes **rushee**. Ours still says **member**.
3. `next=` lands them on `/auth/start`, which sees a healthy session and redirects. **The rushee is now inside the member's portal** — their DMs, their committees, everything. That is an access leak, not a cosmetic glitch.
4. Later, whenever our cookie lapses, `/login`'s silent `prompt=none` probe asks Authentik who this browser is. Authentik answers **rushee**. Auth.js writes a fresh JWT over the member's cookie.

Step 4 is what people report: *the username changed on its own and the roles are wrong.* Nothing was corrupted in Authentik or the database — one browser simply had two identities and the entry points picked whichever was closest to hand.
:::

### The chooser

`components/auth/AlreadySignedIn.jsx` is what a healthy session gets now, on **both** `/login` and `/auth/start`:

```
You're already signed in as
Yash Verma
yash@uga.edu

[ Continue to my portal            ]   → /auth/redirect
[ This isn't me — sign in as someone else ]   → switchAccount()
```

It is a Server Component and the second button is a real `<form action={switchAccount}>`, so `redirect()` inside the action resolves natively instead of surfacing as the `NEXT_REDIRECT` error a client `onClick` would have to special-case.

### `switchAccount()` — and why it is *not* `logoutEverywhere()`

`switchAccount()` in `lib/auth-actions.js` clears **only our cookie**, then sends the browser to `/login?switch=1`, which signs in with `prompt=login`.

Ending Authentik's session here would be exactly wrong. The whole reason the chooser is on screen is that Authentik's session may already belong to the *other* person — the rushee who enrolled ten seconds ago. Destroying it makes them sign up from scratch.

`prompt=login` is what makes the outcome deterministic rather than a coin flip: Authentik is forced to ask who is at the keyboard instead of silently reusing the session being switched away from. Without it, clearing our cookie and signing straight back in returns the very account the person just said wasn't theirs — and on `/auth/start` that isn't merely a wrong answer, it's a loop.

### Where each guard sits

| Entry point | No session | Healthy session |
|---|---|---|
| `/login` | silent `prompt=none` probe (`SilentSignIn`) | **chooser** |
| `/login?switch=1` | full sign-in, `prompt=login` (`AutoSignIn`) | same — `switchAccount()` already cleared our cookie |
| `/auth/start` | full sign-in, no `prompt` (`AutoSignIn`) | **chooser** |
| `/rush/how-it-works` | signup link | **"Sign out to sign up"** → `logoutEverywhere()` |

:::warning `/auth/start` is the only guard that catches a QR code
The signup URL points straight at Authentik and is printed on flyers (`ktp-api/services/authentikAdmin.js`), so the website has no say in anything that happens before enrollment finishes. **Every rush signup returns through `/auth/start`, and nothing else is guaranteed to be visited at all.**

The `/rush/how-it-works` guard is worth having — it stops the site walking people into the trap — but it is the second line, not the first. Don't move logic out of `/auth/start` on the assumption that the explainer page already handled it.
:::

On `/rush/how-it-works` the guard also waits for `useSession()` to resolve before rendering either branch. The session lookup and the `GET /rush-signup` status call race each other, and if the status wins, a signed-in visitor sees a live signup link for a beat — long enough to click, which is the entire thing being prevented.

### Stale groups were the other half of "roles get messed up"

`refreshAccessToken()` in `auth.ts` used to carry `groups` forward untouched, so they were frozen at whatever they were the last time someone did a **full** sign-in. Because refreshing keeps a session alive indefinitely, a rushee accepted into a pledge class kept `rush` in their session — `proxy.ts` gating them into `/rushee` and out of `/pledge` — for up to the 30-day JWT lifetime, with no fix but signing out.

The refresh now re-reads `groups` (and `id_token`) from the refreshed `id_token`. For an `oidc` provider Auth.js sets `profile` to the id_token claims themselves, so these are exactly the claims the first sign-in read — not a weaker source. Two details worth keeping:

- The id_token is decoded **without signature verification**, on purpose: it arrives from a direct server-to-server TLS POST to Authentik's token endpoint, never through the browser. Anything able to forge it could forge the `access_token` beside it. Do not reuse that helper on anything client-supplied.
- Both fields fall back to the previous value when the response omits them. A response with no `groups` claim means "nothing new to say", never "this person has no groups" — dropping them would demote the user to `homePortal()`'s no-group fallback.

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

## The things that would loop

`/login` suppresses auto-start in four cases, and every one is load-bearing:

- **`?error=…`** — auto-retrying a flow that just failed is an infinite redirect between us and Authentik, and nobody ever sees why it broke.
- **`ktp_signed_out`** (set by `logoutEverywhere`) — without it, "sign out" lands here and is immediately undone, and if Authentik's session somehow survived the RP-initiated logout, signing out becomes *impossible*.
- **`?switch=1`** — the probe is the exact opposite of what a switch wants. `prompt=none` silently reuses Authentik's existing session, which is the account being switched *away from*. `AutoSignIn` with `prompt=login` handles this case instead.
- **A healthy session** — that renders the chooser, and a probe underneath it would race the person's own choice.

`ktp_signed_out` is `httpOnly` with a 120-second `max-age` and expires on its own: a Server Component can't delete a cookie, so `/login` can't clear it after reading. Two minutes survives the round trip through Authentik's end-session endpoint and is short enough that the next real visit auto-signs-in normally.

:::warning The cooldown is time-boxed, and each entry point gets its OWN slot
`takeAutoSignInSlot(name)` in `lib/sso.js` is the backstop against an attempt that returns *without* an error param and restarts on arrival.

It stores a **timestamp with a 30-second cooldown**, not a permanent "already tried" flag. A loop re-enters within milliseconds; a session that expires an hour later deserves a fresh attempt. A permanent flag silently switches auto-sign-in off for the rest of the tab's life — the feature appears to work, then quietly stops.

**No two entry points may share a slot** — `/login`'s probe, `/auth/start`, and `/login?switch=1` each own one (`probe`, `start`, `switch`). `/login` and `/auth/start` did share at first, to stop them ping-ponging, and it broke the exact journey it was meant to protect:

1. Visitor opens `/login` → the probe runs and **takes the shared slot**
2. They click **Sign up for rush**, enrol, and Authentik hands them to `/auth/start`
3. Under 30 seconds have passed, so the slot is still held — by a probe that had nothing to do with this sign-in
4. `/auth/start` bounces them to `/login`, which now won't probe either

The tell was that signing up from `/rush` directly worked perfectly while signing up *from the login page* did not — same URL, same flow, different browser state. Sharing was never necessary: `/login` only ever redirects to Authentik, never to `/auth/start`, so the two cannot ping-pong. Each loop is self-contained and each guard catches its own.

`AutoSignIn` takes the slot name as a **prop** precisely so this stays visible at the call site. It was `StartSignIn`, serving `/auth/start` alone; the account-switch flow needs identical machinery with one parameter changed, and copying it was the obvious wrong move — every auth component in this repo that got duplicated has since drifted, and each drift presented as *"login is broken"*.
:::

:::danger The cooldown branch must never redirect
`AutoSignIn` used to take a `cooldownHref` and `router.replace()` to it — `/auth/start` passed `/login`. It closed a loop the day `/login` gained a button leading back toward `/auth/start`: each lap took a couple of seconds, so the 30-second cooldown never expired. Nothing in the chain was broken in isolation; the redirect target simply grew a way back in.

The general shape is the point. This guard fires **precisely when something upstream is already bouncing the browser around**, so redirecting hands control to whatever page sits at the other end — which may well offer a way straight back in, today or after someone edits it.

`cooldownHref` is gone. The branch stops dead and renders a **Try signing in again** button. A human pressing something breaks a loop of any shape, which an automatic redirect can never promise.
:::

A third loop guard lives in `auth.ts`: `token.error = undefined` on a completed sign-in. `proxy.ts` sends any errored session to `/login`, so an `error` surviving a fresh sign-in would be a `/login → Authentik → /login` loop rather than the single visible failure it used to be.

## Sign up for rush

Beneath the SSO button, `/login` offers **Sign up for rush**, pointing at [`/rush/how-it-works`](./rush-portal.md#the-public-how-rush-works-page). It is also where someone lands after `/rush/how-it-works` makes them sign out first, so the link doubles as the way back into signup.

It links to the explainer page rather than straight to the Authentik invitation URL, because that page already handles the closed case: when rush signup isn't open it says so and points at `/rush` and Instagram instead of rendering a dead button. `/login` therefore needs no knowledge of whether rush is open, and can't get it wrong.

The link is always shown. It's a link to an informational page, not a signup button, so there is no state in which it misleads.

## What a visitor actually sees

| State | Spinner | SSO button | Rush button | Error banner |
|---|---|---|---|---|
| Fresh visit (probe running) | ✅ | — | — | — |
| Member with a session | — | — | — | — (**chooser**: Continue to my portal / This isn't me) |
| Probe found no session | — | ✅ | ✅ | — |
| Sign-in genuinely failed | — | ✅ | ✅ | ✅ |
| Just signed out | — | ✅ | ✅ | — ("You've been signed out.") |
| `?switch=1` | ✅ | — | — | — (Authentik asks for credentials) |

The **Member with a session** row is the one that changed. It used to redirect straight to the portal, which was convenient for the owner of the session and a dead end for everybody else: a second person on the same browser was dropped into the first person's portal with no way to sign in as themselves short of finding the other person's sign-out button. What they did instead was sign in at Authentik directly — which is precisely how the two cookies ended up disagreeing. One click on the chooser replaces that whole detour.

## Where a new account lands

The enrollment invitation's `signup_url` carries `next=<site>/auth/start` (built in `ktp-api/services/authentikAdmin.js`). So the moment enrollment finishes:

On a clean browser — the ordinary case:

```
Authentik enrollment → /auth/start → full SSO (silent, session already exists)
   → /auth/redirect → proxy.ts sees profile_complete=false → /complete-profile
```

On a browser that already had somebody signed in:

```
Authentik enrollment → /auth/start → sees OUR cookie ≠ the account just created
   → chooser → "This isn't me" → switchAccount() clears our cookie
   → /login?switch=1 → prompt=login → Authentik asks who this is
   → /auth/redirect → /complete-profile
```

A session at `/auth/start` does **not** mean the visitor is that person. Arriving via `next=` means someone finished creating an account seconds ago; if our cookie holds someone else, this is exactly the shared browser the chooser exists for. Redirecting on sight of a session — what this page used to do — is what handed the rushee the member's portal.

`/auth/redirect` **also** sends a session-less visitor to `/auth/start` rather than `/login`. That matters for more than tidiness: invitation QR codes already printed on flyers carry the old `next=…/auth/redirect`, and this is what makes those keep working.

:::note Verify `next=` on the next real enrollment
Authentik honours `?next=` on flow executors — its own internal redirects use it — but ours is an **absolute, external** URL, and some versions validate that against an allow-list. If it's ever rejected the failure is soft: the rushee simply stays on Authentik's page, exactly as before the parameter existed. Nothing breaks; they just have to find the site themselves.
:::
