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

**Status:** ready-for-agent

- [ ] A first-time visitor is assigned a User row and a Display Name without any signup or login form
- [ ] A returning visitor is recognised from their cookie and keeps the same Display Name
- [ ] The users table is created by migrations, and the schema is the one described in ADR-0004
- [ ] Design tokens exist in three layers, and no component references a raw palette token or a hardcoded colour value
- [ ] A pytest harness runs against the FastAPI application over HTTP, so every later ticket can be verified at the API seam
- [ ] Repository functions are reached only through the API — no test drives a data-access function directly
- [ ] Cookie attributes and CORS origins are each configured in exactly one place
- [ ] The application starts against a single SQLite file on disk
