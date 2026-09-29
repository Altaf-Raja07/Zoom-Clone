# 01: Project spine and first-run guest identity

**What to build:** A runnable Next.js + FastAPI + SQLite application in which
opening the app for the first time mints a guest User from a signed cookie and
the dashboard shows that guest's Display Name. This is the prefactor ticket: it
exists to establish the verification seam every later ticket depends on, and it
delivers a thin but genuinely working end-to-end path.

The architecture decisions it encodes, from the ADRs: FastAPI + SQLAlchemy over
Django, because the assignment states the schema will be evaluated; guest
identity with no password and no login step; CSS Modules with a three-layer
token system (primitives, semantic, component styles) and no raw colour values
in components; CORS configured once from a single env-var origin allowlist with
cookie attributes pinned in one place.

The Meeting model is created here but not yet populated — the Meeting's two
identifiers and the Instant/Scheduled distinction are exercised by tickets 02
and 04, so this ticket only establishes the users table and the harness.

**Blocked by:** None (can start immediately).

- [x] A first-time visitor is assigned a User row and a Display Name without any signup or login form
- [x] A returning visitor is recognised from their cookie and keeps the same Display Name
- [x] The users table is created by migrations, and the schema is the one described in ADR-0004
- [x] Design tokens exist in three layers, and no component references a raw palette token or a hardcoded colour value
- [x] A pytest harness runs against the FastAPI application over HTTP, so every later ticket can be verified at the API seam
- [x] Repository functions are reached only through the API — no test drives a data-access function directly
- [x] Cookie attributes and CORS origins are each configured in exactly one place
- [x] The application starts against a single SQLite file on disk

**Status:** done

## Not built here

The Meeting model exists but is never populated — the two identifiers and the
Instant/Scheduled distinction are ticket 02 and ticket 04's to exercise. There
is no seed data yet (ticket 05). A `MEETLY_SEED_DEMO_DATA` setting was written
and then removed rather than left read-but-unused; it arrives with the seed
that gives it meaning.

## What was built

- `backend/app/models.py` — the three tables of ADR-0004, with the constraints
  that carry the design: separate `join_code`, nullable `scheduled_start_at`
  instead of a `kind` discriminator, no `role` column, soft-deleted
  `participants.left_at`, nullable `meetings.started_at`.
- `backend/migrations/` — the initial Alembic revision. `test_schema.py` asserts
  the migrated database, not the ORM metadata, so a drift between the two fails.
- `backend/app/identity.py` — the signed cookie. Cookie attributes live here and
  nowhere else.
- `backend/app/deps.py` — `current_user`, the single definition of "who is
  calling", which mints on a first visit and tolerates a forged or orphaned
  cookie.
- `backend/app/repository.py` — data access, reached only through the API.
  `list_present_participants` is the only place the `left_at IS NULL` filter
  appears, which is the constraint later tickets rely on.
- `frontend/src/styles/` — primitives, then semantics, then CSS Modules.
  `npm run lint:tokens` fails the build if a component names a raw palette
  token or hardcodes a colour.
- `scripts/dev-backend.sh`, `scripts/dev-frontend.sh` — one way to start each
  half, shared by a developer and by the browser tests so they cannot drift.

## Two decisions worth flagging for later tickets

- **The cookie's `SameSite` is coupled to `Secure`.** A browser rejects a
  `SameSite=None` cookie that is not also `Secure`, and drops it without
  complaint — which looks exactly like identity being broken. Deployed, that is
  `None; Secure`. Local development serves both halves over plain http on the
  same site, so it is `Lax`. This was found by running the browser tests, not by
  reading the code.
- **`cookies_are_secure` is derived from the CORS allowlist**, not from a
  separate flag: an allowlist of nothing but localhost origins means local
  development, and therefore no `Secure`. There is still no second place to
  configure it.

## Not built here

The Meeting model exists but is never populated — the two identifiers and the
Instant/Scheduled distinction are ticket 02 and ticket 04's to exercise. There
is no seed data yet (ticket 05). `MEETLY_SEED_DEMO_DATA` is read but not yet
acted on, and is removed rather than left dead when the seed lands.
