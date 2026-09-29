"""A predictable cookie secret is refused before it can serve a real origin.

Not a style rule: the cookie carries a user id, and a signing key that is
public knowledge lets anyone mint a cookie naming any user. That is
impersonation with no login step to bypass, so it is worth failing loudly at
startup rather than discovering in a demo.

Reached by building the application with the environment a deployment would
have, which is the same boundary a misconfigured deploy fails at.
"""

import os

import pytest
from fastapi.testclient import TestClient

from .conftest import create_app, migrate_to_head

DEPLOYED_ORIGIN = "https://meetly.example.com"
PLACEHOLDER_SECRET = "insecure-dev-secret"


def application_serving(cookie_secret: str, origins: str, database_path):
    """The application as it would start with this environment."""
    from app.config import reset_settings
    from app.db import reset_engine

    os.environ["MEETLY_DATABASE_PATH"] = str(database_path)
    os.environ["MEETLY_COOKIE_SECRET"] = cookie_secret
    os.environ["MEETLY_CORS_ORIGINS"] = origins

    # Settings and the engine are process-wide, so each application here needs
    # its own.
    reset_engine()
    reset_settings()
    migrate_to_head()
    return create_app()


@pytest.fixture(autouse=True)
def restore_environment():
    """These tests write the environment directly rather than going through the
    `app` fixture, so they put back both the environment and the process-wide
    settings and engine — otherwise a cookie secret leaks into the next test
    and a stale engine points at a deleted file."""
    from app.config import reset_settings
    from app.db import reset_engine

    before = dict(os.environ)
    yield
    os.environ.clear()
    os.environ.update(before)
    reset_engine()
    reset_settings()


def test_the_placeholder_secret_is_refused_for_a_deployed_origin(
    database_path, tmp_path
):
    with pytest.raises(RuntimeError, match="MEETLY_COOKIE_SECRET"):
        application_serving(PLACEHOLDER_SECRET, DEPLOYED_ORIGIN, database_path)


def test_a_real_secret_is_accepted_for_a_deployed_origin(database_path, tmp_path):
    app = application_serving("a-real-private-value", DEPLOYED_ORIGIN, tmp_path / "a")

    assert TestClient(app).get("/api/health").status_code == 200


def test_the_placeholder_secret_is_accepted_for_local_development(
    database_path, tmp_path
):
    app = application_serving(
        PLACEHOLDER_SECRET, "http://localhost:3000", tmp_path / "b"
    )

    assert TestClient(app).get("/api/health").status_code == 200


def test_a_bare_hostname_in_the_allowlist_is_read_as_an_https_origin(database_path, tmp_path):
    """A host with no scheme, which is what a deploy platform hands you.

    Refusing to guess here would not fail at deploy time; it would fail as every
    request from the real frontend being quietly turned away by CORS, which
    looks exactly like identity being broken.
    """
    app = application_serving("a-real-private-value", "meetly-web.onrender.com", tmp_path / "c")

    from app.config import get_settings

    assert get_settings().cors_origins == ["https://meetly-web.onrender.com"]

    with TestClient(app) as client:
        preflight = client.options(
            "/api/session",
            headers={
                "Origin": "https://meetly-web.onrender.com",
                "Access-Control-Request-Method": "GET",
            },
        )

    assert preflight.headers["access-control-allow-origin"] == (
        "https://meetly-web.onrender.com"
    )
