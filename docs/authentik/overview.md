---
sidebar_position: 1
---

# Overview

Authentik manages KTP Georgia's login accounts, passwords, and single sign-on. The website and API use its tokens to identify callers. Member profiles and committee membership are stored separately in the application database.

**Public address:** [auth.ugaktp.com](https://auth.ugaktp.com)
**Internal address:** `http://10.0.0.4:9000` on LXC 103.

## What Authentik Does

| Responsibility | Owner |
| --- | --- |
| Login usernames and passwords | Authentik |
| Role groups, such as `active` and `eboard` | Authentik |
| Identity-provider login session | Authentik |
| Website session and token refresh | NextAuth in the website |
| Profile data and committee membership | PostgreSQL through ktp-api |
| Portal routing | Website `proxy.ts` and `lib/home-portal.js` |
| API permissions | API middleware, controllers, and models |

The applications do not store members' login passwords. They do hold session tokens and deployment credentials needed to communicate with Authentik.

## OIDC Application

The website and iOS app use separate Authentik providers. The API accepts tokens from either configured issuer.

| Client | Application slug | Issuer |
| --- | --- | --- |
| Website | `ktpapp` | `https://auth.ugaktp.com/application/o/ktpapp/` |
| iOS | `ktpios` | `https://auth.ugaktp.com/application/o/ktpios/` |

The API's corresponding internal JWKS URLs are:

```text
http://10.0.0.4:9000/application/o/ktpapp/jwks/
http://10.0.0.4:9000/application/o/ktpios/jwks/
```

Configure the website provider with `AUTHENTIK_ISSUER` and `AUTHENTIK_JWKS_URL`, and the iOS provider with `AUTHENTIK_IOS_ISSUER` and `AUTHENTIK_IOS_JWKS_URL` in ktp-api. The issuer must match the token even when keys are fetched through an internal address.

### Redirect URIs (strict)

The documented website callback URLs are:

- `https://ugaktp.com/api/auth/callback/authentik`
- `https://ktpgeorgia.com/api/auth/callback/authentik`

Add the callback for a development origin when needed, such as `http://localhost:3000/api/auth/callback/authentik`. These are website callbacks; configure the iOS provider with the app's own redirect URI.

### PKCE and state checks

The website's current `auth.ts` provider configuration sets `checks: []`, disabling PKCE and state checks. Earlier deployment notes attribute this to callback-cookie failures behind the reverse proxy.

This describes the current configuration, not a requirement imposed by Traefik. Any change should be tested through the deployed login and callback flow, including cookie handling.

### `prompt=none`

The login flow uses `prompt=none` to check for an existing Authentik session without showing a login form. Consent and session configuration affect whether this succeeds. See [Sign-In Flow](../website/sign-in.md).

The website requests `openid email profile groups offline_access`. The refresh path needs a refresh token; a website session being present does not by itself establish that its access token is still valid.

## Groups and Portal Routing

| Authentik group | Portal | Notes |
| --- | --- | --- |
| `eboard` | `/admin` | Executive board |
| `chair` | `/member` | Committee chairs |
| `active` | `/member` | Active members |
| `alumni` | `/alumni` | Alumni portal |
| `pledge` | `/pledge` | Current pledge class |
| `rush` | `/rushee` | Prospective members; `/rush` is the public page |
| `admin` | None | Infrastructure administration does not grant a chapter portal |

When groups overlap, priority is:

```text
eboard > chair > active > alumni > pledge > rush
```

The API defines role priority in `constants/roleGroups.js`. The website routes through `lib/home-portal.js`. Keep these aligned when changing roles. For example, a new pledge who still has `rush` should reach the pledge portal.

User synchronization stores the highest-priority role in `users.member_group` on login and when refreshed groups are synchronized. Admin group changes also update the stored role. Existing tokens can retain old group claims until replaced.

The website sends an account with no recognized group to `/`. The API has a separate fallback: it adds `rush` for request authorization and marks the result `group_defaulted` so synchronization does not overwrite a known stored role with that guess.

## Property Mappings

The deletion webhook matches users through Authentik's integer primary key. Add this property mapping to each provider that needs to supply it:

| Name | Scope | Expression |
| --- | --- | --- |
| KTP User PK | `openid` | `return {"authentik_pk": request.user.pk}` |

Select the mapping in the provider's Property Mappings. Without the claim, synchronization cannot populate `authentik_pk` from that token, and deletion cannot match a row whose key is still null.

## API Tokens / Service Accounts

`services/authentikAdmin.js` calls Authentik's REST API for group changes, enrollment invitations, and username changes. This uses `AUTHENTIK_API_TOKEN`, separate from the bearer access tokens members send to ktp-api.

Use a dedicated service account, `ktp-api-service`, so access does not depend on a particular member retaining their role.

The documented setup is:

1. In **Directory → Users**, create the service account. Save any generated token when shown.
2. Create a group for the service account and add it as a member.
3. Create a role, such as `ktp-api-group-manager`, and assign it to that group.
4. On each managed role group (`eboard`, `chair`, `active`, `alumni`, and `pledge`), assign object permissions to that role: **Add user to group**, **Remove user from group**, and **Can view Group**.
5. In the role's **Assigned global permissions**, grant **Can view User**. Username changes also require **Can change User**. Initial Permissions apply to newly created objects and are not the same setting.
6. If creating a token separately, use **Directory → Tokens and App passwords**, select the service account as Identity, and choose **API Token** as Intent.
7. Store it as `AUTHENTIK_API_TOKEN` in the API deployment environment. Recreate the container with `docker compose up -d` to apply changed environment variables; `docker compose restart` does not reload them.

These group permissions cover the named groups only. Invitation management has its own permission requirements; see [Enrollment](./enrollment.md).

The username helper sends `PATCH /core/users/{pk}/` with only `{ username }`. The self-service controller selects the authenticated user; the eboard endpoint can select another member. The **Can change User** grant is broader than these operations, so the API must enforce the target and accepted fields.

A username collision returns `409`. An Authentik write failure returns `502`; inspect the API's username-update logs for the upstream status. A `403` from Authentik can indicate missing service-account permissions.

See [Changing a member's group](../api/overview.md#eboard-changing-a-members-group) for the API workflow.

## Webhook (User Deletion)

An Authentik notification transport calls:

```text
POST http://10.0.0.53:4000/webhooks/authentik
X-Authentik-Token: <WEBHOOK_SECRET>
```

The current API handler reads this nested payload:

```json
{
  "event": {
    "action": "model_deleted",
    "context": {
      "model": {
        "model_name": "user",
        "pk": 42
      }
    }
  }
}
```

When the token matches and the event identifies a deleted user, the API deletes rows matching `users.authentik_pk`. This differs from self-service account deletion, which anonymizes the application row without deleting the Authentik account.

The documented notification configuration uses:

- Event Matcher Action: **Model Deleted**.
- Model: **User (authentik_core)**.
- App: leave blank.
- Notification Rule: set a Group or enable **Send notification to event user**.

The Event Matcher App setting checks `event.app`, not `event.context.model.app`. A rule without a recipient setting does not send the notification in the documented deployment.

To investigate a missing deletion, check both ends:

1. On the Authentik host, use `docker ps` to find the worker container, then inspect `docker logs <worker-container>`. Its `policy_execution` records show matching results.
2. In the API logs, find `[webhook] received`. Check whether the request arrived, whether the secret matched, and whether the nested action and model were recognized.
3. If the event was processed but the row remains, check the stored `authentik_pk` against the event's `pk`.

Do not include the webhook secret in diagnostic notes.

## Password Reset for Existing Users

The documented login flow does not force existing users through a password reset. For an individual reset:

1. Open **Directory → Users** in Authentik and select the user.
2. Choose **Recovery Link**.
3. Send the link to that user.

New users set a password during enrollment and do not need a separate recovery step.
