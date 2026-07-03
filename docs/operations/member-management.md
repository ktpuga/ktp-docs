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

Removing a member requires two steps: deleting them from Authentik, then removing their record from the database.

### Step 1 — Delete from Authentik

1. Go to [auth.ugaktp.com](https://auth.ugaktp.com)
2. Navigate to **Directory → Users**
3. Find the member and click their name
4. Click **Delete** and confirm

### Step 2 — Remove from Database

After deleting from Authentik, contact Tech Dev to run the following on the database server:

```sql
DELETE FROM users WHERE username = 'their_username';
```

> **Why two steps?** The automatic cleanup (webhook) is not fully working yet. Until it is, the database row must be deleted manually. If this step is skipped, the username may block a future member from registering.

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

1. Go to [auth.ugaktp.com](https://auth.ugaktp.com)
2. Navigate to **Directory → Users**
3. Find the member and click their name
4. Go to the **Groups** tab
5. Remove the old group and add the new one

The change takes effect the next time they log in. The website will automatically route them to the correct portal.

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