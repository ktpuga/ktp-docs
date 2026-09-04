---
sidebar_position: 12
---

# Activity Log

Every state-changing request across the site, readable by eboard on the **Activity Log** tab of **`/admin/oversight`**. Answers "who deleted that?" — the question that only ever gets asked about the action nobody anticipated.

## Written by middleware, not by controllers

The entire design rests on one decision: entries are recorded by `middleware/auditLog.js`, registered **once, globally**, above the routers. There is no `logAction()` call inside any controller.

:::tip Its counterpart: `middleware/logFailures.js`
Same shape, opposite subject. The audit log records what **succeeded**, for eboard to read. `logFailures` records every **4xx/5xx** the API sends, for us to read — `warn` below 500, `error` at 500 and above, so real breakage is not buried under ordinary refusals.

It exists because silent refusals made a live bug undiagnosable: `selfCheckIn` logged on its two 500 paths and none of its four refusals, so a production log covering a whole event contained **no lines at all** while people were being turned away at the door. An audit found **366 more 4xx returns across 27 controllers** with nothing logging near them — which is exactly why this is middleware rather than 366 edits that the next feature would drift from.

⚠ It does **not** replace a controller logging its own *reason*. It can only report what was sent; it cannot know that "That check-in code has expired" was really "attendance is not enabled on this event".

⚠ **The path can be a credential**, and two are: `/checkin/:eventId/:token` carries the live rotating code, and `/calendar/feed/:token` *is* the feed's entire credential. Both are redacted by **shape**, not route name, so remounting a route keeps its redaction; query strings are dropped whole. Adding a route with a secret in its URL means adding a redaction.
:::

A log you have to remember to write is missing exactly the case being investigated. Middleware cannot be forgotten when somebody adds a route next semester — a brand-new endpoint is logged the moment it exists, before anyone writes a rule for it.

:::warning The ordering is subtle and load-bearing
`requireAuth` lives **inside each router**, so it has not run when the audit middleware is entered — `req.user` is `undefined` at that point.

The middleware therefore reads the actor inside a `res.on("finish")` hook, which fires *after* the router. Move this middleware below the routers, or read `req.user` at request time instead, and every entry silently gets a null actor. The log keeps working and becomes useless. `test/auditLogWrite.test.js` asserts the actor resolves correctly through a real Express app for this reason.
:::

The write is fire-and-forget and cannot fail the request it describes:

```js
void auditLogModel.record({ ... }).catch((err) => console.error("[auditLog]", err.message))
```

## What is deliberately not logged

`SKIP` in the middleware. Each entry is a decision, not an oversight.

| Skipped | Why |
|---|---|
| `/messages/*` | **Privacy.** Direct messages are the one thing eboard may not see. "Ann messaged Ben at 2am" is precisely what the DM boundary protects — logging the metadata would hand it over through the back door. |
| `/group-chats/:id/messages*`, `/read` | Same reasoning. Eboard already reads the official chats they oversee; member-created chats are deliberately private. See [Messaging](./messaging.md#eboard-oversight). |
| `/users/sync` | Fires on every login and token refresh. Pure noise. |
| `/notifications/*` | Push device registration churn. |
| `/checkin/*` | One row per scan; `event_attendance` already records it with timestamps. |

Reads (`GET`, `HEAD`) are never logged — only `POST`, `PUT`, `PATCH`, `DELETE`. `401`/`403` responses are dropped too: an expired token is not an audit event, and logging every one would bury the real entries.

:::danger The summary is an allowlist
`summary` stores only `SAFE_SUMMARY_KEYS` — `title`, `name`, `status`, `audience`, and similar. The raw request body is **never** stored.

This must stay an allowlist. A denylist is one new field away from writing a message body, a password or an access token into a table eboard reads, and the safe default for an unknown key is to drop it. String values are capped at 200 characters so no single field can turn the log into a document store.
:::

## Reading it

`GET /audit-log` — eboard only, newest first.

| Param | Effect |
|---|---|
| `limit` / `offset` | Paging; `limit` is capped at 200 server-side |
| `target_type` | Narrow to `event`, `album`, `committee`, … |
| `failed=true` | Only non-2xx responses |

`GET /audit-log/types` backs the filter dropdown, returning only types that actually occur.

**Failed attempts are kept on purpose.** Somebody trying to delete something they couldn't is often the interesting entry; hiding non-2xx rows would make the log quietly incomplete.

The actor's name is `COALESCE(live name, snapshot taken at write time)`. The snapshot is deliberately duplicated onto the row: `users` rows get anonymised and deleted, the FK nulls out, and an entry reading "someone deleted the Spring Formal album" is useless exactly when the question gets asked.

## Turning a route into English

`services/auditActions.js` maps method + path to a sentence: `DELETE /events/12` → *"Deleted an event"*, target `event#12`.

It's an ordered list, **first match wins**, so specific patterns must precede general ones — `/albums/:id/visibility` before `/albums/:id`, or every visibility change reads as "Deleted an album".

Unmapped routes fall through to `"Created something under /widgets"` rather than being dropped. That fallback is the point: a route added later still appears in the log, which is the failure this whole feature exists to prevent. Adding a rule for it is a display improvement, not a correctness fix.
