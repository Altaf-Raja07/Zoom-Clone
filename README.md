# Meetly

A Zoom-style conferencing platform. This repository is the product spec, the
architecture decisions behind it, and the implementation.

**Current state:** tickets 01 and 02. A first-time visitor opens the app, is
given a real `User` row through a signed cookie, and is greeted on the dashboard
by their Display Name. There is no signup and no login step. Clicking New
Meeting creates a Meeting and walks the host into its room, with an eleven-digit
Meeting ID grouped 3-4-4 and an Invite Link that reaches the clipboard in one
action. Joining, scheduling, the pre-join screen and the live room are not built
yet.

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
(default `backend/data/meetly.sqlite3`). Migrations run on every start, so
there is no manual step before the app serves.

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
  TURN, which works on localhost and fails in the deployed demo.
- **The backend must run as exactly one instance with exactly one worker**, once
  the in-process realtime hub exists. That is not a bug. See ADR-0002.
