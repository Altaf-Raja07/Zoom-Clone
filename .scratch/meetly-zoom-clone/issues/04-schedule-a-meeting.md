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

**Status:** ready-for-agent

- [ ] A Meeting can be created with a title, a description, a date, a time, and a duration
- [ ] A Scheduled Meeting receives an auto-generated Invite Link, usable before the Meeting begins
- [ ] A Scheduled Meeting is stored with a scheduled start time, distinct from the Instant case where it is absent
- [ ] A Scheduled Meeting becomes joinable once its start time has arrived
- [ ] A Scheduled Meeting cannot be joined before its start time
- [ ] Title and description are optional, and the Meeting renders sensibly without them
- [ ] The form does not present controls for recurrence, invitees, passcode, or waiting room
- [ ] API tests assert creation, the presence of a scheduled start time, and both the joinable and not-yet-joinable cases
