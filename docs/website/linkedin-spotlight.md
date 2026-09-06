---
sidebar_position: 16
---

# LinkedIn Spotlight

A Discord bot collects LinkedIn post links for the homepage and `/spotlight`. Eboard can manage publication in **Admin → Homepage Media → LinkedIn**.

## The pipeline

```text
Discord channel
  -> LinkedIn Embed Bot parses the link and post URN
  -> POST /linkedin-posts/ingest with X-Bot-Secret
  -> linkedin_posts in Postgres
  -> public GET /linkedin-posts
  -> homepage (3 posts) and /spotlight (6 posts)
```

Deleting the source Discord message unpublishes its associated posts when the bot receives the deletion event.

## The bot

The separate repository is `yashverms32/linkedin-embed-bot`, with a local checkout under `GitHub/Personal Projects/Linkedin Embed Bot`. It runs a Node.js/discord.js process on an LXC under systemd. See [Bot deployment](../kronos/linkedin-bot.md).

When history scanning is enabled, startup reads older channel messages. The API upserts by `linkedin_urn`, so repeated ingestion does not create duplicate post rows.

### What it accepts

The parser accepts `activity`, `ugcPost`, and `share` URNs from feed, post, embed, and `lnkd.in` links. Profile, company, and job links are rejected.

Short links use manual redirects, starting with HEAD and falling back to GET on `403` or `405`. Expansion is limited to five hops and a ten-second timeout. Every hop must remain on the LinkedIn host allowlist.

### Deletions and edits

`Partials.Message` lets the client receive deletions for uncached messages. Withdrawal needs only the Discord message ID.

Edits remove the ID from the seen set before reprocessing the changed message, so newly added links can be ingested.

### Configuration

`DISCORD_TOKEN` and `LINKEDIN_CHANNEL_ID` are required. Configure `API_URL` and `LINKEDIN_BOT_SECRET` together; setting only one fails startup. With neither, the bot logs results without writing to the API.

## The website

`lib/spotlight-posts.js` fetches server-side with a three-second timeout and ten-minute revalidation. A fetch failure uses `FALLBACK_SPOTLIGHT_LINKS` from `app/spotlight/links.js`.

The fallback contains the original seeded posts and is not the normal publishing path. Add new posts through Discord. An API response with an empty list stays empty; it must not restore posts an officer hid.

`rotateHourly(links, count, now)` advances the starting offset each hour for both API results and fallback lists.

## Posts age off the site after six months

Public queries exclude posts older than `MAX_AGE_MONTHS`, currently six months. Rows and publication decisions remain stored, and the admin list labels aged-out posts.

### Where the date comes from

The implementation derives a timestamp from the LinkedIn post ID:

```sql
to_timestamp(floor(linkedin_post_id::numeric / 4194304) / 1000)
```

This uses the post ID rather than ingestion time or the Discord message date. The recorded check for `7445488019756826624` produced `2026-04-02T15:11:14.388Z`.

The cast uses `numeric` because accepted ID strings can exceed the range of `bigint`. Public sorting uses the derived publication date.

Tests of age-based visibility should generate IDs relative to the test clock. `idPostedDaysAgo()` prevents fixed examples from aging out during unrelated future runs.

## A scheduled check that posts still exist

LinkedIn can remove or restrict a post after ingestion. The website cannot inspect a cross-origin iframe's rendered contents, so `services/linkedinAvailability.js` probes from the API server and stores results.

The worker first runs ten minutes after boot, then every six hours. A running guard prevents overlapping passes; caught failures do not crash the API, and an unreferenced timer does not keep test processes alive.

The startup pass matters on frequently deployed containers: a process may restart before a long interval elapses.

### How a dead post is recognised

The probe checks response status and the `attributed-text` body marker. A successful status alone does not prove the embed contains a readable post; a sign-in wall can also return `200`.

Transport failures and inconclusive responses return `available: null`. They leave availability and check timestamps unchanged so a network problem does not hide content or postpone a meaningful retry.

Each scheduled pass checks at most 40 posts with 1.5 seconds between requests, oldest-checked first. `findDueForCheck` uses a stored check timestamp and a 20-hour stale threshold, so the six-hour timer does not mean every post is fetched on every pass.

### What happens to a post it finds missing

`unavailable_at` excludes unavailable posts from public reads without changing `is_published`. Availability and editorial visibility are separate states.

Unavailable posts remain eligible for rechecks and can return if LinkedIn serves them again. Manually hidden posts are excluded from the check queue.

The admin status precedence is:

```text
Hidden -> Unavailable -> Aged out -> Live
```

### "Live" and "checked" are different claims, and the panel says both

The status pill describes publication eligibility. A separate line shows the check timestamp, unavailability timestamp, or **Never checked**. The panel also counts unchecked posts.

Do not interpret a null `unavailable_at` as proof of a successful probe.

### Checking on demand

**Check against LinkedIn** calls the eboard-only `POST /linkedin-posts/check-availability`.

The request uses `staleAfterMs: 0` and checks at most 15 posts, retaining the 1.5-second spacing. Oldest-checked-first ordering lets later requests continue through the list. The response includes the summary and refreshed admin rows.

## Moderating posts

The admin list includes published and unpublished records. Show/hide changes `is_published` without deleting the row or Discord attribution.

Use Discord deletion for normal source removal and the admin controls for restoration or cases not represented by a current Discord message. Seeded records appear as "added before the bot."

## Known gaps

`processedMessageIds` is capped at 5000 and is process-local. A restart loses that seen set; with history scanning enabled, the bot processes the channel again.

Availability checks are periodic and use LinkedIn response patterns. A new restriction may remain visible until checked, and changes in LinkedIn's response format may require updating the probe.
