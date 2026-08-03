---
sidebar_position: 5
---

# Universal Links (attendance check-in)

How an attendance QR code opens the **KTP Life** iOS app instead of Safari.

This spans both repos: the website serves the association file, the app claims the domain. Neither half works alone.

## The problem it solves

Attendance QR codes encode a plain link — `https://ugaktp.com/checkin/{eventId}/{token}` — built in `AttendancePage.jsx` from `window.location.origin`. Scanned with the iOS Camera, that opens Safari, where the member almost certainly isn't signed into the portal. They land on "Sign in to check in" and have to run a whole Authentik login in mobile Safari, in a session entirely separate from the app's.

The app already holds a valid Authentik token. Universal Links let the scan reach it directly.

## Website side

Served at `https://ugaktp.com/.well-known/apple-app-site-association` by a **Next.js route handler**, not a static file in `public/`:

```
uga-ktp-website/app/.well-known/apple-app-site-association/route.js
```

```json
{"applinks":{"details":[{"appIDs":["ZAL9S5GDHG.SB.KTPLIFE"],
"components":[{"/":"/checkin/*"}]}]}}
```

The App ID is `<TeamID>.<BundleID>`, both from `KTPLIFE.xcodeproj/project.pbxproj` (`DEVELOPMENT_TEAM` and `PRODUCT_BUNDLE_IDENTIFIER`).

:::warning A route handler, not a file in `public/`
Apple requires this be served as `Content-Type: application/json`, and the filename has no extension. A static handler guesses `application/octet-stream` and **iOS silently ignores it** — no error, the link just keeps opening Safari. The route handler sets the header explicitly.

Next.js does serve dot-prefixed route directories; `app/.well-known/...` appears in the build output as a normal prerendered route.
:::

:::danger Scope it to `/checkin/*` only
Claiming `/*` would make **every** ugaktp.com link try to open the app — every portal page anyone shares in a group chat. Keep the `components` path narrow.
:::

Apple also rejects the file on **any redirect**. If Traefik ever starts bouncing apex→www, Universal Links break with no visible symptom. Verify with:

```bash
curl -sSI https://ugaktp.com/.well-known/apple-app-site-association
```

Expect `200`, `content-type: application/json`, and no `location:` header.

## App side

**Associated Domains** capability on the target, listing both hosts:

```
applinks:ugaktp.com
applinks:ktpgeorgia.com
```

Both are required because the QR is built from `window.location.origin` — whichever domain the eboard member was browsing ends up in the code. The site answers on both.

Requires the capability enabled on the App ID in the Apple Developer portal (Identifiers → `SB.KTPLIFE` → Associated Domains), and a real device — **Universal Links do not work in the Simulator.**

## Handling in the app

`KTPServices/CheckInService.swift` holds both halves:

- `CheckInLink` parses `https://<allowed host>/checkin/{eventId}/{token}`, rejecting anything else
- `CheckInService.checkIn` posts to `POST /checkin/:eventId/:token` with the app's bearer token

`ContentView` feeds it from two entry points, deliberately sharing one parser so they can't disagree about what a valid link is:

| Entry point | Needs Associated Domains? |
|---|---|
| In-app QR scanner (Home → QR button) | **No** |
| iOS Camera → Universal Link | Yes |

:::tip The in-app scanner is the reliable path
It needs no Apple configuration, no association file and no deploy — it never leaves the app. Universal Links are a convenience entry point on top. If check-in is broken, test the in-app scanner first to separate an app problem from a Universal Links problem.
:::

No backend change was needed for any of this: `POST /checkin/:eventId/:token` already sits behind plain `requireAuth` and identifies the member from the token, so the app calls it exactly as the website does. See [Attendance](../api/endpoints.md).

## When it doesn't work

Apple's CDN caches the association file aggressively, so a correction can take a while to reach devices. On a debug build, append `?mode=developer` to the entitlement (`applinks:ugaktp.com?mode=developer`) to bypass the CDN and have the device fetch directly.

Reinstalling the app also forces a re-fetch — iOS only reads the association file at install time.
