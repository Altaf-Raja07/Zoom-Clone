# Meetly

A Zoom-style video conferencing platform: users create, schedule and join
meetings, and meet in a live, real-time room.

## Language

**User**:
A person who can own meetings and be named on them. Created on first visit from
a display name the person chooses; there is no password and no login step.
_Avoid_: Account, guest (a User is not a lesser kind of User)

**Display Name**:
The human-readable label a person goes by in a meeting. Chosen at join time and
not required to be unique.
_Avoid_: Username, nickname

**Demo Identity**:
A pre-seeded User that exists to make a first run non-empty. Never used to
authenticate — a production guest still gets a fresh User from their own cookie.
Only offered where explicitly initialised, never as a silent default.
_Avoid_: Test user, admin, default account

**Meeting**:
A scheduled or in-progress gathering. Exists whether or not anyone has joined
it yet.
_Avoid_: Session, call, room (the room is where a Meeting is *held*)

**Host**:
The User who created a Meeting. Exactly one per Meeting; owns its invite link
and controls it.
_Avoid_: Owner, moderator, admin

**Participant**:
A User who has joined a Meeting's room. Distinct from Host: the Host is also a
Participant once they join, but keeps host rights.
_Avoid_: Attendee, member, guest

**Invite Link**:
The shareable URL that carries a Meeting's ID, so joining needs no typed code.
_Avoid_: Meeting URL, share link

**Instant Meeting**:
A Meeting with no start time — created on the spot and joinable immediately.
_Avoid_: Ad-hoc meeting, quick meeting

**Scheduled Meeting**:
A Meeting with a start time and a duration, listed under Upcoming until that
time arrives. Its title and description are optional; its start time is not, and
the Meeting cannot be joined before it. Once its time has passed it leaves
Upcoming even if nobody has joined it — "begins" means the clock, not the
attendance — and it is still Recent.
_Avoid_: Calendar event

**Dashboard sections**:
Upcoming Meetings (what is coming) and Recent Meetings (what I host). Both are
filtered on the Host, so neither shows a stranger's Meeting, and both can hold the
same Meeting: Upcoming is the subset that has not arrived yet.
_Avoid_: History (Recent is hosted-only, not everything attended)

**Demo Identity**:
See above — offered only where explicitly initialised. A reviewer reaches it
through a read-only dashboard control; nobody is signed in as it, and a
production guest never receives it.
