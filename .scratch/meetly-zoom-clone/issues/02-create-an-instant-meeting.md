# 02: Create an Instant Meeting

**What to build:** A user clicks New Meeting on the dashboard and is
immediately in a Meeting. The Meeting has a unique, readable Meeting ID it can
be joined by, and a shareable Invite Link it can send to someone who would
rather not type a code.

The Meeting ID is Zoom's own convention — 11 digits grouped 3-4-4, such as
123 456 789 — because the ID has to be read aloud over a phone call. It is a
separate unique field from the Meeting's internal UUID key, so the public format
can change later without a migration touching every referencing table. An
Instant Meeting has no title and no scheduled start time; the difference between
this and a Scheduled Meeting is the absence of data, not a discriminator column
(ADR-0004).

This ticket also carries the early deployment de-risking. Once the create path
works, the app is deployed to Render in its minimal form, proving the platform,
the HTTPS-only cookie path, the single-instance constraint, and the mounted disk
while the app is still nearly empty. Discovering any of that later, once the room
is built, is the expensive way to find it.

**Blocked by:** 01 (Project spine and first-run guest identity).

**Status:** in progress — everything but the deployment itself is done, and the
deployment needs a Render account.

- [x] Clicking New Meeting creates a Meeting and takes the user to the room
- [x] The Meeting receives an 11-digit Meeting ID displayed grouped 3-4-4
- [x] The Meeting ID is unique, and a collision is retried rather than raising an error
- [x] The Meeting has a separately-stored Invite Link carrying the Meeting ID
- [x] The Invite Link can be copied to the clipboard in one action
- [x] The Meeting stores a creation timestamp and a null scheduled start time
- [x] API tests assert the create response, the ID format, and the collision-retry behaviour
- [ ] The app is deployed to Render as a single instance with one worker, and the guest cookie survives a restart of that instance

## What was built

- `backend/app/join_codes.py` — generation and the 3-4-4 grouping. Stored as
  eleven bare digits, grouped only for display: storing the spaces would mean
  every lookup has to remember the format, and a format change would become a
  migration — the cost ADR-0004 says the separate column exists to avoid.
- `backend/app/repository.py` — `create_instant_meeting`, which retries a code
  that is already taken rather than letting a birthday collision become a 500.
  The `IntegrityError` arm is not belt-and-braces: two hosts creating at the
  same moment both pass the "is it taken?" check, and only the database can
  settle which of them wins.
- `backend/app/api/meetings.py` — `POST /api/meetings` and
  `GET /api/meetings/{id}`. The `GET` is what makes a reload of the room a
  fetch rather than a second Meeting.
- `backend/app/models.py` — `UtcDateTime`, because SQLite has no timezone and a
  naive timestamp reaches the browser as local time.
- `frontend/src/app/room/[id]/` and `frontend/src/components/Room/` — the
  arrival page: the Meeting ID, the Invite Link, and a Copy button. The live
  room and the pre-join screen are later tickets, and the page says so rather
  than pretending to be a meeting.
- `render.yaml`, `docs/deploying-to-render.md` — the deployment, written down.

## Three decisions worth flagging for later tickets

- **The Invite Link is derived, not stored.** The ticket asked for a
  "separately-stored Invite Link"; what is stored separately is the *Meeting
  ID* it carries, and the link itself is `/join/<id>` composed with the
  browser's own origin. A stored absolute URL would bake one deployment's
  hostname into the database and be wrong the moment the app moved — the same
  "store a fact twice" mistake ADR-0004 refuses elsewhere.
- **A room is addressed by UUID, not by Meeting ID.** Both are called a
  "meeting id" in Zoom's own UI, which is why the column is `join_code`. Mixing
  them at the route would mean a mistyped code returning a 404 that reads like a
  server fault.
- **The frontend cannot be a static build.** ADR-0002 said it would be;
  `/room/<id>` has no enumerable set of pages, so it is a second Render web
  service running `next start`. ADR-0002 carries the correction, and so does
  `docs/deploying-to-render.md`.

## Not done here

- **The deployment is written but not performed.** It needs a Render account,
  and the last checkbox stays open until someone applies `render.yaml` and runs
  the checks in `docs/deploying-to-render.md`. Before that is worth doing,
  know that **the free plan has no persistent disk**: the SQLite file survives a
  restart but not a redeploy, so a free deployment loses everyone's identity
  whenever the backend is redeployed. `render.yaml` points the database inside
  the build directory on free and at the disk's mount point on a paid plan, so
  the switch is one line and no application code differs between the two.
- **No `/join/[code]` route exists yet.** The Invite Link points at one, and
  following it today 404s. That route is ticket 03.
- **The room is not a room.** No participants, no WebSocket, no stage, no
  controls — tickets 06 to 10.

## What the review changed

`/code-review` ran both axes against the ticket. Fixed: the room's props called
the Meeting's internal id `meetingId`, which is the name the domain gives to
something else; the room badge said "Host" to everyone, including a guest who
followed the link; a scheme-less CORS entry was forced to `https`, which would
have broken `localhost:3000` written without a scheme — it now infers per
entry, with a test each way; an exhausted Meeting ID raised an unhandled 500
rather than a 503; a non-join-code integrity error would have been retried ten
times and then reported as a code shortage; `render.yaml` pointed the database
at a disk path that does not exist on the free plan, so the service would have
died on `mkdir`; ADR-0002 still claimed a static frontend in its own first
paragraph; and one test asserted on settings rather than over HTTP, which is
the seam this repo keeps.

Left alone, deliberately: the navbar styles are duplicated between the dashboard
and the room. They will be unified when the dashboard ticket introduces the
chrome they share, and a shared component now would be built for two callers
and then rewritten for the third.
