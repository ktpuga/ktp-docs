---
sidebar_position: 14
---

# Notifications, Reminders and Email

There are three ways the portal tells somebody that something happened, and they reach different people. Choosing between them is the whole design.

| Channel | Reaches | Good for |
|---|---|---|
| **Tab badges** | anyone using the portal in a browser | "there are three things you haven't read" |
| **iOS push** | anyone with the app installed | timely, interruptive |
| **Email** | anyone with an address on file | things that must be read |

The one that matters most in practice: **push only reaches people who installed the iOS app.** For anything that genuinely has to be seen by the whole chapter, that is not enough on its own — which is what email is for.

## Tab badges

Every portal sidebar item can carry a count. Seven tabs do: **Announcements, Calendar, Meetings, Polls, Files & Photos, Interviews, Committees**. Messages carries one too, from a different mechanism (below).

Visiting a tab clears its badge — with three deliberate exceptions: **Meetings**, the **Calendar's pending-RSVP count**, and **Committees**. The tab you are currently looking at never shows one, again except those three.

### How "new" is decided

Each member has a **cursor** per tab — a single timestamp, `last_seen_at`. The count is "how many things in this tab were created after that timestamp, that you're allowed to see". Opening the tab moves the cursor to now.

This is deliberately *not* a notification inbox with one row per person per item. For a chapter of ~100, a single announcement would write ~100 rows, and every tab would have shown nothing at all for the content that already existed unless somebody wrote a backfill. A cursor is one row per person per tab, works retroactively against the tables that are already there, and needs no maintenance when an item is edited or deleted.

### Nothing is retroactively unread

The first time somebody loads a portal page, their cursors are seeded to **that moment**. Nobody opened the portal on launch day to "47 new announcements". "New" means new since you first used the feature.

### A badge never advertises something you can't open

The counts re-implement each tab's visibility rules, so they have to agree with them:

- An announcement or event **targeted at specific groups or committees** only badges people in them.
- An announcement or event with **no audience set** badges all *members* — and **not rushees**. "No audience" has always meant members, and a rushee is a prospective one. This is the same rule that decides what `GET /announcements` returns, and it is the single most important thing to preserve if you touch the counting queries.
- A **rushee's Announcements tab counts rush announcements**, which is a different table entirely.
- **Files** respects per-folder and per-album audiences, including a document that inherits its folder.

### Deliberate quiet

- **You are never badged for something you posted.** Eboard writes most of the content; being told about your own announcement is how people learn to ignore a badge.
- **Closed and expired polls, and cancelled meetings, don't badge.** A badge that leads somewhere you can't act on is noise.
- **Interviews badge when a schedule is published, not when it was created.** Schedules are built as drafts and released later — often days later, since entering forty slots takes a while — so creation time would badge while nothing was bookable yet. The badge also clears once the rushee books a slot, because signing up was the only thing it was asking for.

### Committees is different: the unit of "seen" is the committee

Every other tab asks "is there anything new *here*". Committees has to answer "which committee has something new", and a per-tab cursor cannot express that. Worse, it would break the feature outright: `markTabSeen('committees')` fires on navigation, so every per-committee marker would clear the instant the page opened and the member would watch them vanish before reading them.

So committees get their own cursor table, `committee_view_cursors`, keyed `(user_id, committee_id)` and moved when the member opens **that committee's detail view**. The sidebar number is the sum of the per-committee counts, which means it **drains as each committee is read** rather than all at once on arrival. That is why `committees` sits in `CLEARS_ON_ACTION_NOT_VIEW` alongside `meetings`.

What counts:

- **New events and announcements** targeted at the committee, excluding your own posts. Files in a committee's shared folder and "a new member joined" were both considered and left out.
- **Pending join requests you can action** — eboard anywhere, chair of that committee only. This one is not a cursor count at all: it clears when the request is **decided**, not when the page is viewed, exactly like an unanswered meeting invitation.

On the page the two are shown **separately** ("3 new" and "2 requests"); only the sidebar adds them, because there the question is just "is there anything for me".

:::note The overlap with Calendar and Announcements is intended
A committee event badges **both** Calendar and Committees; a committee announcement badges both Announcements and Committees. That was chosen deliberately, with the alternative on the table. **It is not a double-counting bug to fix.** The one signal that would have badged nowhere else — new members joining, available via `committee_members.joined_at` — is the one that was left out.
:::

**Scope is your own committees, eboard included.** Eboard is `seesEverything` almost everywhere else; applying that here would badge them for every committee in the chapter, and a permanently non-zero number is one people learn to ignore. The approval queue is the single exception: eboard sees pending requests for committees they are not members of, since they are the people most likely to clear them.

### Messages is different, on purpose

Messages keeps its own unread count from real per-message read receipts. That is a genuinely per-item question ("which messages have I read"), it already worked, and folding it into a per-tab cursor would have made it worse.

### Meetings counts unanswered invitations, not new meetings

**This one is not a cursor at all**, despite living under the same `unreadCounts` key. `countMeetings` counts scheduled, not-yet-started meetings where the member's `meeting_invitees.response` is still `'pending'`.

It used to be `m.created_at > cursor` — "meetings created since you last opened the tab" — which meant a member could be invited, glance at Meetings, clear the badge, never reply, and never be reminded again. An invitation is the clearest case there is of somebody waiting on you, and it was the one badge that forgot.

No schema change was needed: `response` already defaulted to `'pending'` and nothing was reading it. The client skips its optimistic clear-on-view for this tab (`CLEARS_ON_ACTION_NOT_VIEW` in `lib/use-tab-notifications.js`), so "you still owe 3 replies" stays true while you are looking at the list. `markTabSeen` still writes the cursor row; it is simply ignored by the count.

Meetings that have already started are excluded, for the same reason cancelled ones are: replying is not an action anyone can still take, and a badge you cannot clear is worse than no badge.

:::note Pending meetings deliberately do NOT appear on the calendar
`meetingModel.findForCalendar` returns only meetings you have accepted (or organise). Your calendar is your schedule, not your inbox — showing unanswered invitations there would clutter it with things you may decline, and the ICS feed would export meetings you never agreed to. So unlike event RSVP, meeting replies happen in the Meetings tab, and the badge is what points you at it.
:::

### Calendar is different too: unanswered RSVPs outrank "new"

A pending RSVP badge must **survive being looked at**. The cursor above cannot express that — `markTabSeen` fires on visit, so an RSVP routed through it would clear for everyone who opened the calendar and decided to answer later, which is precisely the person the badge exists for.

So the calendar nav item has a third source, `usePendingRsvpCount` in `lib/use-pending-rsvps.js`: the number of upcoming events where `requiresRsvp` is true and `myRsvp` is null. **It clears only when the member actually answers.**

:::note They are not summed
`badgeFor` returns the pending-RSVP count **when there is one**, and falls back to the normal new-content count otherwise. Adding them would count a brand-new RSVP event twice — once as new content, once as an unanswered RSVP — and the badge would then drop from 2 to 1 on a mere visit, which reads as the count losing track rather than as progress.
:::

There is no counting endpoint. `GET /events` already returns `requiresRsvp` and `myRsvp` per event, so the count is derived client-side from data the calendar fetches anyway — deliberately avoiding an `rsvpSummary` on the list route, which would cost a `users` scan per event.

Past events are excluded, using **`endDate`** to match the API's own cut-off. An event that has ended answers `409` to any RSVP, so badging one would be a number the member has no way to clear.

Polling is 60s, slower than messages (10s) and tab notifications (30s), because an unanswered RSVP is a standing to-do rather than news. Answering dispatches `RSVP_CHANGED_EVENT` so the badge updates immediately: the sidebar is a layout in a different React tree from the calendar page, so there is no shared state to update — the same reason `PROFILE_PICTURE_CHANGED_EVENT` exists.

## Reminders

Events and meetings generate reminders automatically. Nobody schedules them by hand.

| Event kind | Reminders sent before it starts |
|---|---|
| Ordinary event, and all meetings | 2 hours, 30 minutes |
| **Required event** (attendance is taken) | **1 day**, 2 hours, 30 minutes |

A required event gets the extra day's notice because 30 minutes is fine for "there's a social tonight" and useless for "you are marked absent if you don't show" — a day is enough time to actually rearrange something. Its notification is titled **"Required event"** and says attendance is taken, since on a lock screen the title is often all anyone reads.

Editing an event rebuilds its reminders, and deleting it removes them. Changing an event's time therefore moves its reminders too, with no stale ones left behind.

**Reminders are iOS push only.** Somebody who never installed the app gets none. If a required event genuinely has to reach everybody, tick the email box when you create it.

## Email

:::note Not switched on yet

Email is built but **dormant** — the chapter's Resend credentials aren't configured, so nothing is sent. While that's the case the compose checkbox **doesn't appear at all**, and Settings says so plainly rather than showing a switch that governs nothing.

Both surfaces ask the API (`GET /notifications/channels`) rather than reading their own setting, so the moment credentials are added the feature appears on its own — no redeploy of the website.

:::

Email is **opt-in per post**. When Eboard writes an announcement or creates an event, there is a checkbox: *"Also send this as an email."* Nothing is emailed unless somebody ticks it.

There is no automatic severity ladder, and that is a decision rather than an omission. A rule like "important things get emailed" means the sender cannot tell what will happen until after it has happened, and the failure mode is mailing the entire chapter by accident.

Marking an event **required** pre-ticks the box, since that is exactly the case where reaching people who don't have the app matters. It is still only a default — it can be unticked.

### What members control

**Settings → Email Notifications** has one switch: *"Email me important announcements and events."* On by default. Turning it off stops all of it; everything still appears in the portal and still badges the sidebar.

The push categories are **not** shown on the website. They only mean anything on a device with the app installed, and a toggle in a browser that silently governs a different device is worse than no toggle.

### Rules the system enforces

- **Email goes to exactly who the item was targeted at** — the same list the push goes to, and the same list that can open it in the portal. An email is a disclosure like any other.
- **Alumni have no `@uga.edu` address**, so their personal address is used instead. Everyone else gets their UGA address, which is where people actually read mail during the semester.
- **Everyone receives their own copy.** Nobody's address is visible to anybody else.
- **Anything is emailed at most once.** Fixing a typo in an announcement that already went out does not mail the chapter a second time, and two people hitting Publish at the same moment still produces one send.
- **Delivery is best effort.** If email is misconfigured or Resend is down, the announcement is still posted, the push still goes out, and the badge still appears. A failed email never fails the thing that triggered it.

### Setup

Email needs `RESEND_API_KEY` and `EMAIL_FROM` on the API server, and the sending domain verified in Resend (SPF and DKIM records on `ugaktp.com`). Until both are set, nothing is sent and a warning is logged — no other behaviour changes. Full detail is in the `ktp-api` README.

Nothing is lost by waiting. The server checks that email is configured **before** it marks an announcement as sent, so posts made while email is off are not quietly burned — they simply never claimed a send, and the feature starts clean whenever it is switched on.
