---
sidebar_position: 16
---

# Member dashboard

The member dashboard preserves the blue gradient hero, serif welcome heading, blue date tiles and bordered cards. Controls are text-only. It uses two independent desktop columns so a tall card on one side does not create a gap on the other:

- Left: **Needs your attention**, then **My attendance** directly underneath.
- Right: **Latest announcements**, then **Upcoming events**.

On narrow screens these columns stack. Attention summarizes outstanding RSVPs, unanswered polls, unread messages, emergency decisions and permitted reviewer queues in compact linked rows. It only reports that the member is caught up after the relevant checks succeed. Failed resources have independent retries.

Announcements show the two latest entries with short body previews and **View all**. Upcoming events show the next three event dates in `America/New_York`, including every still-upcoming or in-progress event on those dates. Events sharing a date share one date tile and appear side by side, wrapping into two-column rows and stacking on narrow screens. The next event retains a subtle blue highlight; event titles link to the calendar.

Attendance uses the current semester's personal server totals and displays incomplete-history and open-check-in notes. It never silently substitutes an older semester. Viewer changes clear personal data and stale requests cannot overwrite newer results.

Chapter photos were removed from this dashboard, including its photo fetch. Photos remain in **Files & Photos**. A compact thumbnail strip there was suggested, but has not been implemented.

Implementation: `components/portal/MemberDashboard.jsx`, shared `DashboardHero.jsx`, `AttendanceAlerts.jsx`, `lib/member-dashboard.js`. Regression coverage: `scripts/test-member-dashboard.cjs` and `scripts/test-attendance-notifications.cjs`.
