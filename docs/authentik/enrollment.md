---
sidebar_position: 2
---

# Enrollment & Invitations

Invitations send new users through `ktp-enrollment` and identify the intended role. Authentik creates the login account; the website then synchronizes an application profile.

## How It Works

1. An administrator creates an invitation with a target group.
2. The user follows it through enrollment.
3. The form collects email, username, password, and password confirmation.
4. A policy assigns the group.
5. The website synchronizes the account and requests any missing profile fields.

## Creating an Invitation

In Authentik's invitations list, create a link for `ktp-enrollment` and set custom attributes:

```json
{"group": "active"}
```

Use the intended existing group, such as `pledge`, `eboard`, `chair`, `alumni`, or `rush`. Set expiry and Single use explicitly, then send the link.

The Authentik API calls these attributes `fixed_data`. During the flow, the invitation data is read from `prompt_data`. These names apply at different points and are not interchangeable.

## Enrollment Flow: `ktp-enrollment`

### Stage Bindings

| Order | Stage | Type | Purpose |
| --- | --- | --- | --- |
| 10 | `enrollment-invite` | Invitation | Validate invitation |
| 20 | `enrollment-prompt` | Prompt | Collect email and login fields |
| 30 | `enrollment-user-write` | User Write | Create the account |
| 100 | `enrollment-user-login` | User Login | Establish session; group policy runs on this binding |

Attach submitted-field checks as **Validation Policies on the Prompt Stage**. A policy on a flow's stage binding instead controls whether that stage runs.

### Password requirements

Passwords are handled by Authentik, not by application profile validation. Inspect the deployed Prompt Stage and its validation policies to establish the current requirements. Earlier notes recorded weak-password acceptance; that is not a fresh check of production configuration.

#### Diagnosing a rejected password {#why-the-previous-attempt-failed}

A Password Policy's **Password field** must match the password prompt's **Field Key**. A mismatch can produce `Password not set in context` and reject every submission.

This is a hypothesis to check against the policy configuration and logs, not proof of the cause of every `Password Invalid` message.

#### Where to attach validation {#two-places-policies-attach-and-only-one-is-right}

| Location | Effect |
| --- | --- |
| Prompt Stage → Validation Policies | Validate submitted form data and report errors |
| Flow Stage Binding → Policy Binding | Decide whether the stage runs |

#### Setup

1. Open `enrollment-prompt` and inspect the password prompt's Field Key.
2. Create or edit a Password Policy using that key.
3. Configure the chapter's chosen password requirements and a matching error message.
4. Attach the policy under the Prompt Stage's Validation Policies.
5. Test both rejected and accepted passwords with a disposable invitation.

The earlier proposed configuration used a ten-character minimum without composition rules. Treat that as a proposal to review, not a verified deployed policy or general security standard.

The confirmation prompt is checked by the Prompt Stage. Test a mismatch as well as matching values. If all inputs fail, inspect the field key, policy result, and logs before removing protections.

#### Existing accounts

Changing enrollment validation does not rewrite stored passwords. Check the password-change and recovery flows separately if the same rules should apply there. See [Password recovery](./overview.md#password-reset-for-existing-users).

### Collecting the UGA email at enrollment

Collecting the address during enrollment lets a newly issued token provide it when the application first synchronizes the user.

#### 1. Add the two prompt fields

In `enrollment-prompt`:

| Field Key | Type | Label | Required |
| --- | --- | --- | --- |
| `email` | Email | UGA Email | Yes |
| `password_repeat` | Password | Confirm Password | Yes |

Order the prompts as email, username, password, and confirmation.

#### 2. Enforce the UGA domain, with the alumni exemption

The documented `ktp-uga-email` Expression Policy is:

```python
prompt_data = request.context.get("prompt_data", {})
email = prompt_data.get("email", "").strip().lower()

# Alumni invitations may use a personal address.
if prompt_data.get("group") == "alumni":
    return True

at = email.rfind("@")
domain = email[at + 1:] if at != -1 else ""
if domain == "uga.edu" or domain.endswith(".uga.edu"):
    return True

ak_message("Please use your UGA email address (@uga.edu).")
return False
```

Attach it as a Prompt Stage validation policy. The alumni exemption depends on invitation data being available when the form is validated. Verify that ordering in the deployed flow.

Compare the parsed domain exactly or as a subdomain. A suffix check on the whole address would accept `notuga.edu`; a substring check could accept `uga.edu.attacker.com`. The API's `services/emails.js` provides the corresponding application rule.

The domain check does not prove mailbox ownership.

#### 3. Map the `email` scope so it reaches the database

Select the provider's OpenID email mapping and request the email scope. Newly issued tokens can then carry the address. Check each client provider that synchronizes accounts.

The API does not use `email_verified` as proof of ownership in this enrollment setup. Its synchronization path validates the address before storing it.

#### How it reaches Postgres

`POST /users/sync` seeds an empty `users.email` from a valid UGA token claim. It does not overwrite an existing address. A missing claim is tolerated, and an alumni personal address is not inserted into the UGA-email column.

`test/enrollmentEmail.test.js` covers the application behavior.

Test enrollment with:

1. A non-UGA address: rejected for a non-alumni invitation.
2. A lookalike such as `someone@notuga.edu`: rejected.
3. A UGA subdomain such as `me@mail.uga.edu`: accepted.
4. Mismatched password confirmation: rejected.
5. An alumni invitation with a personal address: accepted.

Then sign into the website and inspect the resulting profile.

### Group Assignment Policy

The documented policy runs on the User Login stage binding at order 100:

```python
from authentik.core.models import Group

group_name = context.get("prompt_data", {}).get("group")
if group_name and request.user:
    try:
        group = Group.objects.get(name=group_name)
        request.user.ak_groups.add(group)
    except Group.DoesNotExist:
        pass

return True
```

This version leaves an unknown or missing group unassigned. The [Rush Signup](../website/rush-signup.md#groupless-accounts-default-to-rush) page describes an optional missing-value fallback to `rush`. Check which version is deployed rather than assuming they behave identically.

Group names must already exist and match exactly. Check successful assignment after a test registration, not just whether the flow completes.

## After Registration

1. Website login calls `POST /users/sync`.
2. An incomplete application profile leads to `/complete-profile`.
3. `PUT /users/me/profile` validates and saves the profile.
4. The website updates its session and routes to the appropriate portal.

### Prevent enrollment from changing an existing account

The recorded enrollment incident involved an authenticated browser updating its existing Authentik user instead of creating a new account.

The documented safeguards are:

| Setting | Value |
| --- | --- |
| Enrollment flow Authentication | Require unauthenticated |
| User Write stage User creation mode | Always create |

Verify both in Authentik. Printed invitations reach Authentik directly, so a website-only guard does not cover every entry point.

Website logout and Authentik logout are separate operations. The documented `ktpapp-invalidation` flow includes user logout and a redirect back to the website. See [Two sessions in one browser](../website/sign-in.md#two-sessions-in-one-browser).

If an existing account was renamed or gained the wrong role, verify the intended identity, repair it in Authentik, and establish a fresh website session. Synchronization then updates application fields from the fresh claims.

### Switching accounts after enrollment

Enrollment establishes the new Authentik session while an older website cookie may still exist. `/auth/start` uses a chooser when it cannot safely identify the intended account.

For a suspected mismatch, record the entry path and the accounts involved without copying tokens. Do not assume a logout alone proves that stored identity data was unaffected.

## Groups in Authentik

| Group | Portal |
| --- | --- |
| `eboard` | `/admin` |
| `chair` | `/member` |
| `active` | `/member` |
| `alumni` | `/alumni` |
| `pledge` | `/pledge` |
| `rush` | `/rushee` |
| `admin` | Infrastructure only |

Group priority is `eboard > chair > active > alumni > pledge > rush`. Names are case-sensitive.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| No group after signup | Invitation attributes, `fixed_data` versus flow `prompt_data`, exact group name, assignment policy |
| Every password rejected | Password Field Key, policy attachment, and actual policy error |
| Email rejected inconsistently | Authentik policy versus `services/emails.js`; alumni invitation data |
| Profile completion repeats | Profile API result and subsequent website session update |
| Wrong portal with correct Authentik membership | Session group claims and a fresh login |
| Stored role unexpectedly shows rush | `group_defaulted` handling and provider groups mapping |
| Unexpected username or account switch | Enrollment account-creation settings and the two-session flow |

API fallback groups must retain `group_defaulted` provenance when code writes a stored role. A guessed `rush` value should not overwrite a known membership.
