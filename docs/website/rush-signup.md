---
sidebar_position: 7
---

# Rush Signup

Prospective members register through an Authentik invitation. Eboard opens and closes signup from **Admin → Rush Signup**.

## Enrollment flow {#no-new-authentik-flow-was-needed}

The `ktp-enrollment` flow uses an Invitation stage and the `enrollment-assign-group` policy. The policy assigns the group named by the invitation, including `rush`. See [Enrollment & Invitations](../authentik/enrollment.md).

## Invitation settings {#a-rush-invitation-differs-in-exactly-two-ways}

| Field | Member invitation | Rush invitation |
| --- | --- | --- |
| Custom attributes | `{"group": "active"}`, or the intended role | `{"group": "rush"}` |
| Single use | Enabled for individual invitations | Disabled for a shared signup link |
| Expires | Set as needed | Sets the signup deadline |

Authentik validates the invitation. Deleting it or letting it expire stops new registrations without disabling accounts already created.

## Put it on a QR code

Display the invitation URL as a QR code on flyers or at events. Separate, clearly named invitations can distinguish signup campaigns; do not assume that the portal provides a conversion report.

## Managing it from the admin portal

The page shows signup status, the QR code, and open/close controls.

| Endpoint | Purpose |
| --- | --- |
| `GET /admin/rush-signup` | Lists invitations and whether any is open |
| `POST /admin/rush-signup` | Creates an invitation from `{ name, expires }` |
| `DELETE /admin/rush-signup/:pk` | Deletes an invitation |

**Who may call these three: executive board, or the chair of the pledge committee.** Widened from eboard alone on 2026-09-15, because the chair runs rush and should not need an eboard member to unlock the signup link on the first morning of it.

They are the only routes in `routes/admin.js` that are not eboard-only, and they achieve that by being registered **above** the router-level `requireGroup("eboard")` while carrying `requirePledgeManage` themselves. Express applies a router-level gate to everything registered after it and offers no per-route exemption, so this is the only way to widen three routes without changing their paths. **Moving them below that line silently revokes the chair.**

The chair reaches them in the UI through the **Signup Links** tab on `/member/rush-data`, which renders when `GET /rush-data/access` reports `can_manage_signup`. That flag is narrower than the same endpoint's `can_view` and `can_edit_presentation`, which reach the whole pledge committee: opening rush creates the route by which strangers make accounts, so it stays with the chair. Eboard gets the identical tab from `/admin/rushees`, where `proxy.ts` is the gate.

The public page and admin page read different sources:

| Reader | Source |
| --- | --- |
| `GET /rush-signup/current` | Local `rush_signup_state` row with `itoken` and `expires_at` |
| `GET /admin/rush-signup` | Live Authentik data |

Admin changes update the local copy. A reconciliation job runs about every ten minutes to pick up changes made directly in Authentik. Expiry is evaluated from the stored timestamp. A failed reconciliation leaves the prior row unchanged.

The local row speeds up the public signup button; Authentik still decides whether a link can be redeemed.

`ktp-api-service` needs permission to add, delete, and view Invitation objects. Missing permissions cause admin API operations to fail with `502`. Invitations can also be created directly in Authentik by an authorized administrator.

## Invitation fields to check {#two-traps-that-fail-silently}

The Authentik API accepts custom invitation data as `fixed_data`. The flow reads that data through `prompt_data` after Authentik loads the invitation. Sending the wrong field can create an account without the intended group.

Name rush invitations with the `rush-` prefix. `listRushInvitations` uses it to distinguish shared signup invitations from individual member invitations. A differently named invitation may work while remaining absent from the admin list.

## Groupless accounts default to rush

API middleware adds `rush` when a token contains no recognized group and records `group_defaulted: true`. This fallback does not repair Authentik membership, and it must not overwrite a known stored role during synchronization.

The enrollment policy should assign the group at account creation. Its fallback is:

```python
group_name = context.get("prompt_data", {}).get("group") or "rush"
```

If an invited member receives the rush role, inspect the invitation's group value and the enrollment policy. The fallback handles missing data; it does not establish that the invitation was configured correctly.
