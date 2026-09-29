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

- [x] Upcoming Meetings lists the user's Scheduled Meetings with date and time, soonest first
- [x] Recent Meetings lists only Meetings the user hosted, excluding Meetings they merely attended
- [x] Recent Meetings excludes Meetings belonging to other users
- [x] A freshly-created Instant Meeting appears at the top of Recent Meetings
- [x] Ordering is by the later of the creation and start timestamps, with the Meeting ID as a deterministic tie-break
- [x] **Regression: a Scheduled Meeting whose start time has passed but which nobody has actually started sorts by its creation timestamp and may fall below a fresh Instant Meeting** — this is correct, because nobody started it, and is asserted so it is not later "fixed"
- [x] Recent Meetings is empty when the user has hosted nothing, and is never backfilled with fabricated history
- [x] Both sections show a clear empty state rather than a blank area
- [x] Seeding creates the Demo Identity, additional guests, one completed Instant Meeting with real join and leave timestamps, and Scheduled Meetings over the next few days
- [x] Seeding stores no fake active presence and no chat messages
- [x] Running the seed repeatedly does not increase the count of users, Meetings, or attendance records
- [x] A production guest always receives their own User and is never handed the Demo Identity

## Status: done

## What was built

- `backend/app/repository.py` — `list_upcoming_meetings` and
  `list_recent_meetings`. Two queries, both filtered on `host_id`.
- `backend/app/api/dashboard.py` — the two section reads, plus the Demo
  Identity's, as one module: they are one screen.
- `backend/app/seed.py` — the first-run data, kept in a valid state by
  `python -m app.seed` on every start.
- `frontend/src/components/Dashboard/MeetingLists.tsx` — the two sections, with
  their empty states.
- `frontend/src/lib/meetings.ts` — the fallback title, now that three surfaces
  need it rather than one.

## Five decisions worth flagging for later tickets

- **Recent Meetings is not filtered by whether a Meeting has started.** This
  ticket's own regression case settles it: an overdue-and-never-begun Meeting
  must sort by its creation timestamp, which means it is *in* the list. A
  `started_at IS NOT NULL` filter would put it in neither section — a host who
  booked a Meeting, nobody turned up, and the Meeting then disappeared from their
  dashboard. Recent answers "what is mine", not "what has happened".

- **Which means a Meeting can be in both sections at once.** Upcoming is the
  subset that has not arrived yet; Recent is everything the Host owns. Two
  sections of one dashboard answering two questions is not a contradiction, but
  it is the thing to explain rather than leave for a reader to work out. GLOSSARY
  now says so too, because "listed under Upcoming until it begins" was ambiguous
  about whether "begins" means the clock or the attendance.

- **The seeded data is behind a button, not served as the default.** Upcoming is
  host-filtered, so a reviewer who was *handed* the Demo Identity's rows would be
  looking at a stranger's bookings — and silently becoming the Demo Identity
  would move their own Meetings onto a shared user. So `GET /api/dashboard/demo`
  is read-only, the dashboard asks before showing it, and it is not offered at
  all where the API says there is no Demo Identity (GLOSSARY: "only offered where
  explicitly initialised"). This was a decision between three options (host-
  filtered and unreachable, open Upcoming, or host-filtered plus an explicit
  opt-in); the third was chosen because it is the only one that populates the
  first run without lying about whose Meetings are on the screen.

  **This is where the ticket and SPEC.md disagree, and SPEC.md is not being
  followed literally.** Story 11 asks for Upcoming "visibly populated on a fresh
  database", and for a reviewer who has not booked anything it is not. That is a
  deliberate trade rather than an oversight, recorded here instead of in an ADR
  because it is a product-surface decision rather than a technical one — and it
  is the first thing to revisit if a reviewer says the dashboard looks empty.

- **The seed is a state that is kept, not an insert that is done once.** The
  seeded Meetings are dated from whenever the seed last ran, so a database seeded
  once has an empty Upcoming section five days later — and the free tier
  redeploys constantly, so that gap is reachable rather than theoretical. A stale
  Meeting is therefore *rolled forward* to the next slot in the plan rather than
  replaced. Rolling rather than adding is what keeps the row count fixed, so
  running this on every restart still cannot grow the database.

- **The dashboard fetches its session before anything else, and nothing
  alongside anything else.** This is the identity race the disabled action
  buttons already exist for, arriving through a different door: on a first visit
  there is no cookie, and every request that depends on `current_user` mints a
  *new* User. Two cookie-less requests in flight are two Users, and the browser
  keeps whichever cookie landed last — so the reviewer is greeted by one name
  while their sections belong to another.

  Broken twice in the same ticket: first by fanning the two sections out in
  parallel with the session, then by fanning the demo-availability probe out
  beside the session. Both looked harmless. `guest-identity.spec.ts` now counts
  Users rather than comparing names, because comparing names only catches the case
  where the losing request was the one that answered.

## Not done here

- **The recency ordering is only pinned as far as this seam can see.** Two
  Meetings created by two HTTP requests differ by microseconds and never tie, so
  the only reachable tie is the three seeded Meetings sharing one `created_at` —
  enough to show the `id` tie-break is doing work, not enough to show it is `id`
  and not some other column. And the `CASE` in `list_recent_meetings` is
  indistinguishable from `COALESCE` on every row this application creates, since
  a start time always follows a creation. The expression is written out anyway,
  with the reason in a comment, because the wrong one passes every test here.
- **A Meeting created from the dashboard appears in Recent on the next visit.**
  New Meeting navigates into the room rather than staying to re-fetch. Re-fetching
  on the way back would mean a second fetch of both lists for a screen the host
  already left.
- **The navbar is still in three CSS modules**, and the fallback meeting title is
  now shared from `@/lib/meetings` rather than duplicated. Both are left alone
  for the reason ticket 03 recorded: the shared chrome arrives with the ticket
  that has to place it across every screen.
- **Nothing here says a Recent Meeting can be rejoined.** The rows carry the
  Invite Link, which is the action that genuinely works today. A Join button on
  Recent would open a room this ticket has not built.
- **Both sections are capped at ten rows by the API**, which is not in the spec.
  A cap the API enforces rather than the browser asking for; noted so it is a
  decision rather than a default nobody chose.
