"""Test harness for the FastAPI application.

Every test reaches the application over HTTP against a real SQLite database,
which is the seam agreed in SPEC.md. Nothing below that seam is tested
directly, so repository functions are only ever exercised through the API.

A session stands in for a browser: it keeps cookies between requests, the way
a real browser does, so a "returning visitor" is simply the same session
making a second request.
"""

import sqlite3
from datetime import UTC, datetime
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from fastapi.testclient import TestClient

ALEMBIC_INI = Path(__file__).resolve().parent.parent / "alembic.ini"

# Imported at module scope so the process-wide settings and engine can be reset
# between tests without each test reaching into `app` itself.
from app.config import COOKIE_NAME, reset_settings  # noqa: E402
from app.db import get_engine, reset_engine  # noqa: E402
from app.join_codes import generate_join_code  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import session_factory_for  # noqa: E402
from app.repository import get_meeting_by_join_code  # noqa: E402
from app.seed import seed  # noqa: E402


def migrate_to_head() -> None:
    """Apply the migrations to whatever database the environment points at.

    The application's own schema path, so no test is running against tables
    built by anything other than the migrations a deployment would run.
    """
    command.upgrade(Config(str(ALEMBIC_INI)), "head")


class Session:
    """A browser-like HTTP session that keeps cookies between requests."""

    def __init__(self, app) -> None:
        self._client = TestClient(app)
        self._client.__enter__()

    def get(self, url: str):
        return self._client.get(url)

    def post(self, url: str, **kwargs):
        return self._client.post(url, **kwargs)

    def patch(self, url: str, **kwargs):
        return self._client.patch(url, **kwargs)

    def set_cookie(self, name: str, value: str) -> None:
        """Plant a cookie, as a browser would when the server sets one."""
        self._client.cookies.set(name, value)

    def close(self) -> None:
        self._client.__exit__(None, None, None)

    def __enter__(self) -> "Session":
        return self

    def __exit__(self, *exc_info) -> None:
        self.close()


class Cast:
    """Several people in one browser, switchable at will.

    **One `TestClient` holding several identities, rather than several clients
    holding one each, and the reason is the event loop.** Every `TestClient` runs
    its own portal, so a broadcast delivered from one client's socket to
    another's crosses event loops. Through Starlette's in-memory WebSocket
    streams the *first* such delivery works and a later one can stall the reader
    with no error and no exception — a test that hangs rather than fails, with
    nothing pointing at the cause.

    Production is one process with one loop holding many sockets, so a single
    client is *closer* to the real thing rather than further from it: one loop,
    one hub, several connections, exactly as deployed (ADR-0002 is what makes one
    loop a requirement rather than a convenience).

    Two identities are two signed cookies, so "acting as somebody" is a cookie
    swap. Every cookie is minted by the API itself through a normal request, and
    none is signed here — so this harness cannot drift into a way of *forging* an
    identity, which is the one shortcut a multi-person harness must not have.
    """

    def __init__(self, app, names: list[str]) -> None:
        self._client = TestClient(app)
        self._client.__enter__()
        self._cookies: dict[str, str] = {}
        self._sockets: list = []

        for name in names:
            # A cleared jar makes the next request a first visit, which is how a
            # second person in one browser comes into being. One request per
            # person: the cookie is the whole of the identity, so there is
            # nothing to fetch afterwards.
            self._client.cookies.clear()
            self._client.patch("/api/session", json={"display_name": name})
            cookie = self._client.cookies.get(COOKIE_NAME)
            assert cookie, f"the API did not set an identity cookie for {name}"
            self._cookies[name] = cookie

        self.current = names[0]
        self._activate()

    def _activate(self) -> None:
        self._client.cookies.clear()
        self._client.cookies.set(COOKIE_NAME, self._cookies[self.current])

    def as_(self, name: str) -> "Cast":
        """Act as somebody else from the next request onwards.

        Returns `self` so a call can be prefixed onto a chain, and so that a test
        line reads as "Priya does this" rather than as two statements.
        """
        self.current = name
        self._activate()
        return self

    def get(self, url: str):
        return self._client.get(url)

    def post(self, url: str, **kwargs):
        return self._client.post(url, **kwargs)

    def websocket(self, url: str):
        """A socket for whoever is currently active, entered and tracked.

        Identity is bound when the socket is admitted, so this is a snapshot of
        `current` at the moment of connecting — switching afterwards does not
        change who an open socket belongs to, exactly as in a browser.

        Entered here rather than left to the caller, because a socket that is
        opened but never closed keeps its server-side handler alive, and
        `TestClient.__exit__` joins the portal thread that handler is running on.
        So an unclosed socket does not fail the test that leaked it — it *hangs*
        the run, with the stack pointing at thread cleanup and nothing at all
        pointing at the socket. Tracking them here means closing the `Cast` is
        always enough, and a test cannot accidentally leave one behind.
        """
        session = self._client.websocket_connect(url)
        session.__enter__()
        self._sockets.append(session)
        return session

    def forget(self, session) -> None:
        """Drop a socket the caller has already closed, so `close` skips it.

        A test that closes a socket to make a *departure happen at that moment*
        would otherwise have it closed a second time by the harness, which is
        harmless here but reads as two departures and hides which one a test was
        actually about.
        """
        if session in self._sockets:
            self._sockets.remove(session)

    def close(self) -> None:
        for session in self._sockets:
            session.__exit__(None, None, None)
        self._sockets.clear()
        self._client.__exit__(None, None, None)

    def __enter__(self) -> "Cast":
        return self

    def __exit__(self, *exc_info) -> None:
        self.close()


@pytest.fixture()
def app_factory(database_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Builds the real application, with the ability to plant a join-code source.

    Uniqueness of the Meeting ID is a promise about generated values, so proving
    it needs a generator that collides on purpose — and that is a fact about the
    world the application runs in, not a fact about how it is put together. So
    the seam is the application builder, not the repository: a test can choose
    which codes are drawn, and still has to go through HTTP to see the result.
    """

    def build(join_code_source=generate_join_code) -> FastAPI:
        monkeypatch.setenv("MEETLY_DATABASE_PATH", str(database_path))
        monkeypatch.setenv("MEETLY_COOKIE_SECRET", "test-secret-not-a-real-one")
        monkeypatch.setenv("MEETLY_CORS_ORIGINS", "http://localhost:3000")

        reset_settings()
        reset_engine()
        migrate_to_head()
        return create_app(join_code_source=join_code_source)

    yield build
    reset_engine()
    reset_settings()


@pytest.fixture()
def app(app_factory):
    """The real application, against a temporary database file migrated for real.

    Migrations rather than `create_all`, so every test runs against the same
    schema a deployment would get. A test harness that quietly built the tables
    from the ORM would pass even if the migrations were wrong.
    """
    return app_factory()


@pytest.fixture()
def client(app):
    """A first-time visitor, who becomes a returning one on the next request."""
    session = Session(app)
    yield session
    session.close()


@pytest.fixture()
def another_visitor(app):
    """A second, independent visitor — a separate browser, not a separate test DB."""
    session = Session(app)
    yield session
    session.close()


@pytest.fixture()
def end_meeting(app):
    """Stamp a Meeting as ended, for a fixture that needs a world the API cannot
    yet produce.

    Ending a Meeting is its own ticket, so there is no endpoint for it and no
    seam-true way to reach this state over HTTP. This reaches below the API to
    *arrange* it — the assertions that follow are still HTTP responses, which is
    the part that would be worth nothing if it were faked.

    The session is opened here rather than through a helper on `app.db`, because
    the application has exactly one way to reach the database — a request — and a
    second door for tests only is a door the application no longer needs.
    """

    def end(join_code: str) -> None:
        with session_factory_for(get_engine())() as session:
            meeting = get_meeting_by_join_code(session, join_code)
            assert meeting is not None, "end_meeting was given a code that matches nothing"
            meeting.ended_at = datetime.now(UTC)
            session.commit()

    return end


@pytest.fixture()
def seeded(app):
    """An application whose database has been through the first-run seed.

    Reached through the seed's own entry point rather than by arranging rows,
    because "seeding is idempotent" is a claim about that code path and a test
    that built the rows itself would be asserting against its own fixture.
    """
    with session_factory_for(get_engine())() as session:
        seed(session)
    return app


@pytest.fixture()
def count_rows():
    """How many rows of each table a database holds.

    Counting rows directly rather than inferring counts from HTTP responses,
    because "seeding twice does not duplicate anything" is a claim about every
    table at once — including the two with no endpoint — and a dashboard that
    happened to deduplicate on the way out would hide a seed that had doubled.
    """

    def count(database_path: Path) -> dict[str, int]:
        with sqlite3.connect(database_path) as connection:
            return {
                table: connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                for table in ("users", "meetings", "participants")
            }

    return count


@pytest.fixture()
def database_path(tmp_path: Path) -> Path:
    """A throwaway SQLite file, so a test never sees another test's rows."""
    return tmp_path / "meetly-test.sqlite3"
