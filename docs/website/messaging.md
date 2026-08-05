---
sidebar_position: 3
---

# Messaging

The **Messages** portal tab covers Direct Messages and Group Chats — two genuinely different communication patterns. See [Messages](../api/endpoints.md#messages-direct-messages) and [Group Chats](../api/endpoints.md#group-chats) for the backend routes.

Both use **short-interval polling** (roughly every 5-10 seconds while a relevant view is open) rather than real-time delivery (WebSockets) — this matches every other feature in the app (plain REST + refetch) and needed no new infrastructure. Genuinely instant delivery was considered and explicitly deferred; polling is imperceptibly slow for a chapter this size.

---

## Announcements (not in the Messages tab)

One-way, eboard-only broadcasts — no replies. Eboard picks an audience per post (any combination of groups, or scope to one committee instead) at **`/admin/announcements`**, alongside event creation. Everyone else reads them from the **Dashboard**, filtered server-side to what they're allowed to see — this used to be a tab inside Messages, but moved out since it's a broadcast, not a conversation. See [API: Announcements](../api/endpoints.md#announcements).

---

## Direct Messages

Any member can message any other member — no membership list or approval needed, mirroring the same "everyone's in one shared space together" model used for photos and documents. A conversation is just the two people's message history; there's no separate "start a conversation" step beyond picking someone and sending a message.

Each conversation shows an unread badge and the last message preview. Opening a conversation marks it read.

---

## Group Chats

The one messaging mode that's **not** open to everyone by default: access is checked against an actual membership list in the database, not a broad Authentik group like everything else in the app. Three ways a chat comes to exist:

- **Eboard-created**: eboard names a chat (e.g. "Rush Committee") and assigns specific members — only eboard can create/delete a chat or add/remove members (editable any time after creation).
- **Committee chats**: every [committee](./overview.md#committees) automatically gets its own linked group chat. Joining or leaving the committee joins/leaves its chat too — no separate step.
- **The Eboard chat**: a singleton chat that every current eboard member is automatically in, reconciled on every login against the `eboard` Authentik group (self-healing — there's no explicit "join eboard" action to hook, unlike committees).

**Any member of a given chat** can post — this is a real multi-party thread, not a broadcast, so message bubbles show the sender's name (unlike DMs, where it's just "you" vs. "them").

Eboard can set a **chat photo** as the group's avatar.

### Membership is derived, not a stored roster

A chat's members are the explicitly-added rows in `group_chat_members` **UNION** everyone whose *current* `member_group` is in the chat's `audience` **UNION** everyone in one of its `committee_ids`.

Evaluated at read time on purpose. Before this, a chat's roster was a frozen list of ids expanded from a group at creation time, so promoting a pledge to active left them in the pledge chat forever and never added them to the actives chat, and somebody had to notice and fix it by hand. Deriving membership means a role change moves them automatically.

Audience and committees are **additive** to individual members rather than a replacement, which is what makes "everyone in eboard, plus these two chairs" expressible. `audience IS NULL` means explicit membership only, so every chat created before this keeps working untouched.

### Eboard oversight

Eboard reads **every official chapter chat**, whether or not they're a member — `GET /group-chats/all`, surfaced as an "All chapter chats" toggle in the Group Chats tab. Chats they aren't in open **read-only**: they can read and moderate (delete a message), but not post, because a message from someone the members never added is not something eboard should be able to produce. `sendMessage`, `toggleReaction` and `markRead` all still require real membership.

`is_member_created` (migration `1786700000000`) is what the oversight query filters on:

| Value | Meaning | Eboard sees it |
|---|---|---|
| `FALSE` | official chapter space — committee chats, audience chats, the Eboard chat | **yes**, always |
| `TRUE` | a private space between members | **no** — the way in is a report, not a permission |

**Nothing sets it to `TRUE` yet.** Member-created group chats are a planned feature; the column exists now so the oversight query is already correct the day they ship, rather than being retrofitted under a query that assumed every chat was official. `test/groupChatOversight.test.js` covers both halves, including the branch the product can't reach yet.

:::note DMs and meetings are NOT covered by this
Eboard oversight stops at group chats. Direct messages have no eboard view at all, and [meetings](./meetings.md) remain participant-only — that's the entire reason they live outside `events`. Both were deliberate calls, not gaps.
:::

:::warning One predicate, or the boundaries disagree
`membershipPredicate()` in `groupChatModel.js` generates the SQL, and **every** membership caller uses it: `isMember` (the authorization check behind sending, reacting and marking read), `findForUser` (the chat list) and `countUnread`. A disagreement between them is either a chat you can see but can't open, or one you can open but shouldn't be in.

**`canRead` is deliberately layered on top rather than folded in.** Reads go through `canRead` (member **or** eboard-on-an-official-chat); writes still go through `isMember`. Widening `membershipPredicate` itself to include eboard would have buried their Messages tab under every committee chat and inflated every unread badge, since the same predicate drives the list and the counts.

`findForUser` had to be rewritten to drive from `group_chats` instead of joining from `group_chat_members` — an audience member has no row in that table, so the old join would have hidden every audience-based chat from the list while `isMember` happily let them in.

`findMembers` is the inverse ("who is in this chat") and is also the source of **push recipients** for a group message, so notifications can't drift from membership.
:::

`active` implies `chair` and `eboard`, matching `eventModel.findRecipientIds`: those are exclusive `member_group` values in Authentik but are still active members for targeting purposes.

**The `is_auto` flag.** `findMembers` returns `is_auto`, true when someone qualifies through the audience or a committee and would therefore still be a member with their explicit row deleted. The UI shows an "auto" label rather than a Remove button for them, because `DELETE FROM group_chat_members` would remove no row and report success while they stayed in the chat. `DELETE /group-chats/:id/members/:userId` returns **409** with an explanation as the backstop for a direct API call.

**Editing it.** `PATCH /group-chats/:id/audience` (eboard only) changes which groups and committees a chat follows. It takes effect immediately for everyone, because membership is derived at read time — nothing is backfilled into `group_chat_members`, and anyone who no longer matches drops out on their next request. Explicitly-added individuals are left alone: narrowing an audience must not evict a guest who was deliberately invited.

This replaced an "Add by group" control that expanded a group into individual rows. That was a snapshot — it captured who was in the group at that moment and never updated, which is the exact problem audiences exist to solve.

The **Eboard chat is excluded** (409). Its membership is already reconciled from the `eboard` Authentik group on every login, so an audience would be a second, competing source of truth for the same question.

:::note The roster must refetch when the audience changes
Membership is derived, so the member list in the UI keys on the audience as well as the chat id. Keying on the chat id alone left the old roster on screen until you closed and reopened the chat, which reads as "saving didn't work".
:::

---

## What a message can carry

Both DMs and group chat messages support the same three things:

- **Attachments** — one file per message, 25MB max. Either text or a file is required; both together is fine. Images go to Immich, everything else to ktp-api's own disk.
- **Emoji reactions** — hover a message to react. Sending the same emoji twice removes it.
- **Deletion** — you can always delete your own message. Eboard can delete any message in a conversation they're already part of, as a moderation action.

Two server-side rules that surface as real errors rather than silent failures: message bodies run through a basic profanity filter, and sends are capped at **20 per minute per user**.

---

## Push notifications (iOS)

The iOS app registers an APNs device token with the API, and members can toggle direct-message and event notifications independently.

Worth knowing when debugging: **DM alerts never include the message body**, only that a message arrived. Event alerts fire on create, material update, or cancellation, and only to members who can actually see that event. APNs failures are logged but never fail the underlying send — a push that doesn't arrive does not mean the message failed to send.

There are no web push notifications; this is iOS-only.

---

## Starting a conversation from the Directory

The Member Directory's profile view has a **Message** button that jumps straight to a DM thread with that person (`/member/messages?with=<id>`, or the equivalent path for whichever portal you're in) — see [Profiles & Directory](./profiles-and-directory.md).

## Who is hidden from member lists

Both the **group chat member list** (`groupChatModel.findMembers`) and the **DM conversation list** (`messageModel.findConversations`) exclude:

- **Test accounts** (`is_test_account = true`) — matching the directory and the public roster, which already filtered them in five places. This is display-only: a test account can still be auto-matched into a group chat by audience or committee targeting, it just doesn't appear in the list real members read. You could never *start* a new DM with one anyway, since the picker is backed by `/members`, which already excluded them.
- **Soft-deleted members** (`deleted_at IS NOT NULL`).

:::note Found by testing, not by reading
`findConversations` had never filtered `deleted_at`, so a member who deleted their account kept appearing in everyone's DM list indefinitely — every other surface already excluded them. It surfaced only when the test-account filter was verified against a real database with a deleted user in the fixture.
:::

The member **count** shown in a group chat header is derived from the member list on the client (`members.length`), so it follows these filters automatically rather than being a separate query that could drift.
