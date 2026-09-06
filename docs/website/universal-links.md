---
sidebar_position: 5
---

# Universal Links (attendance check-in)

Universal Links let an attendance QR open the KTP Life iOS app. The website serves an association file, and the app declares the domains and handles the check-in path.

## The problem it solves

`AttendancePage.jsx` builds links from the current origin:

```text
https://ugaktp.com/checkin/{eventId}/{token}
```

A browser and the iOS app have separate sessions. Opening the app can avoid a browser login when the app is already authenticated. Check-in still depends on a valid access token and an unexpired attendance code.

## Website side

The association file is served by:

```text
uga-ktp-website/app/.well-known/apple-app-site-association/route.js
```

Its association includes:

```json
{
  "applinks": {
    "details": [{
      "appIDs": ["ZAL9S5GDHG.SB.KTPLIFE"],
      "components": [{"/": "/checkin/*"}]
    }]
  }
}
```

The App ID combines the Xcode project's `DEVELOPMENT_TEAM` and `PRODUCT_BUNDLE_IDENTIFIER`. The route explicitly returns JSON and limits association to `/checkin/*`, leaving other website paths in the browser.

Check the public response:

```bash
curl -sSI https://ugaktp.com/.well-known/apple-app-site-association
```

Expect `200`, `Content-Type: application/json`, and no redirect. Check both supported hosts when changing proxy or domain configuration.

## App side

The app's Associated Domains entitlement lists:

```text
applinks:ugaktp.com
applinks:ktpgeorgia.com
```

Both hosts matter because the officer's current website origin determines the QR host. The app identifier and provisioning must support Associated Domains. Verify the complete Camera-to-app flow on a physical device.

## Handling in the app

`KTPServices/CheckInService.swift` contains the link parser and API request:

- `CheckInLink` validates the host and `/checkin/{eventId}/{token}` path.
- `CheckInService.checkIn` sends the app's bearer token to `POST /checkin/:eventId/:token`.

`ContentView` uses the same parser for both entry points:

| Entry point | Needs domain association? |
| --- | --- |
| In-app QR scanner | No |
| iOS Camera opening a Universal Link | Yes |

If a scan does not open the app, test the in-app scanner separately. A working in-app scan narrows the problem to link association or dispatch rather than proving that every check-in path is healthy.

The API uses the bearer token to identify the member. See [Attendance](../api/endpoints.md#attendance).

## When it doesn't work

Association files are cached, so a website change may not immediately reach a device. Check the served file, app ID, entitlements, supported host, and path before changing authentication or attendance code.

Development builds can use the Associated Domains developer mode, such as `applinks:ugaktp.com?mode=developer`, with the required device setup. Reinstalling can help test a newly configured association, but do not treat it as a guarantee that every cached copy has refreshed.
