"""Test harness for the FastAPI application.

Every test reaches the application over HTTP against a real SQLite database,
which is the seam agreed in SPEC.md. Nothing below that seam is tested
directly, so repository functions are only ever exercised through the API.

A session stands in for a browser: it keeps cookies between requests, the way
a real browser does, so a "returning visitor" is simply the same session
making a second request.
"""

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
from app.config import reset_settings  # noqa: E402
from app.db import database_session, reset_engine  # noqa: E402
from app.join_codes import generate_join_code  # noqa: E402
from app.main import create_app  # noqa: E402
from app.repository import get_meeting_by_join_code  # noqa: E402


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
    """

    def end(join_code: str) -> None:
        with database_session() as session:
            meeting = get_meeting_by_join_code(session, join_code)
            assert meeting is not None, "end_meeting was given a code that matches nothing"
            meeting.ended_at = datetime.now(UTC)
            session.commit()

    return end


@pytest.fixture()
def database_path(tmp_path: Path) -> Path:
    """A throwaway SQLite file, so a test never sees another test's rows."""
    return tmp_path / "meetly-test.sqlite3"
