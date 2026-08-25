---
sidebar_position: 7
---

# Rush Signup

How prospective members create their own accounts, and how eboard opens and closes the window.

## No new Authentik flow was needed

The existing **`ktp-enrollment`** flow already has an Invitation stage plus the `enrollment-assign-group` expression policy, and that policy is group-agnostic — it assigns whatever group the invitation names. It hands out `rush` exactly as it hands out `active`.

See [Enrollment & Invitations](../authentik/enrollment.md) for the flow itself.

## A rush invitation differs in exactly two ways

| Field | Member invitation | Rush invitation |
|---|---|---|
| Custom attributes | `{"group": "active"}` | `{"group": "rush"}` |
| **Single use** | on | **off** — every rushee redeems the same link |
| **Expires** | — | **set** — this is the "rush is open" switch |

That's the whole mechanism. **Authentik enforces the gate**, so there's no code of ours validating a rush code — and therefore no second, weaker check to keep in sync.

Closing rush means deleting the invitation or letting it expire. Accounts already created keep working; only new signups stop.

## Put it on a QR code

The invitation is a URL with a UUID token. Nobody types that off a flyer.

Print the QR on the rush flyer and display it at the info session. Rushees already have phones out, and it's the same interaction they'll use all semester for attendance check-in.

Issuing a **separate invitation per event** gives you attribution — you can tell which event actually converts, because the signup came through that link.

## Managing it from the admin portal

**Admin → Rush Signup** shows the current status, renders the QR, and has open/close controls.

| Endpoint | Does |
|---|---|
| `GET /admin/rush-signup` | Current invitations + whether any is open |
| `POST /admin/rush-signup` | Creates one. Body: `{ name, expires }` |
| `DELETE /admin/rush-signup/:pk` | Closes rush |

**Authentik still enforces the gate.** Someone holding an old link is refused there once the invitation expires, whatever ktp-api thinks.

The window is now also **mirrored locally**, in a single `rush_signup_state` row (`itoken` + `expires_at`). The concern that used to be recorded here — that a mirrored copy could drift from the thing enforcing the gate, and the stale copy is the one eboard would be looking at — is answered by **splitting the readers**:

| Reader | Source |
|---|---|
| `GET /rush-signup/current` (public rush page) | the stored row. Instant, **zero Authentik calls** |
| `GET /admin/rush-signup` (eboard) | Authentik, **live** |

So eboard never looks at the copy. It exists because the public signup button was three network hops deep and did not render at all until the last one finished. It is kept honest by write-through when eboard opens or closes rush, plus a ~10 minute reconcile that catches invitations changed directly in Authentik's admin UI.

The row stores the **expiry, not a boolean**, so a window that lapses on the clock alone reads as closed with no event needed. And a failed reconcile never writes, so an Authentik blip cannot take signup down.

:::warning Requires a service-account permission
`ktp-api-service` needs **add / delete / view on Invitation** (Stages → Invitation), granted on its role the same way the group permissions were. Without it these endpoints return 502.

Creating the invitation **by hand** in the Authentik UI works fine without this — signup functions, eboard just can't open or close it themselves.
:::

## Two traps that fail silently

:::danger `fixed_data`, not `prompt_data`
The Authentik **API** field is `fixed_data`, even though the enrollment flow reads it as `prompt_data` — Authentik renames it while loading the invitation into flow context.

Getting this wrong fails **silently**: the account is created successfully with **no group at all**. The rushee logs in and can't reach anything. If signups are landing groupless, check this first.
:::

:::warning Name it with the `rush-` prefix
`listRushInvitations` filters on that prefix to tell rush invitations apart from the one-per-person member invitations in the same list.

An invitation named `fall-2026` instead of `rush-fall-2026` **works for signup** but is invisible to the admin portal — which will report rush as closed while people are actively signing up through it.
:::

## Groupless accounts default to rush

`middleware/auth.js` defaults a token carrying no recognised group to `rush` — the narrowest surface in the app.

Previously such an account was authenticated but rejected by every gate with nothing explaining why. Defaulting to the least-privileged portal makes that failure graceful instead of producing dead accounts.

This is a **backstop, not the mechanism**. The enrollment policy should still assign the group; adding `or "rush"` to it makes the default true at the source:

```python
group_name = context.get("prompt_data", {}).get("group") or "rush"
```

The trade-off is worth naming: a mis-typed member invitation now produces a working *rushee* rather than an obviously broken account. Failing to least privilege beats failing to nothing, but "why is this new member seeing the rush portal?" becomes a question with a specific answer — a wrong or missing `group` on the invitation.
