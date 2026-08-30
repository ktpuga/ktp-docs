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

Lives at `GitHub/Personal Projects/Linkedin Embed Bot` — **a fifth folder, outside the four repos, and not a git repository.** Node 20+, `discord.js`, no framework.

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

## Moderating posts

**Admin Panel → Homepage Media → LinkedIn**, eboard only. Every ingested post, published or not, with a show/hide switch.

This is the **backstop, not the main route**. The everyday way to remove a post is to delete the Discord message; this page covers what Discord cannot — a message deleted months ago, a post that should come back, or one submitted before anyone thought to remove it. Nothing here deletes a row: unpublishing keeps the record of what was submitted and by whom.

Posts that predate the bot show as "added before the bot" rather than carrying a Discord message, which is a fact about the seeded eight rather than a fault.

## Known gaps

- **`processedMessageIds` is capped at 5000** rather than unbounded, but it is still per-process state; a restart re-scans history from scratch.
- **Nothing checks that a post still exists on LinkedIn.** A post deleted on LinkedIn keeps rendering an embed that fails to load, and only a person noticing will remove it.
