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

> **Important:** The `enrollment-prompt` stage must have **no validation policies** attached. Authentik's default validation policies (password strength, username format, etc.) cause crashes during enrollment and must all be removed from the stage binding.

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
| `alumni` | /alumni |
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

**User stuck on /complete-profile after submitting:**
- Check API logs on LXC 119: `docker logs ktp-api`
- Confirm `PUT /users/me/profile` returns 200 — if it errors, the session update won't fire

**User in wrong portal:**
- Check their groups in Authentik: **Directory → Users → select user → Groups tab**
- Group priority: `eboard > chair > active > pledge > alumni`
- The DB `member_group` updates on every login via `/users/sync`