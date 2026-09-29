"""Creating an Instant Meeting, at the API seam.

The Meeting ID is the Meeting's public identity: eleven digits grouped 3-4-4,
unique, and retried rather than raised on collision. Every one of those claims
is only observable from outside — the code is generated inside the request — so
this file asserts HTTP responses and nothing beneath them.

The one exception is the collision, which cannot be provoked by chance. Rather
than reach past the seam to call the generator, the application is built with a
code source that hands out a code it has already given away, and the assertion
is still the API's: the second create succeeds, and the two meetings do not
share a Meeting ID.
"""

import re

from .conftest import Session

# Zoom's own format, and the reason it is grouped: this gets read aloud.
MEETING_ID = re.compile(r"^\d{3} \d{4} \d{4}$")


def test_creating_a_meeting_returns_a_readable_meeting_id(client: Session):
    response = client.post("/api/meetings")

    assert response.status_code == 201
    body = response.json()
    assert MEETING_ID.match(body["meeting_id"]), body["meeting_id"]
    assert body["meeting_id"].replace(" ", "") == body["join_code"]


def test_a_new_meeting_is_instant(client: Session):
    """Instant means absent data, not a discriminator column (ADR-0004)."""
    body = client.post("/api/meetings").json()

    assert body["title"] is None
    assert body["scheduled_start_at"] is None
    assert body["created_at"] is not None
    assert body["started_at"] is None


def test_the_invite_link_carries_the_meeting_id(client: Session):
    body = client.post("/api/meetings").json()

    assert body["invite_path"] == f"/join/{body['join_code']}"


def test_the_caller_is_the_host(client: Session, another_visitor: Session):
    created = client.post("/api/meetings").json()

    assert created["is_host"] is True
    assert created["host"]["id"] == client.get("/api/session").json()["id"]


def test_another_visitor_does_not_host_someone_elses_meeting(
    client: Session, another_visitor: Session
):
    created = client.post("/api/meetings").json()

    assert another_visitor.get(f"/api/meetings/{created['id']}").json()["is_host"] is False


def test_two_meetings_never_share_a_meeting_id(client: Session):
    first = client.post("/api/meetings").json()
    second = client.post("/api/meetings").json()

    assert first["id"] != second["id"]
    assert first["join_code"] != second["join_code"]


def test_a_meeting_can_be_fetched_back_by_its_own_id(client: Session):
    created = client.post("/api/meetings").json()

    fetched = client.get(f"/api/meetings/{created['id']}")

    assert fetched.status_code == 200
    assert fetched.json() == created


def test_an_unknown_meeting_id_is_a_404(client: Session):
    response = client.get("/api/meetings/1e0f7a0c-0000-4000-8000-000000000000")

    assert response.status_code == 404
    assert response.json()["detail"] == "No such meeting."


def test_a_collision_is_retried_rather_than_raising(app_factory):
    """The same Meeting ID offered twice: the second create tries again."""
    already_taken = "12345678901"
    offered = iter([already_taken, already_taken, "98765432109"])

    app = app_factory(join_code_source=lambda: next(offered))
    with Session(app) as host, Session(app) as other_guest:
        first = host.post("/api/meetings")
        second = other_guest.post("/api/meetings")

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["join_code"] == already_taken
    assert second.json()["join_code"] == "98765432109"


def test_the_meeting_id_is_never_given_away_twice_under_collisions(app_factory):
    """A source that keeps colliding still yields distinct Meeting IDs."""
    offered = iter(["55555555555"] * 5 + ["66666666666", "77777777777", "88888888888"])

    app = app_factory(join_code_source=lambda: next(offered))
    with Session(app) as guest:
        codes = [guest.post("/api/meetings").json()["join_code"] for _ in range(3)]

    assert len(set(codes)) == 3
