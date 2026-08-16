---
sidebar_position: 2
---

# Enrollment & Invitations

New members are onboarded through Authentik's invitation system. Admins create a typed invitation link that auto-assigns the user to the correct group when they register.

---

## How It Works

1. **Admin creates an invitation** in Authentik with the target group
2. **User clicks the invite link** → goes through the `ktp-enrollment` flow
3. **User sets their UGA email, username and password** (confirmed with a repeat field)
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
| 20 | enrollment-prompt | Prompt Stage | Prompts for UGA email + username + password + password repeat |
| 30 | enrollment-user-write | User Write Stage | Writes the new user to Authentik |
| 100 | enrollment-user-login | User Login Stage | Logs the user in + runs group assignment policy |

> **Important:** Attach password and email rules as **Validation Policies on the Prompt Stage**, never as a policy binding on the flow's stage binding. Authentik's *default* validation policies crashed enrollment once and were removed; the reason, and why re-attaching them is not the fix, is under [Password requirements](#password-requirements).

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

### Collecting the UGA email at enrollment

Enrollment used to collect username and password only, and the UGA address was first asked for at `/complete-profile` on the website. It is now collected on the enrollment form itself, so the address is on file from the moment the account exists.

#### 1. Add the two prompt fields

Flows and Stages → Stages → `enrollment-prompt` → Edit → **Prompts**.

| Field Key | Type | Label | Required |
|---|---|---|---|
| `email` | Email | UGA Email | Yes |
| `password_repeat` | Password | Confirm Password | Yes |

Authentik's Prompt Stage matches two password fields against each other itself, so `password_repeat` needs no policy. Order the fields email → username → password → password repeat.

#### 2. Enforce the UGA domain, with the alumni exemption

Customisation → Policies → Create → **Expression Policy**, named `ktp-uga-email`:

```python
prompt_data = request.context.get("prompt_data", {})
email = prompt_data.get("email", "").strip().lower()

# Alumni lose their @uga.edu address at graduation, so theirs is the one
# invitation that may carry a personal address. The group comes from the
# invitation's custom attributes — the same place enrollment-assign-group reads
# it, and the invitation stage runs at order 10, before this one at 20.
#
# An unknown or missing group REQUIRES a UGA address, matching requiresUgaEmail
# in ktp-api: an unrecognised group is a signup, which is exactly the case this
# rule exists for. Fail closed, not open.
if prompt_data.get("group") == "alumni":
    return True

at = email.rfind("@")
domain = email[at + 1:] if at != -1 else ""
if domain == "uga.edu" or domain.endswith(".uga.edu"):
    return True

ak_message("Please use your UGA email address (@uga.edu).")
return False
```

:::note If the alumni test case fails, the group isn't reaching `prompt_data` yet
The alumni exemption depends on the invitation's custom attributes being in `prompt_data` by the time the *prompt* is validated, not just by the time the group is assigned at order 100. Test case 5 below is what proves it. If an alumni invitation with a personal address is rejected, that assumption is wrong for your Authentik version and the exemption needs a different discriminator — a second enrollment flow for alumni is the simplest one.
:::

Attach it under the stage's **Validation Policies**, alongside `ktp-password-strength`.

:::warning Split on the LAST `@`, and compare the parsed domain
`email.rfind("@")` and the `== "uga.edu" or .endswith(".uga.edu")` pair are both load-bearing, and they mirror `isUgaAddress` in ktp-api's `services/emails.js` deliberately. A suffix check (`email.endswith("uga.edu")`) accepts `someone@notuga.edu`. A substring check accepts `someone@uga.edu.attacker.com`. Splitting on the first `@` reads `a@b@evil.com` as domain `b`.
:::

#### 3. Map the `email` scope so it reaches the database

The address is written to the Authentik user by the User Write stage, but ktp-api only learns it if the token carries it.

Applications → Providers → **ktpapp** → Edit → **Advanced protocol settings** → *Scopes* → add **`authentik default OAuth Mapping: OpenID 'email'`**.

Members must sign out and back in once; the claim only appears on newly issued tokens.

:::note `email_verified` is not evidence, and ktp-api ignores it
That same mapping emits an `email_verified` claim. Nothing in this system ever sends mail to an address to prove someone owns it — the value is what they typed at enrollment — so `middleware/auth.js` deliberately does not gate on it. Authentik agrees: releases before 2025.10 hardcoded it to `true`, and it now defaults to `false` precisely because there is no authoritative source for it. The domain check is the real control.
:::

#### How it reaches Postgres

`POST /users/sync` runs on every login and seeds `users.email` from the claim, once:

- **It fills an empty column and never overwrites.** Members can edit their UGA email on their profile, and this runs on every login, so mirroring would revert their correction each time they signed in.
- **Only a UGA address may seed it.** `users.email` is the UGA address; `personal_email` is the other one. Since alumni are exempted above, their enrollment carries a personal address, and ktp-api re-checks the domain rather than trusting the flow. A misconfigured policy cannot put the wrong kind of address in the wrong column.
- **A missing claim is fine.** Nothing breaks before step 3 is done, which is why the ktp-api half could ship first.

Full reasoning is in the `/users/sync` note in `ktp-api/README.md`; the rules are pinned by `test/enrollmentEmail.test.js`.

:::tip Test the order that catches the real mistakes
With a throwaway invitation, in a private window:

1. A **non-UGA** address (`someone@gmail.com`) → rejected with your message
2. A **lookalike** (`someone@notuga.edu`) → rejected. If this one passes, the policy is doing a suffix check
3. A **subdomain** (`me@mail.uga.edu`) → accepted
4. **Mismatched** password and repeat → rejected by the stage itself
5. An **alumni** invitation with a personal address → accepted

Then sign in and confirm the address is on the profile without anyone typing it at `/complete-profile`.
:::

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

:::danger Enrollment can RENAME an existing account instead of creating one — confirmed 2026-08-09
An eboard member signed out, opened rush signup on the same browser, and created a rush account. **No new user was created.** Their existing Authentik user was renamed to the rush username and gained the `rush` group, keeping its original groups and its `sub` — so signing in afterwards returned their real account under the wrong name, with their profile intact and the profile builder correctly skipped.

The cause is that the enrollment flow was reachable by a browser Authentik still considered authenticated. Authentik's User Write stage writes to `pending_user`, which for an authenticated request **is the signed-in user**, so the flow updates them instead of creating anybody.

Two settings close it, and both are worth having:

| Where | Set to | Why |
|---|---|---|
| Flows → `ktp-enrollment` → **Authentication** | **Require unauthenticated** | Authentik refuses the flow outright for a signed-in browser, rather than picking a victim to write to |
| Stages → `enrollment-user-write` → **User creation mode** | **Always create** | Removes the fall-through to updating `pending_user` even if the first guard is ever loosened |

**And this is why the browser was still authenticated:** signing out of the website was confirmed 2026-08-09 not to sign the browser out of Authentik. **Providers → ktpapp → Invalidation flow** must be `default-invalidation-flow` (which runs a `user_logout` stage), not `default-provider-invalidation-flow` (which ends only the application session). New OAuth2 providers default to the latter, and it is a trap because logout still honours `post_logout_redirect_uri` and looks like it worked. Full detail in [Sign-In Flow](../website/sign-in.md#two-sessions-in-one-browser).

**No website change can prevent this.** The signup URL points straight at Authentik and is printed on flyers as a QR code, so the site is never in the loop. It has to be fixed here.

**Repair for an account this happened to:** rename it back and remove the `rush` group in Authentik, then have them sign in again — `POST /users/sync` re-mirrors both `username` and `member_group` from the fresh token, so the database self-heals. Nothing needs editing in Postgres by hand.
:::

:::warning Enrolling replaces Authentik's session for that browser
Finishing this flow logs the browser in as the new account — that's the `enrollment-user-login` stage at order 100. If someone **else** was already signed in to the site on that browser, Authentik now holds the new account while the site's own cookie still holds the old one, and the two disagree with nothing to reconcile them.

The website handles this at `/auth/start`, where every enrollment lands: a session that doesn't obviously belong to whoever just enrolled gets a **chooser** rather than a redirect. Before that guard existed, the new user was dropped into the previous user's portal, and the previous user's session was later silently rewritten as the new one.

This matters most for **rush invitations**, which are non-single-use and scanned off flyers, so the same physical phone or laptop can run the flow more than once. Full detail in [Sign-In Flow → Two sessions in one browser](../website/sign-in.md#two-sessions-in-one-browser).
:::

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
- The rule is enforced in **two** places now, and they must agree: the `ktp-uga-email` expression policy on the enrollment prompt (see [Collecting the UGA email](#collecting-the-uga-email-at-enrollment)) and `services/emails.js` in ktp-api, which backs `/complete-profile`. Both accept `uga.edu` and any subdomain, nothing else, and both exempt alumni
- If enrollment accepts an address that `/complete-profile` then rejects, the two have drifted — compare the policy against `isUgaAddress`

**User stuck on /complete-profile after submitting:**
- Check API logs on LXC 119: `docker logs ktp-api`
- Confirm `PUT /users/me/profile` returns 200 — if it errors, the session update won't fire

**User in wrong portal:**
- Check their groups in Authentik: **Directory → Users → select user → Groups tab**
- Group priority: `eboard > chair > active > alumni > pledge`
- The DB `member_group` updates on every login via `/users/sync`
- If Authentik looks right but the **portal** is still wrong, the website session's `groups` are stale. They now refresh with the access token (from the refreshed `id_token`), so this should resolve within the access token's lifetime — signing out and back in forces it immediately

**A member suddenly displays as "Rushee" but Authentik still shows their real group:**
- This is `member_group` in Postgres, not Authentik. `middleware/auth.js` supplies `rush` when a token carries no group it recognises — a safety net so a misconfigured account isn't locked out of everything — and `syncUser` used to write that guess into `users.member_group`, where every badge reads it
- Fixed: `req.user.group_defaulted` marks the guess, and `upsert`'s `preserveMemberGroup` lets it fill an empty column but never overwrite a known group. **Any new code that writes based on `req.user.groups` must check the same flag**
- To repair an account already stamped: one sign-in carrying real groups rewrites the column. If it persists, the token genuinely isn't carrying `groups` — check the OIDC provider's **groups** scope mapping

**Username or roles changed on their own:**
- Almost always two accounts on one browser: someone enrolled or signed in as a different user on a device where another account was already open. See [Sign-In Flow → Two sessions in one browser](../website/sign-in.md#two-sessions-in-one-browser)
- Nothing is corrupted in Authentik or the database — sign out fully (which ends the Authentik session too) and sign back in
- If it happened *after* the chooser shipped, that's a real bug. Get the two usernames involved and whether they arrived by QR code or by the link on `/rush/how-it-works`