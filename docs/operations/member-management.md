---
sidebar_position: 1
---

# Member Management

This guide covers account creation, group changes, removal, and password recovery. Authentik manages login accounts at [auth.ugaktp.com](https://auth.ugaktp.com). Direct administration requires an authorized Authentik account; eboard can also change member roles through the website.

## Adding a New Member

Create an invitation for the intended role.

### Step 1: Create the invitation {#step-1--create-the-invitation}

1. Sign into Authentik's admin interface.
2. Open the invitations list and create an invitation.
3. Give it a recognizable name and select `ktp-enrollment`.
4. Set its custom attributes, for example:

   ```json
   {"group": "active"}
   ```

5. Choose an expiry and enable Single use for an individual invitation.
6. Create it and send the resulting link to the member.

| Group | Intended members |
| --- | --- |
| `active` | Active members |
| `pledge` | Current pledge class |
| `eboard` | Executive board |
| `chair` | Committee chairs |
| `alumni` | Alumni |

See [Enrollment](../authentik/enrollment.md) for flow configuration and [Rush Signup](../website/rush-signup.md) for shared prospective-member invitations.

### Step 2: Member registers {#step-2--member-registers}

The member follows the invitation, chooses login credentials, and receives the invitation's group. They then sign into [ugaktp.com](https://ugaktp.com) and complete the required profile fields before entering their portal.

## Removing a Member

1. In Authentik, open **Directory → Users**.
2. Select the account.
3. Choose **Delete** and confirm the intended account.

The deletion notification calls the API to remove the matching application user. If the member remains listed, check webhook delivery and the stored Authentik integer ID. See [User-deletion webhook](../authentik/overview.md#webhook-user-deletion).

Deleting an Authentik account differs from the member's self-service deletion, which anonymizes the application profile without removing the login account.

## Resetting a Member's Password

1. Open **Directory → Users** in Authentik.
2. Select the user and choose **Recovery Link**.
3. Send the link to that user so they can set a new password.

## Changing a Member's Group

For eboard, use [Admin → Users](https://ugaktp.com/admin/users):

1. Find the member.
2. Choose the new group in their row.
3. Confirm that the update succeeds.

The API changes Authentik membership first, then updates the application database. Stored profile roles update immediately, but an existing session or access token may still contain older groups until refreshed or replaced.

If the website operation is unavailable, an authorized Authentik administrator can edit **Directory → Users → Groups**, removing the old role and adding the intended one. The application synchronizes groups on login and when refreshed groups are processed. Signing out and back in obtains a new session for checking the result.

## Checking a Member's Status

Authentik's user Groups tab shows identity-provider membership. The website's admin user list shows application profile data. These can temporarily differ when a session still contains older claims.

When investigating a mismatch, record the intended role and compare Authentik membership, the application profile, and a newly established session.

## Bulk Onboarding (New Pledge Class)

1. Create individual invitations with `{"group": "pledge"}`, or a shared invitation if that is the intended access policy.
2. Set Single use and expiry explicitly. Expiry and reuse are separate controls.
3. Send the appropriate links.
4. Confirm that members register and complete their profiles.

After initiation, change their role from `pledge` to `active`.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Invitation does not work | Expiry, Single use, prior redemption, and selected enrollment flow |
| Wrong portal | Current Authentik groups, role priority, and a fresh website session |
| Cannot sign in | Username and account status; use a recovery link when a password reset is needed |
| Returns to profile completion | The profile-save response and required-field validation; ask Tech Dev to inspect the API and session state |
| Deleted account remains listed | Webhook delivery, matching `authentik_pk`, and API logs |
