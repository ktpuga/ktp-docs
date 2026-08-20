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

The one messaging mode that's **not** open to everyone by default: access is checked against an actual membership list in the database, not a broad Authentik group like everything else in the app. Four ways a chat comes to exist:

- **Eboard-created**: eboard names a chat (e.g. "Rush Committee") and assigns specific members, editable any time after creation.
- **Member-created**: any member except a rushee makes a chat for themselves. Private to the people they add, and administered by whoever made it. See [Member-created chats](#member-created-chats) below.
- **Committee chats**: every [committee](./overview.md#committees) automatically gets its own linked group chat. Joining or leaving the committee joins/leaves its chat too — no separate step.
- **The Eboard chat**: removed. See [below](#the-eboard-chat-was-removed).

**Any member of a given chat** can post — this is a real multi-party thread, not a broadcast, so message bubbles show the sender's name (unlike DMs, where it's just "you" vs. "them").

A chat's administrator can set a **chat photo** as the group's avatar.

### Membership is derived, not a stored roster

A chat's members are the explicitly-added rows in `group_chat_members` **UNION** everyone whose *current* `member_group` is in the chat's `audience` **UNION** everyone in one of its `committee_ids`.

Evaluated at read time on purpose. Before this, a chat's roster was a frozen list of ids expanded from a group at creation time, so promoting a pledge to active left them in the pledge chat forever and never added them to the actives chat, and somebody had to notice and fix it by hand. Deriving membership means a role change moves them automatically.

Audience and committees are **additive** to individual members rather than a replacement, which is what makes "everyone in eboard, plus these two chairs" expressible. `audience IS NULL` means explicit membership only, so every chat created before this keeps working untouched.

### Eboard oversight

Eboard reads **every official chapter chat**, whether or not they're a member — `GET /group-chats/all`, surfaced as an "All chapter chats" toggle in the Group Chats tab. Chats they aren't in open **read-only**: they can read and moderate (delete a message), but not post, because a message from someone the members never added is not something eboard should be able to produce. `sendMessage`, `toggleReaction` and `markRead` all still require real membership.

`is_member_created` (migration `1786700000000`) is what the oversight query filters on:

| Value | Meaning | Eboard sees it |
|---|---|---|
| `FALSE` | official chapter space — committee chats, audience chats | **yes**, always |
| `TRUE` | a private space between members | **no** — the way in is a report, not a permission |

`POST /group-chats/member` is what sets it `TRUE`. `test/groupChatOversight.test.js` and `test/memberGroupChats.test.js` cover both halves of the rule.

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

## The Eboard chat was removed

Removed 2026-08-20 (migration `1788800000000`, which drops `group_chats.is_eboard_chat`). It predated audiences, and audiences do the job properly.

The old mechanism ran `syncEboardChatMembership` on every login: it looked for the one chat flagged `is_eboard_chat`, created it if absent, then added or removed **the person signing in**. Three symptoms, all the same bug seen from different angles:

1. **Deleting it did not stick.** With the row gone the lookup found nothing, so the next eboard login recreated it. The chapter deleted it repeatedly and it kept returning.
2. **It never contained all of eboard.** Membership accrued one person at a time on their own login, so anyone who had not signed in since the chat was created was silently absent — which is the opposite of what an "everyone in eboard" chat promises.
3. **It could not be given an audience or left.** Two special cases answered 409 to stop a second source of truth fighting the reconciliation.

An `audience` of `['eboard']` replaces all of it: membership is evaluated at **read** time, so it is correct for everyone at once and updates the moment somebody joins or leaves the group.

:::note The existing chat was NOT deleted
The migration drops the column, not the row. That is deliberate — a migration should not destroy a chat's message history to tidy up a flag. The chat becomes an ordinary group chat: it can now be renamed, given an audience, left or deleted like any other, and **nothing recreates it**. Delete it and it stays deleted, or keep the history and set its audience to eboard.
:::

:::warning Rolling back does not restore which chat was flagged
The down migration re-adds the column, but the value is gone the moment the column drops, so every chat comes back unflagged. That is the safe direction: the worst case is an ordinary chat named "Eboard", rather than a re-armed singleton fighting an audience somebody has since set.
:::

There is no longer an Eboard-chat exception here. That chat used to answer 409, because its membership was reconciled on every login and an audience would have been a second, competing source of truth. The automation is gone, so an eboard chat is now given `audience = ['eboard']` like any other.

:::note The roster must refetch when the audience changes
Membership is derived, so the member list in the UI keys on the audience as well as the chat id. Keying on the chat id alone left the old roster on screen until you closed and reopened the chat, which reads as "saving didn't work".
:::

### Member-created chats

:::danger Creation is TURNED OFF right now (since 2026-08-12)
Members cannot currently create new group chats. **Existing member-created chats are untouched** and keep working normally — this only stops new ones.

It is a hardcoded kill switch, not a database flag or an env var, and it lives in **two files that must be flipped together**:

| Repo | File | Constant |
|---|---|---|
| ktp-api | `routes/groupChats.js` | `MEMBER_CHAT_CREATION_ENABLED = false` |
| uga-ktp-website | `components/portal/MessagesPage.jsx` | `MEMBER_CHAT_CREATION_ENABLED = false` |

Flipping only the website hides the button while `POST /group-chats/member` still answers, which is a hidden control rather than a closed feature. Flipping only the API leaves a visible button that 403s.

**Eboard keeps its New Group Chat button**, because theirs creates *official* chapter chats through a different endpoint (`POST /group-chats`) that is not being turned off. The Chapter/Personal toggle inside the modal is hidden while the switch is off, so eboard cannot pick "Personal" and get a 403 from the closed route.

Everything in the rest of this section describes the feature as it behaves when re-enabled.
:::

Any member **except a rushee** can make their own group chat: active, pledge, chair, alumni and eboard. In the Group Chats tab, **New Group Chat** opens the same modal everyone else uses, minus the group and committee pickers. Eboard sees one extra control, a **Chapter chat / Personal chat** choice, defaulting to Chapter so the button keeps meaning what it always meant.

The rule members are shown, in the modal itself, is that the chat is private to the people they add and eboard can't read it unless someone reports a message in it. That is stated rather than assumed: nobody can guess either half of it.

#### Who can administer one

Renaming a chat, deleting it, changing its photo, and adding or removing members depend on **the chat**, not on the caller's Authentik groups:

| Chat | Administrator |
|---|---|
| Official (`is_member_created = FALSE`) | eboard |
| Member-created (`is_member_created = TRUE`) | its creator, and **not** eboard |

Creating an official chat confers nothing afterwards, or any member who once made a committee chat would keep power over it.

**Renaming** is the pencil beside the chat's name in the info modal, and it works on every chat type including committee chats. A committee chat's name is not re-derived later, so nothing overwrites a hand-set one. If committee renaming is ever built, that's the moment to decide whether it repoints its chat's name.

:::warning This was a real hole, closed with the feature
Those five routes used to be `requireGroup("eboard")` and never consulted `is_member_created`, so **eboard could delete or repopulate a member chat they were forbidden to read** — a larger power than the read they'd been denied. A router-level group check can't express "unless a member made it" because the answer depends on the row, so the check moved into `groupChatsController.loadAdministrable` and those routes now carry no `requireGroup` at all.
:::

#### Members' chats hold people, not groups

A member's chat takes an explicit member list only. `audience` and `committee_ids` are refused, **including from the creator** (409). A chat that auto-follows "every active member" and keeps following role changes is a broadcast channel, and letting a member conjure one is a spam vector wearing a feature's clothes. Rushees can't be added to one either: their surface is deliberately narrow and their DMs are leadership-only, so this would route around both.

#### Leaving

`DELETE /group-chats/:id/leave` removes you from a chat, and it's the one roster change that needs no administration right. It's a separate path rather than `DELETE /:id/members/me` because that would be matched by the `:userId` route and inherit its administration check. Four refusals, each mirrored in the UI so the button only appears when it will work:

| Case | Why |
|---|---|
| You're in via the audience or a committee | No row to delete, so it would report success and leave you in the chat |
| You created the chat | Nobody else could administer it afterwards. Delete it instead |

| You're viewing through eboard oversight | You aren't in the chat to begin with |

### The report escape hatch

An **open** report naming a message in a member-created chat opens that chat to eboard. Without it the privacy rule would be absolute and a report on a member chat unactionable: eboard would receive a complaint about a conversation they cannot open.

- **It ends by itself.** `canRead` reads `status = 'open'` live, so resolving or dismissing the report closes the chat again. Nothing is granted that would later need revoking.
- **Reading is not participating.** Reads go through `canRead`, writes through `isMember`, so eboard can read the chat and delete the offending message but cannot post in it.
- **It's reachable from the report, not by browsing.** A reported chat still doesn't appear in `GET /group-chats/all`. Otherwise a moderation grant quietly becomes general surveillance.

:::warning Two details in the join hold the whole thing up
`reports.content_id` is one loose `TEXT` column shared by DMs, group messages and photos, so the **column itself** will hold any string at all.

The join must therefore read `gcm.id::text = r.content_id`, never `r.content_id::integer`. A single report filed as `group_message` with a non-numeric `content_id` would make an integer cast throw `22P02` and take down `canRead` for **every** eboard read at once, not just that chat — a one-request denial of service available to anyone who can file a report.

`reportsController` now validates `content_id` on the way in, so the API can no longer create such a row. **That is not a reason to relax the cast.** It still guards rows written before the validation existed, which nothing cleans up, and the read is what breaks, so the read is where it should be impossible.

`content_type = 'group_message'` is a filter, not decoration. Ids restart per table, so without it a DM report whose id collided with a group message's would unlock an unrelated chat.
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
