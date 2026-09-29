# 05: Dashboard Upcoming and Recent sections, and the seed

**What to build:** The dashboard shows a user's Upcoming Meetings and Recent
Meetings, both driven by real data, and a first run lands on a populated screen
rather than an empty one.

Recent Meetings lists **only Meetings the user hosted**, filtered on the host
column and ordered by a recency timestamp — the later of the creation timestamp
and the start timestamp, falling back to the creation timestamp — with the
Meeting ID as a deterministic tie-break. It does not order by the scheduled
start time, which is null for Instant Meetings and describes a planned time
rather than when a meeting was actually created or started. The hosted-or-attended
union was considered and rejected in favour of a simple query; participation
history is a later addition (ADR-0004).

Seed data is idempotent and makes the design visible: a Demo Identity plus a few
guests, one completed Instant Meeting with genuine join and leave timestamps, and
two or three Scheduled Meetings over the next few days so Upcoming is populated
on first run. No fake active presence and no seeded chat — a reviewer creates
their own Meeting to exercise live state.

The Demo Identity is offered only where explicitly initialised and never
shadows a production guest, who always receives their own User.

**Blocked by:** 04 (Schedule a Meeting).

**Status:** ready-for-agent

- [ ] Upcoming Meetings lists the user's Scheduled Meetings with date and time, soonest first
- [ ] Recent Meetings lists only Meetings the user hosted, excluding Meetings they merely attended
- [ ] Recent Meetings excludes Meetings belonging to other users
- [ ] A freshly-created Instant Meeting appears at the top of Recent Meetings
- [ ] Ordering is by the later of the creation and start timestamps, with the Meeting ID as a deterministic tie-break
- [ ] **Regression: a Scheduled Meeting whose start time has passed but which nobody has actually started sorts by its creation timestamp and may fall below a fresh Instant Meeting** — this is correct, because nobody started it, and is asserted so it is not later "fixed"
- [ ] Recent Meetings is empty when the user has hosted nothing, and is never backfilled with fabricated history
- [ ] Both sections show a clear empty state rather than a blank area
- [ ] Seeding creates the Demo Identity, additional guests, one completed Instant Meeting with real join and leave timestamps, and Scheduled Meetings over the next few days
- [ ] Seeding stores no fake active presence and no chat messages
- [ ] Running the seed repeatedly does not increase the count of users, Meetings, or attendance records
- [ ] A production guest always receives their own User and is never handed the Demo Identity
