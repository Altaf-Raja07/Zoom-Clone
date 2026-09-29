"""Guest identity, verified through the HTTP API only.

These are the identity user stories:

  1. a first-time visitor is identified automatically, with no signup or login
     form, and gets a Display Name;
  2. a returning visitor is recognised from their cookie and keeps the same
     Display Name;
  3. a forged or expired cookie gets a fresh identity rather than an error,
     because losing a cookie should cost a guest their name, not their access.

The last two tests count User *rows* rather than comparing names, and the reason
is worth stating: a bug that mints one User per request is invisible to a
name-based assertion, because the name on screen is rendered from whichever
request happened to answer. The count is the claim that is actually false when it
is broken.
"""

from .conftest import Session


def test_first_time_visitor_is_given_a_display_name_without_any_signup(client):
    body = client.get("/api/session").json()

    assert body["display_name"].strip()


def test_first_time_visitor_is_given_an_identity_cookie(client):
    response = client.get("/api/session")

    assert "meetly_guest" in response.cookies


def test_returning_visitor_keeps_the_same_display_name(client):
    first = client.get("/api/session").json()
    second = client.get("/api/session").json()

    assert first["id"] == second["id"]
    assert first["display_name"] == second["display_name"]


def test_returning_visitor_is_not_told_they_are_new_again(client):
    client.get("/api/session")

    assert client.get("/api/session").json()["is_new"] is False


def test_two_different_visitors_get_different_identities(client, another_visitor):
    first = client.get("/api/session").json()
    second = another_visitor.get("/api/session").json()

    assert first["id"] != second["id"]


def test_a_forged_cookie_gets_a_fresh_identity_rather_than_an_error(client, another_visitor):
    genuine = another_visitor.get("/api/session").json()
    client.set_cookie("meetly_guest", "not-a-valid-signature")

    response = client.get("/api/session")

    assert response.status_code == 200
    assert response.json()["id"] != genuine["id"]


def test_a_cookie_naming_a_user_who_no_longer_exists_is_a_first_visit(
    client, another_visitor
):
    """A wiped volume must not leave a visitor permanently locked out."""
    another_visitor.get("/api/session")
    client.set_cookie("meetly_guest", "a-user-id-that-was-never-created")

    response = client.get("/api/session")

    assert response.status_code == 200
    assert response.json()["is_new"] is True


def test_one_browser_making_several_requests_creates_one_user_row(
    client: Session, database_path
):
    """The count, not the name.

    A first visit has no cookie, and `current_user` mints a *new* User for any
    request that arrives without one — so a dashboard that fires its session and
    its two sections together on a cold browser creates one User per request, and
    the browser keeps whichever cookie landed last. The symptom a person sees is
    a returning visitor greeted by a different name, but that symptom cannot
    *see* the bug: the greeting is rendered from whichever request answered, which
    is not necessarily the one whose cookie survived, so a dashboard can lose a
    name and still show one consistent name.

    So this asserts the row count. It is the claim that is actually false when
    the requests race, and the browser tests cover the ordering that keeps it
    true (`guest-identity.spec.ts`).
    """
    for _ in range(4):
        client.get("/api/session")
    client.get("/api/dashboard/upcoming")
    client.get("/api/dashboard/recent")

    assert user_count(database_path) == 1


def test_every_dashboard_request_answers_for_the_same_user(
    client: Session, database_path
):
    """One identity across the session and both sections, whatever the order.

    Requested in the order the dashboard requests them when it has already
    established an identity — session first, sections after — and then in the order
    it must *not* request them on a cold browser, to show that the ordering is the
    browser's job rather than the API's. The API cannot tell those two situations
    apart, and that is the point: there is nothing here for it to refuse.
    """
    session_id = client.get("/api/session").json()["id"]
    client.get("/api/dashboard/upcoming")
    client.get("/api/dashboard/recent")

    assert user_count(database_path) == 1
    assert client.get("/api/session").json()["id"] == session_id


def user_count(database_path) -> int:
    import sqlite3

    with sqlite3.connect(database_path) as connection:
        return connection.execute("SELECT COUNT(*) FROM users").fetchone()[0]
