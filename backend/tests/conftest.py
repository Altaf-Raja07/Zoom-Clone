"""Test harness for the FastAPI application.

Every test reaches the application over HTTP against a real SQLite database,
which is the seam agreed in SPEC.md. Nothing below that seam is tested
directly, so repository functions are only ever exercised through the API.

A session stands in for a browser: it keeps cookies between requests, the way
a real browser does, so a "returning visitor" is simply the same session
making a second request.
"""

from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient

ALEMBIC_INI = Path(__file__).resolve().parent.parent / "alembic.ini"

# Imported at module scope so the process-wide settings and engine can be reset
# between tests without each test reaching into `app` itself.
from app.config import reset_settings  # noqa: E402
from app.db import reset_engine  # noqa: E402
from app.main import create_app  # noqa: E402


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

    def set_cookie(self, name: str, value: str) -> None:
        """Plant a cookie, as a browser would when the server sets one."""
        self._client.cookies.set(name, value)

    def close(self) -> None:
        self._client.__exit__(None, None, None)


@pytest.fixture()
def app(database_path: Path, monkeypatch: pytest.MonkeyPatch):
    """The real application, against a temporary database file migrated for real.

    Migrations rather than `create_all`, so every test runs against the same
    schema a deployment would get. A test harness that quietly built the tables
    from the ORM would pass even if the migrations were wrong.
    """
    monkeypatch.setenv("MEETLY_DATABASE_PATH", str(database_path))
    monkeypatch.setenv("MEETLY_COOKIE_SECRET", "test-secret-not-a-real-one")
    monkeypatch.setenv("MEETLY_CORS_ORIGINS", "http://localhost:3000")

    reset_settings()
    reset_engine()
    migrate_to_head()
    yield create_app()
    reset_engine()
    reset_settings()


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
def database_path(tmp_path: Path) -> Path:
    """A throwaway SQLite file, so a test never sees another test's rows."""
    return tmp_path / "meetly-test.sqlite3"
