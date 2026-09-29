"""Guest identity, verified through the HTTP API only.

These are the identity user stories:

  1. a first-time visitor is identified automatically, with no signup or login
     form, and gets a Display Name;
  2. a returning visitor is recognised from their cookie and keeps the same
     Display Name;
  3. a forged or expired cookie gets a fresh identity rather than an error,
     because losing a cookie should cost a guest their name, not their access.
"""


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
