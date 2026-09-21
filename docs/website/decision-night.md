---
title: Decision-night voting
---

Decision night lets an executive board member or pledge chair open a timed vote for the rushee currently being discussed. Members vote from their own portal. The API stores votes and decides when voting closes.

## Interview badges and candidate inclusion

Current rushees appear automatically once they have an interview booking; explicitly completed interviews also qualify. A booked interview does not need to be manually marked completed. Rushees with neither are excluded. The roster, rushee profile and slides show **Interview completed**, **Interview booked**, or **No interview booked**. A retained past booking still counts as booked; actual completion is recorded explicitly.

Eboard and pledge committee members can use **Hide from Decision Night** on a rushee profile. Hidden rushees stay in the roster, labeled Hidden, and can be restored with **Show in Decision Night**. Hiding excludes the candidate from slides and new voting rounds; it does not delete their account. Close an active vote before hiding its candidate. Global Decision Night visibility approval is separate and unchanged.

## Slide layout and editing

The slide follows three columns: a smaller photo, full name, profile details, resume button and events attended on the left; summary and interview notes in the middle; pledge committee notes on the right. The resume button sits directly below the photo. Graduation date and GPA share a row, and green/red flag totals appear side by side below the profile.

Active pledge committee members and executive board members can open **Edit mode** from Rushee Data > Presentation. Each of the three editable text sections has its own editor and **Save section** button. Formatting includes bold, italic, underline, lists, text size, color and alignment. **HTML** switches that section to source editing. Scripts, images, links, embeds and unsupported styles are removed; the API sanitizes saved content and the website sanitizes displayed content.

**Presentation mode** uses the finished layout and has no Edit mode switch. Close the presentation and use the editing button in the portal to change content. Save or discard changed sections before moving to another rushee or closing the editor. If someone else saved the same section first, the API returns a conflict and keeps your draft onscreen. You can copy it before choosing **Discard draft and load the newer saved section**. Separate sections do not overwrite one another.

Existing plain-text write-ups supply the summary until a formatted summary is saved. Events attended is a read-only list of recorded attendance, using the same text size as the other profile details. Previously saved event-text overrides are ignored; changing attendance must use the attendance tools. Interview and committee sections are presentation-specific summaries; private interview notes are not copied onto the slide automatically. A saved empty section intentionally stays empty.

Editing content does not grant permission to approve visibility or open voting. Management remains restricted to executive board members and the pledge chair. Current pledge committee members can read named results.

**View resume** opens the existing protected file popup without leaving the slide. PDFs display inside the popup; unsupported formats offer a download. A missing resume is labeled clearly. Escape closes the popup without closing the slide, and slide navigation pauses while the popup is open.

Slides, editor controls and the voting timer follow the portal's light/dark theme. Candidate names use saved first and last names; the username is the fallback when both are absent. Preferred names do not replace full names on slides or voting prompts.

## Optional live flags

During an open voting round, eligible members can choose **Green flag** or **Red flag** beside their ballot, or leave both unset. Clicking the selected flag again or using **Clear flag** removes it. Each account has at most one flag per round; flags can change only while voting is open and Decision Night is visible. A flag is independent of the five-choice vote.

The projected slide checks totals about every two seconds. It shows green/red counts for that rushee's most recent round, including after the round closes, while Decision Night remains visible. Returning to an older slide cannot show another rushee's totals. Only totals are projected. Executive board members and current pledge committee members can see who submitted each flag on the restricted results page; ordinary members cannot load other people's flags or poll results. Opening another round for the same rushee starts a separate set of flags.

## Visibility approval

Decision Night starts hidden from ordinary members. An executive board member or pledge chair opens **Decision Night** in their portal and presses **Show Decision Night** when approved. Executive board members use `/admin/decision-night`; the pledge chair uses `/member/decision-night`. Managers retain the page and results link while hidden. Other members see the sidebar link only after approval; a saved URL shows an unavailable message while hidden.

**Hide Decision Night** removes member access and blocks new votes and opening rounds. It does not delete votes, close rounds, or reset deadlines. If shown again before an existing round expires, that round returns with its original deadline. Use the separate **Close voting now** action to end a round early.

The setting is shared and stored in Postgres. The member sidebar checks visibility about every 15 seconds and on returning to the tab. Voting pages check about every two seconds; the API rejects hidden submissions immediately even if a page still shows an old ballot. Results remain available to executive board and current pledge committee members regardless of voting visibility.

## Who can do what

| Person | Vote | Open or close voting | See results and voter names |
| --- | --- | --- | --- |
| Active member outside pledge committee | Yes | No | No |
| Other committee chair | Yes | No | No |
| Pledge committee member | Yes | No | Yes |
| Pledge committee chair | Yes | Yes | Yes |
| Executive board member | Yes | Yes | Yes |
| Pledge, rushee, or alumnus | No | No | No |

Voting requires an eligible JWT group and an eligible current database membership. Deleted accounts and test accounts cannot vote. A test account with executive-board membership in both its JWT and database record can view Decision Night, show/hide it, open/close rounds and inspect results. It receives no ballot or flag controls; the API rejects its vote and flag submissions. Other test accounts remain excluded. Management requires executive board membership in both places or the existing pledge committee chair assignment in Postgres. Being the chair of another committee does not grant management access.

Votes are private from other members, but they are attributable to the executive board and the pledge committee. The API derives voter identity from the authenticated account. Ordinary member responses contain only that person's own selection. They never include other votes or totals. Private interview notes are not sent to the voting page.

## Running the meeting

1. Open the Presentation tab under Rushee Data, then enter presentation mode. Executive board members use the admin portal; the pledge chair uses the member portal.
2. Approve visibility with **Show Decision Night**, then ask members to open **Decision Night** in their portal and keep it open.
3. Show the rushee you want to discuss. Press **Open voting** when ready. The compact button and duration field sit in the center of the presentation header, between the title and slide count/close button. On narrow screens they wrap below those controls within the header. The same control is available on the rushee's profile. Pledge committee members who are not chairs can edit content but do not receive these voting controls.
4. The default duration is 60 seconds. Change it before opening if needed, from 15 to 300 seconds.
5. Members choose Strong yes, Weak yes, Undecided, Weak no, or Strong no, then press **Submit vote**. They can change their choice and press **Update vote** until the deadline.
6. At expiry, the rushee disappears from member voting pages. Members see a confirmation of their own last recorded vote and wait for the next round.
7. Move to the next slide and explicitly open its vote. Moving slides alone does not change the active vote.

Only one voting round can be open at a time. Opening the same rushee again after a round closes creates a separate round; it does not overwrite earlier votes. Retrying the same open request ID returns the original round without extending its deadline.

## Reviewing results

Open **Committees > Pledge Committee > Decision Night Results** in the admin or member portal. Executive board and current pledge committee members can read the page; voting management remains executive-board/pledge-chair only. The tabs are:

- **Voting rounds:** choose among the latest 100 stored rounds and refresh totals, named ballots and optional flags. Older rounds remain available by API ID. Only managers see Close voting now.
- **Tier list:** latest closed-round weighted averages, ranks, counts, in/discuss/out projections and expandable answer breakdowns. Ties and insufficient votes stay protected. Refreshes every 15 seconds while visible.
- **Results chart:** projected group sizes and a score histogram with accessible values. This does not represent saved final bids; final decisions and persisted first-round locking are not yet implemented.
- **Simulation:** embedded synthetic rehearsal with PNM/member counts, adjustable distribution percentages, vote editing and simulated round locking. It never changes real votes. Switching hub tabs keeps the rehearsal; leaving the page resets it.

Keep named results off the projector. The presentation itself shows voting controls/countdown and aggregate flags, not individual ballots. The website checks can_view_results independently from can_manage. Loss of committee membership revokes API reads and hides the hub when permissions refresh. The simulator iframe is sandboxed without same-origin access and contains synthetic data only.

## Timing and recovery

The voting page checks for changes about every two seconds while visible. Background tabs check less often and refresh when brought back. This is polling, so opening a round may take roughly one polling interval plus network time to appear. No WebSocket service is required.

The API uses its database clock to enforce expiry. Browser clocks cannot extend a round. The countdown uses server-relative time and elapsed browser time, with a conservative allowance for request travel. It can reach zero slightly before the API deadline. Requests that wait for a database lock are checked against the time after that wait.

Reloading restores the active rushee and the member's saved selection. If a submission response is lost, submit the same selection again before the deadline; it updates the same ballot. After expiry, reload to check whether the API recorded it. A network failure disables submission until a successful state refresh. The website keeps access tokens on the server and uses its writable session accessor to persist refreshed credentials.

No scheduled task is needed to close voting. Every read and vote checks the deadline. API restarts do not erase rounds or votes.

## Deployment and checks

Apply API migrations `1791000000000_add-decision-night-voting.sql` and `1791200000000_add-decision-night-visibility.sql` before using the updated routes. The visibility migration defaults to hidden and leaves existing rounds and votes unchanged. Deploy the API before the website. The original voting migration adds rounds and ballots; none of these migrations changes attendance.

Also apply `1791300000000_add-presentation-sections.sql` and `1791400000000_add-decision-night-flags.sql` before this version of the API. Existing write-ups, voting rounds and ballots are preserved.

Run the API suite against the existing isolated test database. Website coverage is in `scripts/test-decision-night.cjs` and `scripts/test-decision-slides.cjs`, included in the standard auth CI step. Tests cover permissions, private responses, duplicate submissions, concurrent opening, requests delayed beyond expiry, browser candidate changes and the website proxy's origin check.

Before the meeting, rehearse with permitted accounts in a non-production environment: open a round, vote, change a vote, let it expire, open the next rushee, and inspect results as both a manager and an ordinary member. Do not create test votes in the real meeting's records.

## Distribution simulation and upcoming two-round workflow

The approved relative split is **25% in / 35% discussion / 40% out**. For 60 PNMs this targets **15 in, 21 discussion, 24 out**. Average ballot weights are Strong yes +1, Weak yes +0.5, Undecided 0, Weak no -0.5, Strong no -1. Placement in the in/out groups requires at least 28 votes, based on an expected minimum of 35 voters. In/out counts round down; discussion receives the remainder. Boundary ties and low-turnout tie groups stay together in discussion, with no backfilling. Discussion can therefore exceed 35%.

Executive-board/pledge-committee `GET /decision-night/rankings` provides a latest-closed-round preview, incomplete if anyone has no ballots or voting is active. The default minimum is 28; the optional minimum_votes query may raise it. The preview does not persist decisions or award bids. No migration is required. Ordinary members outside the pledge committee do not gain access.

### Try the interactive simulation

In the ktp-api repository, open `docs/simulations/decision-night-simulator.html` in a browser. It is self-contained and works offline.

1. Set the PNM and member counts, then start a new scenario (defaults: 60/35). Try tie, low-turnout, identical-score and missing-vote presets. Change the in/discussion/out percentages and use Apply distribution to keep the same votes while comparing splits. Whole percentages must total 100; these overrides affect the simulation only.
2. Select an applicant or click their name, edit the five vote counts and apply them. Check the 27-versus-28-vote behavior or mark voting still open.
3. Confirm round one to freeze its synthetic groups. The second-round queue contains only discussion candidates.
4. Generate second-round votes or edit ballots individually. The original in/out groups remain fixed, and first-round averages stay visible.
5. Start a new scenario to reset. Percentage controls stay locked during round two. Reloading clears the rehearsal.

This simulation contains no real applicants, makes no network calls, and changes no portal data. It uses the same scoring source as the API. Rebuild with `node scripts/build-decision-night-simulator.js` after source changes. Deterministic CLI scenarios are available through `node scripts/simulate-decision-night.js`; report: `docs/simulations/decision-night-25-35-40/decision-night-simulation.md` in ktp-api.

**Still required for production:** persisted confirmation/locking of first-round groups and source ballots, a second-round queue excluding locked in/out applicants, confirmed-decision controls, and a non-production browser rehearsal. The results hub and embedded offline simulator are implemented. The local simulator's lock is not an implemented production lock. A 25-33-person class remains a committee decision; with 15 confirmed in, another 10-18 would be selected from discussion.
