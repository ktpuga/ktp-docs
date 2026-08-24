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

---

## Starting a conversation from the Directory

The Member Directory's profile view has a **Message** button that jumps straight to a DM thread with that person (`/member/messages?with=<id>`, or the equivalent path for whichever portal you're in) — see [Profiles & Directory](./profiles-and-directory.md).
