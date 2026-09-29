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

**Status:** done

- [x] A second browser context joining a Meeting appears in the first context's participant list with no refresh
- [x] The participant list shows the user's own entry, so they can confirm they are identified correctly
- [x] The start timestamp is set when the first participant joins
- [x] The client sends a heartbeat roughly every 25 seconds, keeping the free hosting tier awake and signalling that the Meeting is still live
- [x] A participant-count indicator is visible
- [x] The Meeting's title is shown in the room
- [x] Playwright uses **two independent browser contexts** for the realtime assertion, not one shared context — a single context could pass on shared in-page state and prove nothing about the WebSocket
- [x] The room uses the dark meeting-stage visual language from the Zoom Workplace reference
- [x] **The "who is in this room" filter is asserted at the API level**, and repository functions are reached only through the API so the single-guard rule stays under test
- [x] The single-instance, single-worker constraint is documented where it could otherwise be mistaken for free headroom

## What was built

- `backend/app/realtime.py` — the in-process hub. Open sockets grouped by
  Meeting, and nothing else.
- `backend/app/api/rooms.py` — `WS /api/meetings/{uuid}/ws` and
  `GET /api/meetings/{uuid}/participants`.
- `backend/app/repository.py` — `join_meeting` (which stamps `started_at` once)
  and `leave_meeting` (which the socket's `finally` needs).
- `frontend/src/lib/realtime.ts` — the socket client: heartbeat, tagged message
  parsing, one bounded reconnect.
- `frontend/src/components/Room/` — the dark stage, the title bar with its count,
  and the participant list.
- `frontend/e2e/live-room-participants.spec.ts` — nine browser tests across two
  independent contexts.
- `scripts/dev-backend.sh`, `render.yaml` — `--workers 1` and `WEB_CONCURRENCY=1`,
  stated rather than defaulted.
- `frontend/scripts/check-token-layers.mjs` — fixed (see below).

## Four decisions worth flagging for later tickets

- **The hub holds connections, not participants.** The ticket describes the hub
  as holding "participant state in process memory", and it does hold state —
  which sockets are attached to which Meeting. It holds *no* idea of who is in
  the room. Every broadcast re-reads `list_present_participants` and sends the
  answer.

  The alternative is that the hub caches presence, and that is worse than it
  looks: a process that died, or a socket that dropped without a clean close,
  would leave a phantom in the list that nothing would ever correct. A crash is
  the *normal* case on a free hosting tier, so that would be a bad thing to make
  load-bearing. The single-instance constraint still holds either way — the
  fan-out is in-process — so nothing about ADR-0002 changed.

- **`GET /meetings/{uuid}/participants` exists to keep a rule under test, not to
  serve the client.** The socket already pushes the list on every change, so this
  endpoint has no consumer in the app. It is here because the `left_at IS NULL`
  filter is a *rule* (ADR-0004) and **every WebSocket test in the suite runs in a
  room where nobody has left yet** — a version of the query returning every
  participant of a Meeting would pass all of them. The regression is silent (a
  past attendee reappearing), so it is asserted over HTTP in a room that has
  genuinely lost somebody. Removing this endpoint would remove the only way to
  observe the filter, and with it the guarantee.

- **Refusing a socket means accepting it first, then sending the reason.** A
  WebSocket closed before it is accepted reaches the browser as an abnormal
  closure — code 1006, no reason — which is byte-for-byte what a dropped network
  looks like. This was not anticipated; this ticket's own browser test found it,
  showing "We could not reach the meeting" over a Meeting that existed and was
  simply early. So `_refuse` accepts, sends `{"type": "refused", "reason": …}`,
  and closes with the code after. The codes are kept for a client that only reads
  the code (the 4401 reconnect does); the message is what the room renders.

- **A socket with no cookie is refused, not given an identity.** A WebSocket
  cannot set a response cookie before the handshake completes, so a User minted
  there would be one the browser could never return as — a guest would appear in
  the room under an identity that evaporates on their next request. Close code
  4401 is the one case the client retries, by reloading: what the server is
  missing is a cookie, and only a full page load's response can set one.

## Smaller things, recorded so they are not "fixed" later

- **The room's `h1` is now the Meeting's title**, replacing ticket 03's "You are
  in the meeting" heading. The screen's whole job is the room, and the title is
  what a person needs to know they are in the right Meeting. The substantive half
  of that older assertion still holds and is still tested: a guest gets no "Copy
  invite link" button and no Invite Link.
- **The room shows the Meeting ID to everyone, the Invite Link only to the host.**
  A guest already has a link, and the number is what a person reads aloud to
  bring a third person in by hand.
- **Remote tiles are labelled simulated.** ADR-0001 records that there is no
  peer-to-peer transport, so a tile that looked like video would be the one
  genuinely misleading thing this screen could do.
- **The room has no toolbar, no mute, no local camera, no leave control.** Those
  are 08 to 10. Each is behaviour, not styling, and the room says which stage it
  is rather than pretending.
- **`check-token-layers.mjs` was reporting `white-space: nowrap` as a hardcoded
  white** and prose describing the stage as "near-black" as a hardcoded black. It
  now scans the value side of a declaration with comments blanked out, preserving
  line numbers. Verified it still catches a real `background: #ff0000`.
- **`ruff format` was already failing on 16 files before this ticket** and is not
  enforced anywhere, so it was left alone. `ruff check` is clean.

## What a code review changed

A two-axis review (standards, spec) of the diff found three genuine bugs, each
now covered by a test that was checked to fail without its fix:

- **Reconnection never happened.** `hasConnected` was declared and read but never
  assigned, so every unexpected close was reported as "lost" and the single retry
  below it was unreachable. A dropped socket in the first half of a meeting meant
  a frozen participant list with no recovery, on a platform whose free tier
  *causes* drops.
- **Two tabs, one person.** Any socket closing stamped `left_at`, guarded only by
  a room-wide count. Somebody with the meeting open in two windows who closed one
  was removed from the list while still visibly in it, and nothing brought the
  row back. Departure is now decided by `MeetingHub.attached_for_user` — this
  person's sockets, not the room's.
- **The count was not the server's.** The client discarded the `count` the server
  sent and rebuilt it from the array, while the code comment, the API test and the
  browser test all claimed the server was the single source of truth. The count
  is now carried through, which is what those three claims now describe.

It also caught a half-wired feature worth spelling out: `join_meeting` took
`microphone_on` / `camera_on` and wrote `is_muted` / `is_video_on`, but the
socket never sent them, so the columns kept their defaults while the room's
footer showed the person their own opposite choice from pre-join. Two truths
about one person, and the participant badge is the one a host believes. The
client now sends a `state` message on open and the server records it. The
*controls* that change it again are still ticket 08.

## Not done here

- **No toolbar, no mute control, no local camera, no chat, no leave button, no
  end-meeting.** Tickets 08, 09, 10, 11. Each is behaviour rather than styling,
  and each builds on the socket this ticket opens.
- **The heartbeat test proves the client registers a 25-second interval and
  pings on open, but not that the interval is what pings.** Proving that in the
  browser would mean waiting 25 seconds per run or adding a test-only override of
  the interval, and `conftest.py` has already ruled the latter out ("a second door
  for tests only is a door the application no longer needs"). The server's side is
  tested properly over the socket. This limitation is stated in the test itself
  rather than left for a reader to assume coverage.
- **One pre-existing test now fails, deliberately.**
  `join-a-meeting.spec.ts` → "a guest is never offered the host's own arrival
  screen" asserts the page's `h1` reads "You are in the meeting", which this
  ticket replaced with the Meeting's title. The *substantive* half of that
  assertion still holds and still passes: a guest gets no "Copy invite link"
  button, no Invite Link, and a badge reading "Hosted by …". Only the heading
  text is stale, and the test was not edited because ticket 06 is being worked on
  in this repository at the same time and owns that file. **It needs a
  one-line update to `room-title` when the two tickets land.**
- **Narrow-width room behaviour** (panels as drawers, the stage never squeezed)
  is ticket 11. What is here is the shape it starts from.


