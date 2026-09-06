---
sidebar_position: 12
---

# Activity Log

Eboard can review recorded changes in the **Activity Log** tab at `/admin/oversight`. Entries identify the actor, operation, target, and result.

## Written by middleware, not by controllers

`middleware/auditLog.js` is registered globally above the routers. Controllers do not need individual `logAction()` calls.

Authentication runs inside the routers, so `req.user` may be undefined when the audit middleware is entered. Read the actor in the `res.on("finish")` hook after the router has run. `test/auditLogWrite.test.js` checks this ordering through an Express app.

Recording is asynchronous and cannot fail the response it describes:

```js
void auditLogModel.record({ ... }).catch((err) => console.error("[auditLog]", err.message))
```

`middleware/logFailures.js` separately records API 4xx and 5xx responses in server logs. It uses `warn` below 500 and `error` for server errors. Controllers still need to log reasons that a shared response message cannot distinguish.

Failure logs redact credentials in attendance and calendar-feed paths and drop query strings. Add redaction when introducing another URL containing a secret.

## Excluded requests {#what-is-deliberately-not-logged}

The middleware's `SKIP` list excludes private or high-volume operations. Examples:

| Skipped | Reason |
| --- | --- |
| Direct-message routes | Keep private conversation activity out of the eboard audit log |
| Group-message and read-marker routes | Preserve chat privacy and avoid read-marker noise |
| `/users/sync` | Routine login and refresh synchronization |
| `/notifications/*` | Device registration and notification state |
| `/checkin/*` | Attendance rows already record scans |
| Exact report and ticket creation paths | Avoid identifying anonymous submitters through audit metadata |

Report and ticket updates remain audited. The creation exclusions must stay exact so they do not hide moderation decisions.

Only `POST`, `PUT`, `PATCH`, and `DELETE` are eligible. Reads and `401`/`403` responses are excluded. Other failed operations can appear in the log.

`summary` stores only `SAFE_SUMMARY_KEYS`, such as title, name, status, and audience. It does not store the raw request body. Keep this an allowlist so new fields do not expose private content or credentials. Strings are capped at 200 characters.

## Reading it

`GET /audit-log` is eboard-only and returns newest entries first.

| Parameter | Effect |
| --- | --- |
| `limit` / `offset` | Pagination; limit capped at 200 |
| `target_type` | Filter by target, such as event, album, or committee |
| `failed=true` | Return recorded non-2xx responses |

`GET /audit-log/types` returns the target types present in the log for the filter dropdown.

Actor names use the live name when available and a saved name otherwise. The saved value keeps an entry identifiable after the related account is deleted or anonymized.

## Turning a route into English

`services/auditActions.js` maps method and path to an action and target. For example, `DELETE /events/12` becomes "Deleted an event" with target `event#12`.

The first matching rule wins. Put specific paths, such as album visibility, before general album paths. Unmapped routes receive a generic description, such as "Created something under /widgets", so newly added operations can still appear.
