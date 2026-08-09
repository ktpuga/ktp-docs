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

#### Why the previous attempt failed

Almost certainly a **field-name mismatch**, not a real crash.

Authentik's Password Policy reads the submitted password out of the flow's prompt context, using whatever key its `Password field` setting names (default: `password`). If that key isn't in the context — because the custom `enrollment-prompt` stage names its field something else — the policy doesn't skip or pass. It **fails**, with `Password not set in context`.

That renders as `Password Invalid` on the enrollment form, for *every* signup, no matter how strong the password is. Which matches the symptom in [Troubleshooting](#troubleshooting) exactly, and explains why stripping every validation policy was what made enrollment work again.

So the fix is not a different kind of policy — it's the same kind, with `Password field` actually matching the prompt.

#### Two places policies attach, and only one is right

This distinction is the whole game:

| Where | What it does | Use for passwords? |
|---|---|---|
| **Stage's `Validation Policies`** (on the Prompt Stage itself) | Runs when the form is **submitted**; a failure shows the policy's error message next to the form and the user retries | **Yes** |
| **Policy Binding** on the flow's Stage Binding | Decides whether the stage **runs at all**; a failure makes Authentik **skip the stage** | **No** |

Binding a password policy in the second place doesn't reject weak passwords — it silently skips the prompt that collects them.

#### Setup

1. **Find the real field key first.** Flows and Stages → Stages → `enrollment-prompt` → Edit → look at its **Prompts**, open the password one, read its **Field Key**. It's often `password`, but read it rather than assume — this is the step the previous attempt got wrong.
2. **Customisation → Policies → Create → Password Policy.** Name it `ktp-password-strength`.
3. Set **Password field** to the key from step 1.
4. Set the rules — a reasonable baseline for a student org:
   - Minimum length: `10`
   - Uppercase / lowercase / digits / symbols: `0`
   - Error message: *"Password must be at least 10 characters."*
5. Attach it as a **validation policy on the stage**: Flows and Stages → Stages → `enrollment-prompt` → Edit → **Validation Policies** → add `ktp-password-strength`. **Not** a policy binding on the flow's stage binding — see the table above.

:::note If the prompt has a confirmation field
A second password field (e.g. `password_repeat`) is matched by the Prompt Stage itself, not by this policy. The policy only needs the one key from step 1.
:::

:::tip Prefer length over character classes
Composition rules (one uppercase, one symbol) push people toward `Password1!` and are worse than a longer minimum. Length is the requirement that actually helps here.
:::

:::danger Test with a throwaway invitation before rush opens
Enrollment breaking is not a bug you find gradually — it breaks *everyone* signing up, during the two weeks of the year when signups matter, and the people hitting it are prospective members with no way to report it to you.

Create a disposable invitation, run the whole flow in a private window, and confirm you can still enroll. Do this **before** rush signup opens, not after.

Test in this order — the second case is the one that catches a field-name mismatch:

1. A **weak** password (`abc`) → must be rejected with *your* error message, not `Password not set in context`
2. A **strong** password (`correct-horse-battery`) → must enroll successfully

Passing (1) but failing (2) is the signature of a wrong `Password field`: the policy is failing everything, not evaluating anything. If that happens, remove it from **Validation Policies** first and diagnose second — `docker logs` on the Authentik container shows the real reason.
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
- If you were adding password requirements, remove the policy from the stage's **Validation Policies** first, then check its **Password field** matches the prompt's actual **Field Key**. A mismatch makes the policy fail *every* password with `Password not set in context`, which renders as this exact error — see [Password requirements](#password-requirements)

**Signup rejects a valid-looking email:**
- The UGA address requirement is enforced by **ktp-api**, not Authentik — enrollment itself collects no email. The check is in `services/emails.js` and it accepts `uga.edu` and any subdomain, nothing else. Someone without a UGA address yet cannot finish `/complete-profile`

**User stuck on /complete-profile after submitting:**
- Check API logs on LXC 119: `docker logs ktp-api`
- Confirm `PUT /users/me/profile` returns 200 — if it errors, the session update won't fire

**User in wrong portal:**
- Check their groups in Authentik: **Directory → Users → select user → Groups tab**
- Group priority: `eboard > chair > active > alumni > pledge`
- The DB `member_group` updates on every login via `/users/sync`