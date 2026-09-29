# 04: Schedule a Meeting

**What to build:** A user can book a meeting for later — giving it a title, a
description, a date, a time, and a duration — and receive an Invite Link they
can share before anyone arrives. The meeting appears under Upcoming Meetings
(built in ticket 05) and becomes joinable when its time arrives, so the schedule
is an action rather than a calendar entry.

A Scheduled Meeting and an Instant Meeting are the same row in the same table.
A scheduled start time that is present marks one as scheduled; its absence marks
one as instant. There is deliberately no separate kind column, because a column
duplicating a fact already implied by an absence is exactly the class of bug the
schema decisions in ADR-0004 refuse elsewhere.

Only the fields the assignment requires are built. Recurrence, invitees by
email, time-zone selection, passcode, and waiting room are out of scope, and the
form is not a truncated version of Zoom's larger dialog.

**Blocked by:** 01 (Project spine and first-run guest identity).

**Status:** done, except the Upcoming list and the browser check of the
admitting side (see Not done here).

- [x] A Meeting can be created with a title, a description, a date, a time, and a duration
- [x] A Scheduled Meeting receives an auto-generated Invite Link, usable before the Meeting begins
- [x] A Scheduled Meeting is stored with a scheduled start time, distinct from the Instant case where it is absent
- [x] A Scheduled Meeting becomes joinable once its start time has arrived
- [x] A Scheduled Meeting cannot be joined before its start time
- [x] Title and description are optional, and the Meeting renders sensibly without them
- [x] The form does not present controls for recurrence, invitees, passcode, or waiting room
- [x] API tests assert creation, the presence of a scheduled start time, and both the joinable and not-yet-joinable cases

## What was built

- `backend/app/api/meetings.py` — `POST /api/meetings/scheduled`, the booking
  form's endpoint, and the start-time gate on the by-code route. A second create
  rather than a body on the first, because an Instant Meeting has no fields to
  fill in and a scheduled one has four.
- `backend/app/repository.py` — `create_scheduled_meeting` and `has_started`.
  The two creates now share one function that has to get a Meeting ID, rather
  than each carrying a copy of the collision retry.
- `frontend/src/components/Schedule/` and `frontend/src/app/schedule/` — the
  form, and the confirmation that hands back the Invite Link.
- `frontend/src/lib/api.ts` — `scheduleMeeting`, plus `explainApiError`, which
  the join screen now shares instead of keeping its own copy of.

## Four decisions worth flagging for later tickets

- **"Not yet" is a 425 of its own.** Waiting, missing and finished are three
  different answers and now have three codes. Answering 404 or 410 here would
  tell someone their host was never there, or that the Meeting is over, at the
  moment before it starts.
- **The gate is on the door that admits, not the door that renders.**
  `GET /api/meetings/{id}` — the room a host opens to read their own Invite
  Link — deliberately still answers before the start time. The asymmetry with
  the ended check is written down in the endpoint. The hole it would close does
  not exist: an Invite Link carries the Meeting ID, and the room is addressed by
  an internal id nobody outside the app is given.
- **The gate reads `scheduled_start_at`, not `started_at`.** `started_at` is
  stamped when the first participant joins, which is the honest record of
  whether anyone *has* started it and a dishonest gate: a meeting at nine
  o'clock with nobody in it would be locked at nine, and a guest arriving a
  minute early would be told to come back. Ticket 07 owns `started_at`, and it
  must not read it as a gate.
- **The browser resolves the time, the API refuses to guess one.** The form sends
  the instant with its offset attached; a timestamp with no offset is a 400
  rather than a value stored in the server's idea of a time zone. Time-zone
  selection stays out of scope, and the invitation to add it is deliberately not
  in the form.

## Not done here

- **Nothing in a browser test waits for a start time to pass.** The gate's
  admitting side is asserted at the API seam, where a Meeting can be booked a
  minute into the past instead of a test sleeping for an hour. What a browser
  does show is the refusing side, through the real join screen, because a
  sentence about a meeting that has not started is the part a person reads.
- **A booked Meeting appears nowhere in the app yet.** Upcoming is ticket 05,
  so the confirmation is the only place one is visible: the dashboard gained a
  working Schedule action and nothing else, and a host who closes the
  confirmation has no way back to what they booked. Requirement 38's other half
  — reaching your own scheduled Meeting when its time arrives — closes with the
  Upcoming list.
- **The navbar is now in a fourth CSS module**, and `Untitled meeting` is a
  constant in the schedule component. Both are left alone on the reasoning
  ticket 03 recorded: the shared chrome arrives with the dashboard ticket, and
  the fallback name is only needed by the one screen that shows a title so far.
- **The duration list is a constant in the frontend.** The API owns the range —
  a minute to a day — while the form offers 15 to 720, so a duration the API
  would accept but the form does not offer is possible, and harmless. One list
  would mean the form could offer a one-minute Meeting, which is worse.
- **The `<` against the `<=` in the gate is not pinned by a test.** The start
  time has always been microseconds in the past by the time a request is
  answered, so the two are indistinguishable from over HTTP, and pinning it
  would mean a clock this seam deliberately does not have. The test that looks
  like it pins it says so instead of claiming a coverage it does not have.
