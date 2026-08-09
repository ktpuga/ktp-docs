---
sidebar_position: 2
---

# Enrollment & Invitations

New members are onboarded through Authentik's invitation system. Admins create a typed invitation link that auto-assigns the user to the correct group when they register.

---

## How It Works

1. **Admin creates an invitation** in Authentik with the target group
2. **User clicks the invite link** → goes through the `ktp-enrollment` flow
3. **User sets username + password** (no email change — Authentik manages email separately)
4. **Group is assigned** automatically via expression policy
5. **User logs in** → website syncs their profile to the database → redirected to complete-profile if needed

---

## Creating an Invitation

1. Go to **Authentik admin panel → Directory → Invitations**
2. Click **Create**
3. Set:
   - **Flow:** `ktp-enrollment`
   - **Custom attributes:**
     ```json
     {"group": "active"}
     ```
     Replace `"active"` with the appropriate group (`pledge`, `eboard`, `chair`, `alumni`)
4. Copy the invite link and send it to the new member

The custom attribute value is loaded into the enrollment flow's `prompt_data` context and picked up by the group assignment policy.

---

## Enrollment Flow: `ktp-enrollment`

### Stage Bindings

| Order | Stage | Type | Notes |
|-------|-------|------|-------|
| 10 | enrollment-invite | Invitation Stage | Validates the invitation token |
| 20 | enrollment-prompt | Prompt Stage | Prompts for username + password — **no validation policies attached** |
| 30 | enrollment-user-write | User Write Stage | Writes the new user to Authentik |
| 100 | enrollment-user-login | User Login Stage | Logs the user in + runs group assignment policy |

> **Important:** The `enrollment-prompt` stage currently has **no validation policies** attached. Authentik's *default* validation policies crashed enrollment and were removed. See [Password requirements](#password-requirements) below — this is fixable, but not by re-attaching what was removed.

### Password requirements

Passwords live entirely in Authentik. ktp-api and the website never see, store, or validate one, so **there is nothing to change in either repo** — this is Authentik admin configuration.

Right now there are effectively **no password requirements at all**: a rushee can enroll with `a`. Fixing that means adding a *Password Policy*, which is not the same object as the default validation policies that were removed.

#### Why the previous attempt crashed

The default policies bound to `enrollment-prompt` included ones that evaluate `request.user` — during enrollment there is no user yet, because `enrollment-user-write` (order 30) hasn't run. They also assumed field names that the custom prompt stage doesn't use. Both surface as `Password Invalid` or a 500 on submit, which is why the fix was to strip them.

A **Password Policy** avoids this. It evaluates the submitted *field value*, not the not-yet-existent user.

#### Setup

1. **Customisation → Policies → Create → Password Policy.** Name it `ktp-password-strength`.
2. Set the rules. A reasonable baseline for a student org:
   - Minimum length: `10`
   - Minimum uppercase: `0`, lowercase: `0`, digits: `0`, symbols: `0`
   - Error message: *"Password must be at least 10 characters."*
3. **Set `Password field` to the field name your prompt stage actually uses.** This is the step that silently breaks everything if it's wrong — the policy passes trivially because it's checking a field that doesn't exist. Check it under **Flows → Stages → `enrollment-prompt` → Prompts**; it is usually `password`, but confirm rather than assume.
4. Bind it to the **prompt stage**, not the flow: **Flows → `ktp-enrollment` → Stage Bindings → `enrollment-prompt` → Policy Bindings → Bind existing policy.**

:::tip Prefer length over character classes
Composition rules (one uppercase, one symbol) push people toward `Password1!` and are worse than a longer minimum. Length is the requirement that actually helps here.
:::

:::danger Test with a throwaway invitation before rush opens
Enrollment breaking is not a bug you find gradually — it breaks *everyone* signing up, during the two weeks of the year when signups matter, and the people hitting it are prospective members with no way to report it to you.

Create a disposable invitation, run the whole flow in a private window, and confirm you can still enroll. Do this **before** rush signup opens, not after. If enrollment breaks, unbind the policy first and diagnose second — `docker logs` on the Authentik container shows the real error, which is usually the wrong field name from step 3.
:::

#### Existing accounts

A password policy applies at *enrollment and password change*, not retroactively. Members who enrolled with a weak password keep it until they change it. There is no forced-reset flow (it was removed — see [Password Reset for Existing Users](./overview.md#password-reset-for-existing-users)), so tightening this does not lock anyone out.

### Group Assignment Policy

The `enrollment-assign-group` expression policy runs at order 100 on the User Login stage binding:

```python
from authentik.core.models import Group

group_name = context.get("prompt_data", {}).get("group")  # NOTE: prompt_data, not fixed_data
if group_name and request.user:
    try:
        group = Group.objects.get(name=group_name)
        request.user.ak_groups.add(group)
    except Group.DoesNotExist:
        pass

return True
```

> The invitation's Custom attributes are loaded into `prompt_data` (not `fixed_data`). Using `fixed_data` will cause group assignment to silently fail.

---

## After Registration

Once enrolled, the user logs in at [ugaktp.com](https://ugaktp.com):

1. Website calls `POST /users/sync` → creates DB row with `profile_complete = false`
2. Middleware detects `profile_complete = false` → redirects to `/complete-profile`
3. User fills in their profile (name, major, graduation date, etc.)
4. `PUT /users/me/profile` sets `profile_complete = true`
5. Session is updated, user is redirected to their portal

---

## Groups in Authentik

Groups must be created in Authentik before invitations referencing them will work.

To check/create groups: **Directory → Groups**

Required groups:

| Group Name | Portal |
|-----------|--------|
| `eboard` | /admin |
| `chair` | /member |
| `active` | /member |
| `pledge` | /pledge |
| `alumni` | /member |
| `admin` | (system only) |

Group names are **case-sensitive** and must match exactly what's used in the invitation's custom attributes JSON and the website middleware.

---

## Troubleshooting

**User doesn't get assigned to a group:**
- Check that the Custom attributes JSON is valid: `{"group": "active"}` (double-quoted keys and values)
- Verify the expression policy uses `context.get("prompt_data", {})` not `fixed_data`
- Confirm the group name in Authentik matches exactly

**"Password Invalid" error during enrollment:**
- Remove all validation policies from the `enrollment-prompt` Prompt Stage binding
- If you were adding password requirements, unbind the policy first, then check its **Password field** matches the prompt stage's actual field name — see [Password requirements](#password-requirements). A Password Policy is safe here; the default validation policies are not, because they evaluate a user that doesn't exist until order 30

**Signup rejects a valid-looking email:**
- The UGA address requirement is enforced by **ktp-api**, not Authentik — enrollment itself collects no email. The check is in `services/emails.js` and it accepts `uga.edu` and any subdomain, nothing else. Someone without a UGA address yet cannot finish `/complete-profile`

**User stuck on /complete-profile after submitting:**
- Check API logs on LXC 119: `docker logs ktp-api`
- Confirm `PUT /users/me/profile` returns 200 — if it errors, the session update won't fire

**User in wrong portal:**
- Check their groups in Authentik: **Directory → Users → select user → Groups tab**
- Group priority: `eboard > chair > active > alumni > pledge`
- The DB `member_group` updates on every login via `/users/sync`