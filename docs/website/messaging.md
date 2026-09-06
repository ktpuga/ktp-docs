---
sidebar_position: 3
---

# Messaging

The Messages tab contains direct messages and group chats. Views poll roughly every five to ten seconds while open; delivery is not WebSocket-based. See the [DM](../api/endpoints.md#messages-direct-messages) and [group-chat](../api/endpoints.md#group-chats) API references.

## Announcements (not in the Messages tab)

Announcements are one-way posts with no replies. Eboard and chairs can create them subject to targeting permissions. Events are managed from Calendar. Reads are filtered by audience and committee membership. See [Announcements](../api/endpoints.md#announcements).

## Direct Messages

A thread consists of messages between two people. Selecting a person and sending a message starts the conversation. Rushee conversations have an additional leadership restriction; broad member-directory visibility does not grant permission to message every account.

Conversation rows show the last message and unread count. Opening a thread marks it read.

`findConversations` and `countUnread` must exclude the same hidden senders, including test and deleted accounts. Otherwise a badge can count messages in a thread the member cannot open.

## Group Chats

Official chats can use explicit members, audience groups, and committees. Existing member-created chats use explicit members only; new member-created chats are currently disabled.

A member can post in the chat. The chat administrator can rename it, manage explicit members, and set its photo. Committees no longer create or own a separate linked chat.

### Membership is derived, not a stored roster

Membership combines:

1. Rows in `group_chat_members`.
2. Users whose current stored role matches `audience`.
3. Members of the chat's `committee_ids`.

The audience and committee sources are evaluated on reads. They add to explicit membership rather than replacing it. A null audience with no committees leaves only explicit members.

Targeting `active` includes chairs and eboard. A role or committee change affects derived access on later requests.

### Eboard oversight

`GET /group-chats/all` lists official chats for eboard's **All chapter chats** view. Eboard may read and moderate an official chat without joining, but sending, reacting, and marking read still require membership.

| `is_member_created` | Type | General eboard oversight |
| --- | --- | --- |
| `FALSE` | Official | Allowed |
| `TRUE` | Member-created | Excluded |

Direct messages have no general eboard oversight view. Meetings remain participant-only.

`membershipPredicate()` supplies shared membership SQL for authorization, the chat list, and unread counts. `canRead` adds the separate oversight/report rules; do not add those readers to the membership predicate.

`findMembers` supplies both the displayed roster and push recipients. Its `is_auto` flag identifies users who would remain members through an audience or committee even if an explicit row were removed. The UI hides removal for them; the API returns `409`.

`PATCH /group-chats/:id/audience` changes an official chat's targeting without rewriting explicit members. Refresh the roster after this change; keying it only by chat ID can leave stale members on screen.

## The Eboard chat was removed

Migration `1788800000000` removed the `is_eboard_chat` flag and login-time synchronization. It retained the chat row and message history.

An existing Eboard chat is now an ordinary official chat. Set `audience = ['eboard']` if it should follow that role. Deleting it no longer causes the next login to recreate it.

The down migration can restore the column but cannot reconstruct which row previously held the flag.

### Member-created chats

Creation is disabled by matching constants:

| Repository | File | Setting |
| --- | --- | --- |
| API | `routes/groupChats.js` | `MEMBER_CHAT_CREATION_ENABLED = false` |
| Website | `components/portal/MessagesPage.jsx` | `MEMBER_CHAT_CREATION_ENABLED = false` |

Keep both aligned. Existing member-created chats continue working. Eboard's official-chat endpoint remains available, and the modal hides the personal-chat choice while creation is disabled.

When enabled, member groups including pledges and alumni can create a personal chat. Rushees cannot. Eboard can choose between an official and personal chat.

#### Who can administer one

| Type | Administrator |
| --- | --- |
| Official | Eboard |
| Member-created | Its creator |

`groupChatsController.loadAdministrable` checks the row for rename, deletion, photo, and member-management operations. A router-level eboard check alone cannot express both rules.

Creating an official chat does not grant permanent administration rights through its creator field.

#### Members' chats hold people, not groups

Member-created chats reject audience and committee targeting, including requests from their creator. They also reject rushee invitees. These restrictions apply in the API as well as the form.

#### Leaving

`DELETE /group-chats/:id/leave` removes the caller's explicit membership without requiring administration rights.

| Caller state | Result |
| --- | --- |
| Membership also comes from audience or committee | `409`; explicit removal cannot revoke derived access |
| Creator of a member-created chat | `409`; delete the chat instead |
| Eboard reading only through oversight | Not a member, so cannot leave |
| Explicit member without another membership source | Can leave |

### The report escape hatch

An open report naming a group message can grant eboard read access to that member-created chat. Resolving or dismissing the report removes this access when `canRead` is evaluated again.

This does not add the chat to the general oversight list or make the moderator a participant. Eboard can inspect and moderate through the report without gaining send/reaction rights.

The report join must include `content_type = 'group_message'` and compare `gcm.id::text = r.content_id`. Casting the stored text reference to integer can fail on older malformed rows; omitting the content type can match an unrelated table's ID.

## What a message can carry

- One attachment up to 25 MB. Text, a file, or both are allowed. Images go to Immich; other attachments use API disk storage.
- Replies to a message in the same conversation or chat.
- Reactions that toggle when the same value is sent again. A row of eight
  quick emoji, with a plus that opens a searchable directory of roughly 350
  covering eight categories, with recently used remembered per browser. The
  API accepts one emoji and refuses anything else.
- An emoji button in the composer, opening the same directory and inserting
  at the cursor rather than at the end of the message.
- Deletion by the sender, plus the applicable moderation rules.

Sends are limited to 20 per minute per user. The earlier profanity-filter module is no longer present in the current API.

## Push notifications (iOS)

The app registers an APNs token and manages notification preferences. DM alerts do not include message bodies. Push failures are logged without failing the saved message.

The website does not implement browser push notifications. See [Notifications](./notifications.md) for preferences and reminders.

## Starting a conversation from the Directory

The directory's **Message** action opens `/<portal>/messages?with=<id>`. The API still checks whether the caller can message that person. See [Profiles & Directory](./profiles-and-directory.md).

## Who is hidden from member lists

`groupChatModel.findMembers` and `messageModel.findConversations` exclude test and soft-deleted accounts.

Test-account list filtering is not itself a membership restriction: a test account may qualify through chat targeting while remaining hidden from the displayed roster. Chat header counts use the displayed member list. Keep unread queries consistent with whichever conversations are visible.
