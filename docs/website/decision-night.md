---
title: Decision-night voting
---

Decision night lets an executive board member or pledge chair open a timed vote for the rushee currently being discussed. Members vote from their own portal. The API stores votes and decides when voting closes.

## Who can do what

| Person | Vote | Open or close voting | See results and voter names |
| --- | --- | --- | --- |
| Active member | Yes | No | No |
| Committee chair | Yes | No | No |
| Pledge committee chair | Yes | Yes | Yes |
| Executive board member | Yes | Yes | Yes |
| Pledge, rushee, or alumnus | No | No | No |

Voting requires an eligible JWT group and an eligible current database membership. Deleted accounts and test accounts cannot vote. Management requires executive board membership in both places or the existing pledge committee chair assignment in Postgres. Being the chair of another committee does not grant management access.

Votes are private from other members, but they are attributable to the executive board and pledge chairs. The API derives voter identity from the authenticated account. Ordinary member responses contain only that person's own selection. They never include other votes or totals. Private interview notes are not sent to the voting page.

## Running the meeting

1. Open the Presentation tab under Rushee Data, then enter presentation mode. Executive board members use the admin portal; pledge chairs use the member portal.
2. Ask members to open **Decision Night** in their portal and keep it open.
3. Show the rushee you want to discuss. Press **Open voting** when ready. The same control is available on the rushee's profile.
4. The default duration is 60 seconds. Change it before opening if needed, from 15 to 300 seconds.
5. Members choose Strong yes, Weak yes, Undecided, Weak no, or Strong no, then press **Submit vote**. They can change their choice and press **Update vote** until the deadline.
6. At expiry, the rushee disappears from member voting pages. Members see a confirmation of their own last recorded vote and wait for the next round.
7. Move to the next slide and explicitly open its vote. Moving slides alone does not change the active vote.

Only one voting round can be open at a time. Opening the same rushee again after a round closes creates a separate round; it does not overwrite earlier votes. Retrying the same open request ID returns the original round without extending its deadline.

## Reviewing results

Executive board members and pledge chairs can follow **View voting results** from their Decision Night voting page. Choose a round and press Refresh to see current totals and attributed votes. The page lists the most recent 100 rounds; older rounds remain stored and accessible by their API ID. Results do not update automatically.

Keep this page off the projector: it contains names and choices. The presentation itself contains voting controls and the countdown, not individual votes. A manager can use **Close voting now** on the results page to end a round early.

## Timing and recovery

The voting page checks for changes about every two seconds while visible. Background tabs check less often and refresh when brought back. This is polling, so opening a round may take roughly one polling interval plus network time to appear. No WebSocket service is required.

The API uses its database clock to enforce expiry. Browser clocks cannot extend a round. The countdown uses server-relative time and elapsed browser time, with a conservative allowance for request travel. It can reach zero slightly before the API deadline. Requests that wait for a database lock are checked against the time after that wait.

Reloading restores the active rushee and the member's saved selection. If a submission response is lost, submit the same selection again before the deadline; it updates the same ballot. After expiry, reload to check whether the API recorded it. A network failure disables submission until a successful state refresh. The website keeps access tokens on the server and uses its writable session accessor to persist refreshed credentials.

No scheduled task is needed to close voting. Every read and vote checks the deadline. API restarts do not erase rounds or votes.

## Deployment and checks

Apply API migration `1791000000000_add-decision-night-voting.sql` before using the routes. Deploy the API before the website. This migration adds rounds and ballots; it does not change attendance.

Run the API suite against the existing isolated test database. Website coverage is in `scripts/test-decision-night.cjs`, included in the standard auth CI step. Tests cover permissions, private responses, duplicate submissions, concurrent opening, requests delayed beyond expiry, browser candidate changes and the website proxy's origin check.

Before the meeting, rehearse with permitted accounts in a non-production environment: open a round, vote, change a vote, let it expire, open the next rushee, and inspect results as both a manager and an ordinary member. Do not create test votes in the real meeting's records.
