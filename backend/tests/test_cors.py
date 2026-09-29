"""CORS, as a browser sees it.

CORS is configured from a single env-var origin allowlist, and the identity
cookie depends on it: `Access-Control-Allow-Origin` must echo the requesting
origin (not `*`, which is incompatible with `Allow-Credentials`) and the
preflight must pass. Getting either wrong fails silently in the browser — the
request simply never arrives — so it is asserted here rather than trusted.
"""

import pytest
from fastapi.testclient import TestClient

ALLOWED = "http://localhost:3000"


@pytest.fixture()
def preflight(app):
    client = TestClient(app)
    client.__enter__()
    yield client
    client.__exit__(None, None, None)


def test_an_allowlisted_origin_is_allowed_to_send_credentials(preflight):
    response = preflight.options(
        "/api/session",
        headers={
            "Origin": ALLOWED,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "content-type",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == ALLOWED
    assert response.headers["access-control-allow-credentials"] == "true"


def test_an_origin_outside_the_allowlist_is_refused(preflight):
    response = preflight.options(
        "/api/session",
        headers={
            "Origin": "https://somewhere-else.example",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert "access-control-allow-origin" not in response.headers


def test_a_real_request_from_an_allowlisted_origin_carries_the_cors_header(preflight):
    response = preflight.get("/api/session", headers={"Origin": ALLOWED})

    assert response.headers["access-control-allow-origin"] == ALLOWED
