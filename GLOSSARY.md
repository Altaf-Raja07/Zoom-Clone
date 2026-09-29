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
A Meeting with a title, start time and duration, listed under Upcoming until it
begins.
_Avoid_: Calendar event
