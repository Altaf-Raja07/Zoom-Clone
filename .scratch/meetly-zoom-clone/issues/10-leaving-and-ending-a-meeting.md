# 10: Leaving and ending a Meeting

**What to build:** When someone leaves, everyone else finds out — their tile goes
and a notification says who left. The host can end the Meeting for everyone, and
afterwards nobody is stranded: they are returned to the dashboard.

Leaving stamps a leave timestamp rather than deleting the record, so attendance
survives the Meeting ending. This is what allows the "X has left" notification to
mean anything, and it is why "who is in this room" is a query guarded in exactly
one place rather than something the participant table can answer directly
(ADR-0004). The cost of that decision is paid in this ticket: every list of
current participants must apply the guard, and a forgotten filter shows yesterday's
attendees as though they were still in the room.

**Blocked by:** 08 (Mute, video, and the participant panel).

**Status:** ready-for-agent

- [ ] A participant who leaves disappears from other participants' views without a refresh
- [ ] A "X has left" notification is shown when someone leaves
- [ ] Leaving stamps a leave timestamp and preserves the attendance record
- [ ] Attendance for a Meeting survives the Meeting ending
- [ ] A past attendee does not reappear in the current participant list
- [ ] The host can end the Meeting, and all participants are returned to the dashboard
- [ ] Ending a Meeting is refused for a non-host at the WebSocket handler, not merely hidden in the interface
- [ ] An ended Meeting reports as ended when someone tries to join it
- [ ] API tests assert that attendance persists after leaving, and that the current-participant filter excludes past attendees
