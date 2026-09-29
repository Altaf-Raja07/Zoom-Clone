# 07: Live room — participant list over WebSocket

**What to build:** Two people open the same Meeting in two separate browsers.
When the second person joins, the first sees them appear, without refreshing. This
is the centrepiece of the whole application and the riskiest slice in the build.

The realtime layer is a WebSocket per client, scoped to a Meeting, with an
in-process broadcast hub on the backend. Two consequences follow and are
load-bearing rather than incidental:

- Because the hub holds participant state in process memory, the backend must
  run as exactly **one** instance with exactly **one** worker. A second instance
  would scatter participants into rooms that cannot see each other. This is
  invisible in the code and looks like free headroom, so it is recorded in
  ADR-0002 to stop a later reader "fixing" it.
- "Who is in this room" becomes a **query**, not a table, because leaving is
  soft (ticket 11). The filter for currently-present participants lives in
  exactly one repository function that nothing else bypasses — a bare filter on
  the Meeting alone is a bug that returns past attendees, and the API-level tests
  in this ticket are what hold that rule in place.

The start timestamp is set when the first participant joins. It is the honest
test for whether a Meeting has actually begun, and it orders in-progress Meetings
to the top of Recent Meetings.

**Blocked by:** 03 (Join a Meeting by ID or Invite Link).

**Status:** ready-for-agent

- [ ] A second browser context joining a Meeting appears in the first context's participant list with no refresh
- [ ] The participant list shows the user's own entry, so they can confirm they are identified correctly
- [ ] The start timestamp is set when the first participant joins
- [ ] The client sends a heartbeat roughly every 25 seconds, keeping the free hosting tier awake and signalling that the Meeting is still live
- [ ] A participant-count indicator is visible
- [ ] The Meeting's title is shown in the room
- [ ] Playwright uses **two independent browser contexts** for the realtime assertion, not one shared context — a single context could pass on shared in-page state and prove nothing about the WebSocket
- [ ] The room uses the dark meeting-stage visual language from the Zoom Workplace reference
- [ ] **The "who is in this room" filter is asserted at the API level**, and repository functions are reached only through the API so the single-guard rule stays under test
- [ ] The single-instance, single-worker constraint is documented where it could otherwise be mistaken for free headroom
