# Meetly

A Zoom-style conferencing platform. This repository is the product spec, the
architecture decisions behind it, and the implementation.

**Current state:** tickets 01 to 07. A first-time visitor opens the app, is
given a real `User` row through a signed cookie, and is greeted on the dashboard
by their Display Name. There is no signup and no login step. Clicking New
Meeting creates a Meeting and takes the host to a **pre-join screen**, with an
eleven-digit Meeting ID grouped 3-4-4 and an Invite Link that reaches the
clipboard in one action. Someone who has been sent that Invite Link, or told the
Meeting ID, can join it: both resolve to the same Meeting, and a malformed,
unknown, not-yet-started or already finished one is refused with a plain sentence
instead of a blank screen. Clicking Schedule Meeting books a Meeting for later
with a topic, description, date, time and duration, and hands back an Invite Link
that can be shared immediately — the link is refused as too early only when
someone tries to *join* through it before the Meeting's time. The dashboard's
**Upcoming Meetings** and **Recent Meetings** sections are both live, driven by
real rows and both filtered on the Host, so a reviewer never sees a stranger's
booking.

**The pre-join screen is the part to look at first**, because its unhappy paths
are the design. Before entering, a person sees themselves in a live local camera
preview, confirms the name they will be known by, and turns the microphone and
camera on or off. Nothing about entering is ever taken away over a device: a
denied permission, a machine with no webcam, and a machine with no microphone each
produce a sentence naming the cause *and* the way forward, and each still reaches
the room. The camera and the microphone are asked for **separately**, so a laptop
with no webcam does not also cost you your microphone. It is the first of three
surfaces designed without a reference screenshot — see the honesty notes below.

**The room is live.** Open the same Invite Link in a second browser and the
first person sees you appear in their participant list, with a count on the
title bar, without refreshing — one WebSocket per person over an in-process
broadcast hub. Leaving stamps a timestamp, and a past attendee does not reappear.
The room's own stage is dark, matching the Zoom Workplace screenshots, and its
toolbar follows the reference's left / centre / right arrangement with the
destructive end-meeting control alone at the far right. Mute and video are real
in both directions: pressing mute in one browser changes the other person's tile
and panel row, and a person with no camera or microphone is still listed, named
and able to participate. You see your own camera as a live preview; everybody
else is a labelled placeholder, because there is no peer-to-peer transport and a
tile that looked like live video would be a lie. It has **no chat, no leave and
no end-meeting behaviour yet** — those are tickets 09 and 10, and the two
controls are present but disabled rather than drawn and dead.

## Seeing a populated dashboard

A first run seeds a **Demo Identity** — Altaf Raja, four guests, one completed
Instant Meeting with real join and leave timestamps, and three Scheduled Meetings
over the next few days. The seed runs on every start (`python -m app.seed`) and is
idempotent, so a restart adds nothing.

Because your own two sections are filtered on the Host, the seeded data is behind
an explicit **"Show the demo identity's meetings"** button at the foot of the
dashboard rather than being served to you as though it were your own. It is
read-only: it does not sign you in as the Demo Identity, and any Meeting you
create stays yours.

What the seed deliberately does **not** write: any participant still present in a
room, and any chat messages. Attendance that claims somebody is in a meeting that
ended two days ago is the one kind of fake data that would make the live room look
broken on arrival. Start your own meeting to exercise live state.

- `SPEC.md` — the product spec and the implementation decisions behind it
- `GLOSSARY.md` — the domain language, and what to call things
- `docs/adr/` — the decisions that were reversible and the reasoning
- `docs/zoom-reference-notes.md` — what was observed in the supplied
  screenshots, and what was not
- `docs/deploying-to-render.md` — how the deployed app is put together, and the
  one free-tier limitation worth knowing before you start
- `backend/` — FastAPI + SQLAlchemy + SQLite
- `frontend/` — Next.js, CSS Modules, three-layer design tokens

## Running it

From a fresh checkout:

```sh
python3 -m venv .venv && .venv/bin/pip install -e './backend[dev]'
cd frontend && npm install && cd ..
```

Then, in two terminals:

```sh
./scripts/dev-backend.sh     # migrates, then serves on :8000
./scripts/dev-frontend.sh    # serves on :3100
```

The database is a single SQLite file at `MEETLY_DATABASE_PATH`
(default `backend/data/meetly.sqlite3`). Migrations run on every start and the
seed runs on every start, so there is no manual step before the app serves.

The frontend reaches the backend at `NEXT_PUBLIC_API_BASE_URL` (default
`http://localhost:8000`), sending credentials so the identity cookie travels.

## Tests

Two seams, deliberately. `SPEC.md` explains why there are no tests below them.

```sh
cd backend && ../.venv/bin/python -m pytest   # the API, over HTTP
cd backend && ../.venv/bin/ruff check .       # lint
cd frontend && npm run check                  # typecheck + token layer guard
cd frontend && npx playwright test            # the running frontend, in a browser
```

The browser tests start both servers themselves, so no dev server needs to be
running first.

## Honesty notes

Things a reviewer should not take on trust, stated up front rather than
discovered:

- **The palette is approximated, not measured.** No CSS value was read from a
  live Zoom surface, so no colour in this repository may be described as Zoom's
  actual colour. See `docs/zoom-reference-notes.md`.
- **Three surfaces have no reference at all** — pre-join, the
  participants/chat panel, and the mobile layouts. They are designed from Zoom
  convention and are unvalidated.
- **There is no real audio or video transport.** ADR-0001 says why, and
  explicitly says not to "fix" it by wiring up `RTCPeerConnection` without
  TURN, which works on localhost and fails in the deployed demo. Remote
  participants are drawn as simulated tiles and are labelled as such in the
  room, because a tile that looked like live video would be the one genuinely
  misleading thing on screen.
- **The backend must run as exactly one instance with exactly one worker.** The
  broadcast hub holds open WebSocket connections in process memory, so a second
  worker or a second instance would put participants into two sets of rooms that
  cannot see each other. It presents as an occasional stale participant list, it
  gets worse as the app gets busier, and it looks exactly like a scaling win.
  It is not a bug and scaling does not fix it. `scripts/dev-backend.sh` and
  `render.yaml` both state `--workers 1` and `WEB_CONCURRENCY=1` explicitly
  rather than relying on the defaults, so that changing it is a visible edit.
  See ADR-0002 and `backend/app/realtime.py`.

## The realtime layer

One WebSocket per participant, scoped to one Meeting, at
`/api/meetings/{id}/ws`, fanned out by an in-process hub. Messages are JSON with
a `type`:

| Direction | Type | Meaning |
|---|---|---|
| server → client | `participants` | The whole room, on connect and after every change. Always the full list, never a delta, so a client cannot drift out of step through a dropped frame. |
| server → client | `refused` | The Meeting cannot be entered, and this is the sentence saying why. |
| server → client | `pong` | The answer to a `ping`. |
| client → server | `ping` | Every ~25 seconds. |

**The heartbeat is load-bearing, not politeness.** Render's free tier idles
aggressively, and an idled instance drops the WebSocket underneath a meeting that
is still happening. The ping is what keeps the service awake.

**Presence is a query, not a cache.** "Who is in this room" is answered by one
repository function carrying the `left_at IS NULL` filter, and every broadcast
re-reads it. The hub holds which *sockets* are attached, never who is present —
so a dropped connection cannot leave a phantom in the list. `GET
/api/meetings/{id}/participants` exists for the same reason: it is the only way
to observe that filter, and every WebSocket test runs in a room where nobody has
left yet.
