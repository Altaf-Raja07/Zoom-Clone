# 03: Join a Meeting by ID or Invite Link

**What to build:** A person who has been sent a link opens it and is in the
meeting. A person who has only been told the number types it into the Join
screen and is in the meeting. Before entering, they confirm the Display Name
they will be known by. If the Meeting does not exist, or has already ended, they
are told so plainly rather than being left on a blank screen.

This is the second entry point the assignment requires, and it is the one that
proves the two-identifier design earns its keep: the link and the typed code
resolve to the same Meeting without either identifier being the primary key.

**Blocked by:** 02 (Create an Instant Meeting).

**Status:** done, except the ended case in a real browser (see Not done here).

- [x] A Meeting can be joined by opening an Invite Link
- [x] A Meeting can be joined by typing its Meeting ID
- [x] A non-numeric or malformed ID is rejected before any lookup
- [x] An ID that matches no Meeting reports that the Meeting does not exist, and does not enter a room
- [x] A Meeting that has ended reports that it has ended, and does not enter a room
- [x] The Display Name is confirmed before entering and is the name other participants will see
- [x] The join control is disabled until the entered value is valid
- [x] A guest can join a Meeting they did not host, with no login step
- [x] API tests cover the link path, the typed-ID path, the unknown-ID case, and the ended case

## What was built

- `backend/app/api/meetings.py` — `GET /api/meetings/by-code/{code}`, the
  second door. It is the route the Invite Link's code and a typed Meeting ID
  both resolve through, which is where the two-identifier design is actually
  tested rather than asserted in a comment.
- `backend/app/join_codes.py` — `read_join_code`. The grouping spaces are
  forgiven, because a host reads `123 456 789 01` aloud and the person listening
  types it with the spaces in; nothing else is.
- `backend/app/api/session.py` — `PATCH /api/session`, the Display Name
  confirmation. It returns the *stored* value rather than an echo of what was
  sent, so a name truncated to the column's length cannot be corrected in one
  place and not the other.
- `frontend/src/components/Join/` and `frontend/src/app/join/` — one screen for
  both entry points, and `/join` wired to the dashboard's Join Meeting action.

## Three decisions worth flagging for later tickets

- **"Join" here means resolve, refuse, confirm, enter.** No Participant row is
  created and `started_at` is not stamped, because ticket 07 owns both — it is
  the ticket that makes a participant list real, and it says the start timestamp
  is set when the first participant joins. So this ticket's join is honest about
  what it is: a person is *admitted to* a Meeting, not yet *in* its room. The
  guest lands on the arrival screen, and the room screen says so.
- **Ended is refused at both doors.** The review caught this: the 410 was on the
  by-code route only, so a reloaded room, a bookmark, or a URL copied from the
  address bar still entered a finished Meeting. `has_ended` is now the single
  place that state is read, and both `GET` routes consult it.
- **The frontend shows the API's own refusal.** `apiFetch` now carries `detail`
  through on `ApiError` instead of discarding it, so the sentence a person reads
  is written once, in the API, where the refusal is decided. The frontend keeps a
  fallback for the two failures the API cannot describe — a network that never
  answered, and a 5xx.

## Not done here

- **The ended case has no Playwright test.** Nothing ends a Meeting until ticket
  10, so a browser run cannot produce one without a stub, and a stubbed backend
  would prove nothing about identity. It is covered at the API seam, where the
  test harness arranges the state and the assertion is still an HTTP response.
  This is a gap, not a decision: it closes when ticket 10 lands.
- **"The name other participants will see" is only half-asserted.** The API test
  proves the name is stored on the User row every later reader will use. Nobody
  is a Participant until ticket 07, so the *other* half — that the room shows it
  — cannot be asserted yet. The e2e proves the same name greets the guest on the
  dashboard afterwards.
- **The navbar is now in three CSS modules.** Left alone, on the same reasoning
  ticket 02 recorded: the dashboard ticket introduces the chrome they share, and
  a shared component built for two callers now would be rewritten for the third.
- **`isJoinCodeShape` in `frontend/src/lib/api.ts` is a copy of
  `read_join_code`.** Deliberate, and unavoidable: the Join control must know
  whether to enable itself (requirement 30) before any request exists. The API
  still decides whether to answer, so the copy can only cost a momentarily
  optimistic button, never an entry into the wrong Meeting.
- **The Meeting ID is a bare `str` end to end**, from `read_join_code` to
  `getMeetingByJoinCode`. A small type would say "eleven digits, grouped 3-4-4"
  in one place instead of in a docstring, a placeholder and a regex. Not worth
  it until a second operation on the code exists to share it with.
