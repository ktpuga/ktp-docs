---
sidebar_position: 1
---

# Member Management

This guide covers how to add, remove, and manage members in the KTP system. All member accounts live in **Authentik** — the login system at [auth.ugaktp.com](https://auth.ugaktp.com). You'll need admin access to Authentik to perform these tasks.

> **Who can do this:** Tech Dev VP or anyone with Authentik admin access.

---

## Adding a New Member

Members are added through **invitation links**. Each invite is tied to a group (active, pledge, eboard, etc.) and automatically assigns the member when they register.

### Step 1 — Create the Invitation

1. Go to [auth.ugaktp.com](https://auth.ugaktp.com) and log in as admin
2. Navigate to **Directory → Invitations**
3. Click **Create**
4. Fill in:
   - **Name:** Something recognizable (e.g. "Spring 2026 Pledges" or "Jane Smith")
   - **Flow:** `ktp-enrollment`
   - **Custom attributes:**
     ```json
     {"group": "active"}
     ```
     Change `"active"` to the correct group for this member:

     | Group | Who |
     |-------|-----|
     | `active` | Active members |
     | `pledge` | Current pledge class |
     | `eboard` | Executive board |
     | `chair` | Committee chairs |
     | `alumni` | Alumni |

5. Click **Create**
6. Copy the invite link and send it to the member

### Step 2 — Member Registers

The member clicks the link and:
1. Chooses a username and password
2. Gets automatically added to their group
3. Logs in at [ugaktp.com](https://ugaktp.com) and completes their profile (name, major, graduation date, etc.)

After completing their profile, they'll be taken directly to their portal.

---

## Removing a Member

1. Go to [auth.ugaktp.com](https://auth.ugaktp.com)
2. Navigate to **Directory → Users**
3. Find the member and click their name
4. Click **Delete** and confirm

That's it — a webhook automatically removes their row from the website's database within moments, no manual database step needed. (If a deleted member still shows up in the Directory or admin panel after a few minutes, the webhook may be broken — see [API: Webhooks](../api/endpoints.md#post-webhooksauthentik) for how to diagnose it, and contact Tech Dev.)

---

## Resetting a Member's Password

1. Go to [auth.ugaktp.com](https://auth.ugaktp.com)
2. Navigate to **Directory → Users**
3. Find the member and click their name
4. Click **Recovery Link**
5. Copy the link and send it to the member — they'll use it to set a new password

---

## Changing a Member's Group

For example, moving a pledge to active after initiation, or a member to alumni after graduation.

**Preferred method — from the website (eboard only):**

1. Log into [ugaktp.com/admin/users](https://ugaktp.com/admin/users)
2. Find the member and use the group dropdown on their row
3. Pick the new group

This takes effect **immediately** — no need for the member to log out and back in. It calls Authentik directly to make the actual change there (Authentik stays the source of truth), then updates the website's own records right away.

**Fallback method — directly in Authentik** (if the website method is unavailable):

1. Go to [auth.ugaktp.com](https://auth.ugaktp.com)
2. Navigate to **Directory → Users**
3. Find the member and click their name
4. Go to the **Groups** tab
5. Remove the old group and add the new one

This way, the change only takes effect the next time the member logs in (the website re-syncs their group on every login) — not immediately.

---

## Checking a Member's Status

To see what group a member is in or whether they've completed their profile:

1. Go to [auth.ugaktp.com](https://auth.ugaktp.com)
2. Navigate to **Directory → Users**
3. Find the member — their groups are shown under the **Groups** tab

For profile completion status, contact Tech Dev to check the database.

---

## Bulk Onboarding (New Pledge Class)

When onboarding an entire pledge class at once:

1. Create one invitation per person (or reuse the same invitation link — it can be used multiple times by default unless you set an expiry)
2. Set **Custom attributes** to `{"group": "pledge"}` for all of them
3. Send each person their unique invite link, or share a single link if the invitation allows multiple uses
4. Confirm each person completes their profile by logging into [ugaktp.com](https://ugaktp.com)

After initiation, repeat the **Changing a Member's Group** steps above to move them from `pledge` → `active`.

---

## Troubleshooting

**Member says their invite link isn't working:**
- Check if the invitation has expired — go to Directory → Invitations and verify it's still listed
- Re-create the invitation and send a new link

**Member is being sent to the wrong portal:**
- Check their groups in Authentik (Directory → Users → Groups tab)
- Remove the incorrect group and add the correct one
- Have them log out and log back in

**Member says they can't log in:**
- Verify their username exists in Authentik (Directory → Users)
- Use the Recovery Link option to send them a password reset

**Member completed their profile but got sent back to complete-profile:**
- Contact Tech Dev — this is a technical issue with the profile save