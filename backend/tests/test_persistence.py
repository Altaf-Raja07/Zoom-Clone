"""The application runs against one SQLite file on disk.

A file rather than an in-memory database, because the deployed app's whole
identity story depends on the database outliving the process: a mounted disk
holding this file is what lets a guest keep their identity across a redeploy
(user story 4, ADR-0002). A test that only ever used `:memory:` would pass
against an app that forgot to persist anything.
"""

import sqlite3

from fastapi.testclient import TestClient

from .conftest import create_app


def test_the_migrated_database_is_a_file_on_disk(app, database_path):
    """`app` is what migrates it, so requesting it is the setup."""
    assert database_path.exists()


def test_a_users_row_lands_in_that_file(app, database_path):
    with TestClient(app) as client:
        client.get("/api/session")

    with sqlite3.connect(database_path) as connection:
        user_count = connection.execute("SELECT COUNT(*) FROM users").fetchone()[0]

    assert user_count == 1


def test_identity_survives_a_restart_of_the_application(app):
    """A restart is a new application against the same file, as a redeploy is."""
    with TestClient(app) as client:
        first = client.get("/api/session").json()
        cookie = client.cookies.get("meetly_guest")

    with TestClient(create_app()) as restarted:
        restarted.cookies.set("meetly_guest", cookie)
        second = restarted.get("/api/session").json()

    assert second["id"] == first["id"]
    assert second["display_name"] == first["display_name"]
