---
sidebar_position: 16
---

# LinkedIn Spotlight

The LinkedIn posts on the public homepage and `/spotlight` are not maintained by hand. A Discord bot watches one channel, and anything a member posts there ends up on the website.

## The pipeline

```
Discord #linkedin        someone posts a LinkedIn link
        ↓
LinkedIn Embed Bot       extracts the URL, expands lnkd.in,
                         parses the post URN
        ↓
POST /linkedin-posts/ingest        X-Bot-Secret
        ↓
linkedin_posts                     Postgres
        ↓
GET /linkedin-posts                public, no auth
        ↓
Homepage (3 posts) and /spotlight (6)
```

Removal runs the same way backwards: **delete the Discord message and the post comes off the site.**

## The bot

A **fifth repo**, outside the other four: `yashverms32/linkedin-embed-bot` (private), working copy at `GitHub/Personal Projects/Linkedin Embed Bot`. Node 20+, `discord.js`, no framework. Runs on its own LXC under systemd — see [LinkedIn Embed Bot](../kronos/linkedin-bot.md) for the deployment.

It scans the channel's whole history on startup as well as watching for new messages. That is safe to repeat because the API upserts on `linkedin_urn`; it is not idempotence in the bot itself.

### What it accepts

Three URN types — `activity`, `ugcPost`, `share` — from feed URLs, public `/posts/...` slugs, existing embed URLs, and `lnkd.in` short links. Profile, company and job pages are rejected.

:::note All three types are load-bearing
The eight posts that were on the site before this existed are **entirely `ugcPost` and `share`, with no `activity` at all**. A parser that only understood `activity-` would have passed its own tests and matched none of the chapter's real content.
:::

`lnkd.in` links are expanded with a manual-redirect `HEAD` (falling back to `GET` on a 403 or 405), capped at 5 hops with a 10s timeout, and **every hop is re-validated against the LinkedIn host allowlist** — a redirect off LinkedIn is refused rather than followed.

### Deletions and edits

`Partials.Message` is **required** in the client config. Without it, discord.js drops the delete event for any message it has not cached, which is every message posted before the process started. With it the event arrives as a partial carrying the id — the only field the withdrawal needs.

An edit re-reads the message, so a link pasted into something already sent is still picked up. The message id is dropped from the seen-set first, because the "already handled" rule that is correct for the history scan is wrong for a message whose content just changed.

### Configuration

`DISCORD_TOKEN` and `LINKEDIN_CHANNEL_ID` are required. `API_URL` and `LINKEDIN_BOT_SECRET` **must be set together or startup exits** — half-configured would look connected and save nothing. With neither, the bot runs in terminal-only mode and writes nothing.

## The website

`lib/spotlight-posts.js` fetches on the server, with a **3 second timeout** and a 10 minute revalidate.

Both callers are public, server-rendered pages, so a slow ktp-api must not hold the HTML — the same lesson the rush signup page learned when SSR turned "the button is missing" into "the page hangs". On any failure it falls back to `FALLBACK_SPOTLIGHT_LINKS` in `app/spotlight/links.js`.

:::warning The fallback list is a safety net, not a second source of truth
Those eight entries are the posts that were hardcoded before this table existed, kept **only** for when ktp-api is unreachable. Migration `1790000000000` seeded exactly the same eight into the database, so the two agreed on the day this shipped.

**Do not add to that list.** A new post goes in the Discord channel. Adding one to the fallback would put it on the site only when the API happened to be down, which is the most confusing behaviour available. The list is expected to drift, and eight slightly old posts still beat an empty section.
:::

**An empty table is not a reason to fall back.** If the API answers with zero posts, the section renders empty — returning the fallback there would resurrect the seeded eight after an officer had deliberately hidden every one of them, which reads as the admin panel not working.

`rotateHourly(links, count, now)` advances the starting offset every hour, so a chapter with 24 posts still shows a different three on the homepage through the day. It takes the list as an argument rather than reading a constant, which is what lets the same rotation run over database rows and over the fallback.

## Posts age off the site after six months

A post stops appearing on the homepage and `/spotlight` once **the LinkedIn post itself** is more than six months old.

**Nothing is deleted and nothing is unpublished.** It is a filter on the read query, so the row is untouched, eboard still sees it in the admin tab marked **Aged out**, and widening the window is a one-character edit in `MAX_AGE_MONTHS` that brings everything straight back.

That was chosen over a scheduled job deliberately. A job writing `is_published = FALSE` would have been irreversible, and it would have been undone anyway the first time anyone set `SCAN_EXISTING_MESSAGES=true` — the bot would re-ingest the very posts it had just culled.

### Where the date comes from

A LinkedIn post id is a snowflake: the high bits are a Unix millisecond timestamp. Shifting right 22 bits recovers when the post was published, straight out of an id already stored on the row.

```sql
to_timestamp(floor(linkedin_post_id::numeric / 4194304) / 1000)
```

Verified against real chapter posts — `7445488019756826624` decodes to `2026-04-02T15:11:14.388Z`, and the same arithmetic in JavaScript agrees to the millisecond.

:::warning The two obvious date columns are both the wrong ones
- **`created_at` is when the bot ingested the post.** The entire 165-message backlog was ingested in one afternoon, so every row shares a `created_at` and none of them look old however old the content is. A rule built on it would have removed nothing until March 2027.
- **`discord_message_id` decodes to when somebody pasted the link into Discord**, which is also not the post's age — a two-year-old article shared today would count as brand new.

Only the LinkedIn id knows when the post was actually published.
:::

:::note `numeric`, not `bigint`
The `CHECK` constraint permits up to 32 digits and `bigint` tops out at 19, so a longer id would raise "value out of range". Real ids are 19 digits; `numeric` simply cannot overflow.
:::

The ordering changed with it: the public list is sorted by **publication date**, not `created_at`. Sorting the backlog by ingestion time put a year of posts in essentially arbitrary order, since they all share one timestamp.

:::warning Tests that assert a post is publicly visible must generate their ids from the clock
An id encodes its own publish time, so a hardcoded one gets older every day the suite runs. `test/linkedinPosts.test.js` has `idPostedDaysAgo()` for exactly this — two tests were quietly six weeks away from failing for reasons unrelated to the code they cover.
:::

## A scheduled check that posts still exist

An author can delete or restrict a post long after we ingested it. The embed then renders LinkedIn's *"Sign in or join now to see ...'s post / This post is unavailable"* wall, which looks like a bug in our homepage.

**This cannot be detected in the browser.** The embed is a cross-origin iframe, so nothing on our page can read what is inside it. The check has to be a server-side probe, and its result has to be stored.

`services/linkedinAvailability.js` runs **every six hours, with the first pass ten minutes after boot**, following `startReminderWorker`'s shape — a `running` guard, a `void ... .catch()` wrapper so a rejection cannot crash the API, and `timer.unref()` so a script or test run is not held open by it.

:::danger It shipped as a 24-hour interval with no boot run, and in that form it NEVER ran
The original reasoning was sound in isolation: this worker makes outbound requests to a third party, so don't let a crash-looping API hammer LinkedIn on every restart — wait a full interval before the first pass.

What it missed is that **the API container is rebuilt on every push, and ktp-api ships several times on a normal day.** Every deploy reset the timer, so it never reached 24 hours. The probe did not run once in production. A post that LinkedIn had restricted sat on the public homepage serving a sign-in wall, and the admin panel showed it as **Live**, because `unavailable_at` was NULL on every row.

Nothing logged anything either: `checkBatch` only prints when `summary.checked > 0`, so a worker that never woke up was indistinguishable from one with nothing to do.

**The lesson generalises to any scheduled work in this API: an interval longer than the deploy cadence is an interval that never elapses.** The crash-loop protection now comes from the ten-minute boot delay, which a container restarting faster than that never reaches. It never needed to come from the interval.
:::

### How a dead post is recognised

Two signals, **both** required:

| | Status | Body |
|---|---|---|
| Good post | `200` | contains `attributed-text` |
| Missing post | `404` | does not |

Verified against real chapter posts. Status alone would miss the *restricted* case, which answers `200` with a sign-in wall; the body marker alone would trust a page that errored.

:::warning A network failure is NOT an answer
A timeout, a DNS blip, or LinkedIn refusing our datacenter IP says nothing about whether the **post** exists. Treating that as "unavailable" would hide every post on the site the first time the network hiccupped.

The probe returns `available: null` for that case and the row is left **completely** untouched — including `last_checked_at`, so the real check happens on the next run rather than a day later.
:::

:::warning The run is capped, and that cap is load-bearing
`MAX_PER_RUN = 40`, with 1.5s between requests. There are already ~173 posts and the number only grows. Firing all of them at LinkedIn in a burst from one datacenter IP is how the address gets rate-limited — at which point every post looks unavailable and the worker hides the entire homepage.

Oldest-checked-first means the backlog still drains, just over several runs.
:::

:::note What actually bounds our request rate is a column, not the timer
`STALE_AFTER_MS` (20 hours) is checked in SQL by `findDueForCheck`, so a run that happens sooner simply finds nothing due and makes **no** outbound requests at all.

That is why moving from 24 hours to six was free: it costs no extra LinkedIn traffic per post, and unlike a `setInterval`, a redeploy cannot reset it. Schedule state that matters belongs in Postgres.
:::

### What happens to a post it finds missing

`unavailable_at` is set and the public query filters it out — the same read-filter shape as the six-month age-off.

:::note `unavailable_at` is deliberately separate from `is_published`
They answer different questions: `is_published` is "eboard chose to hide this", `unavailable_at` is "LinkedIn no longer serves this". Collapsing them would make a false positive look like a human decision, and would make un-hiding ambiguous — did somebody restore it, or did the checker change its mind?
:::

**Posts already marked unavailable stay in the queue**, so an author who un-restricts a post brings it back to the site with nobody intervening. Only posts eboard hid are excluded from re-checking, since that is a human decision the checker has no business revisiting.

The admin pill is therefore **four states**, in precedence order: **Hidden** (a person did it) → **Unavailable** (LinkedIn pulled it) → **Aged out** (over six months) → **Live**.

### "Live" and "checked" are different claims, and the panel says both

Each row also carries an availability line under its URN, separate from the pill: **Checked \<date\>**, **Gone from LinkedIn since \<date\>**, or **Never checked** in amber. A count of unchecked posts sits above the list.

:::warning A row that has never been probed must not read as a clean bill of health
This distinction exists because collapsing it is what hid the dead worker for a week. The pill answers *"is this on the site"*; the availability line answers *"do we actually know whether LinkedIn still serves it"*. While every row was unchecked, every pill said **Live** and the summary said **0 unavailable** — which an officer reads as "everything is fine" when it actually meant "nobody has looked".
:::

### Checking on demand

**Check against LinkedIn** in the LinkedIn tab runs the probe immediately rather than waiting for the worker: `POST /linkedin-posts/check-availability`, eboard only.

It passes `staleAfterMs: 0`, so it re-probes regardless of freshness — a button that answers "checked 0" because the worker ran an hour ago reads as broken. It is capped at **15 posts**, not the worker's 40, because somebody is waiting on this response: at the 1.5s spacing, 40 would be a 60-second request and a reverse proxy would cut it off first. Ordering is oldest-checked-first, so pressing it again continues through the list.

The response carries the refreshed admin list alongside the summary, so the panel re-renders from the run it just triggered rather than from a list that predates it.

## Moderating posts

**Admin Panel → Homepage Media → LinkedIn**, eboard only. Every ingested post, published or not, with a show/hide switch.

This is the **backstop, not the main route**. The everyday way to remove a post is to delete the Discord message; this page covers what Discord cannot — a message deleted months ago, a post that should come back, or one submitted before anyone thought to remove it. Nothing here deletes a row: unpublishing keeps the record of what was submitted and by whom.

Posts that predate the bot show as "added before the bot" rather than carrying a Discord message, which is a fact about the seeded eight rather than a fault.

## Known gaps

- **`processedMessageIds` is capped at 5000** rather than unbounded, but it is still per-process state; a restart re-scans history from scratch.
- **Nothing checks that a post still exists on LinkedIn.** A post deleted on LinkedIn keeps rendering an embed that fails to load, and only a person noticing will remove it.
