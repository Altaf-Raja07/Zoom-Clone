"""Joining a Meeting, at the API seam.

Two identifiers reach the same Meeting: the Invite Link that carries the code
and the Meeting ID a person types after hearing it read aloud. Neither is the
Meeting's primary key, so this file is where the two-identifier design is either
earned or merely asserted in a comment — and the assertions are only worth
anything if they come from outside, so every claim here is an HTTP response.

The one state this ticket cannot reach through the API is an ended Meeting:
nothing stamps `ended_at` until the ticket that ends meetings. The harness
arranges that one, and says so; the assertion is still the API's.
"""

import pytest

from .conftest import Session


@pytest.fixture()
def a_meeting(client: Session) -> dict:
    """A Meeting created by one visitor, with the Invite Link it hands out."""
    return client.post("/api/meetings").json()


def lookup(session: Session, join_code: str):
    return session.get(f"/api/meetings/by-code/{join_code}")


def test_an_invite_link_resolves_to_the_meeting(client: Session, a_meeting: dict):
    """The link path: the code the Invite Link carries, bare."""
    from_invite_path = a_meeting["invite_path"].removeprefix("/join/")

    response = lookup(client, from_invite_path)

    assert response.status_code == 200
    assert response.json()["id"] == a_meeting["id"]


def test_a_typed_meeting_id_resolves_to_the_meeting(
    client: Session, a_meeting: dict
):
    """The typed path: the same code as a host reads it aloud, spaces and all.

    A person who has been told `123 456 789 01` types it with the spaces in,
    because that is how it was said to them. Rejecting that would make the
    grouped display format a trap rather than a convenience.
    """
    spoken = a_meeting["meeting_id"]

    response = lookup(client, spoken)

    assert response.status_code == 200
    assert response.json()["id"] == a_meeting["id"]


def test_both_identifiers_reach_the_same_meeting(
    client: Session, another_visitor: Session, a_meeting: dict
):
    """The point of two identifiers: neither is primary, both resolve the same.

    Compared on the Meeting's own identity, because `is_host` is the one field
    that legitimately differs between two viewers of the same Meeting — and
    comparing whole responses would have hidden that rather than caught it.
    """
    by_link = lookup(client, a_meeting["invite_path"].removeprefix("/join/")).json()
    by_typed_id = lookup(another_visitor, a_meeting["meeting_id"]).json()

    assert by_link["id"] == by_typed_id["id"] == a_meeting["id"]
    assert by_link["join_code"] == by_typed_id["join_code"]
    assert by_link["is_host"] is True
    assert by_typed_id["is_host"] is False


@pytest.mark.parametrize(
    "typed",
    ["abc", "12345", "123456789012", "123 456 7890", "1234-5678-901"],
    ids=["letters", "too-short", "too-long", "ten-digits", "hyphens"],
)
def test_a_malformed_meeting_id_is_rejected_before_any_lookup(
    client: Session, typed: str
):
    """Refused as malformed, not looked for and reported as missing.

    A 404 for `abc` would tell a person they mistyped a Meeting ID that exists;
    the truth is that there is nothing to look up, and saying so is the whole
    difference between a helpful message and a confusing one.
    """
    response = lookup(client, typed)

    assert response.status_code == 400
    assert response.json()["detail"] == (
        "That is not a Meeting ID. A Meeting ID is eleven digits, "
        "grouped like 123 456 789 01."
    )


def test_a_mistyped_code_is_refused_for_its_shape_not_for_being_unknown(
    client: Session, a_meeting: dict
):
    """A real Meeting ID with a digit missing is a typo, not a missing Meeting.

    The code here belongs to a Meeting that exists — `123` is genuinely nobody's —
    so this distinguishes a refused *shape* from a failed lookup. If validation
    ran after the lookup this would still be a 400, but the message would be the
    404's, telling a person their host's meeting had never existed.
    """
    mistyped = a_meeting["join_code"][:-1]

    response = lookup(client, mistyped)

    assert len(mistyped) != 11
    assert response.status_code == 400
    assert "not a Meeting ID" in response.json()["detail"]


def test_an_ended_meeting_cannot_be_entered_by_its_room_address_either(
    client: Session, a_meeting: dict, end_meeting
):
    """The room door refuses a finished Meeting, not just the join door.

    A reloaded room, a bookmarked address or a link copied from the URL bar all
    arrive here rather than at the join screen. Leaving this door open would make
    "has ended" true of the join route and false of the room, which is the case
    requirement 28 exists to prevent.
    """
    end_meeting(a_meeting["join_code"])

    response = client.get(f"/api/meetings/{a_meeting['id']}")

    assert response.status_code == 410
    assert response.json()["detail"] == "That meeting has already ended."


def test_an_unknown_meeting_id_says_the_meeting_does_not_exist(client: Session):
    response = lookup(client, "12345678901")

    assert response.status_code == 404
    assert response.json()["detail"] == "No meeting has that Meeting ID."


def test_an_ended_meeting_says_it_has_ended(
    client: Session, a_meeting: dict, end_meeting
):
    end_meeting(a_meeting["join_code"])

    response = lookup(client, a_meeting["join_code"])

    assert response.status_code == 410
    assert response.json()["detail"] == "That meeting has already ended."


def test_an_ended_meeting_is_not_reported_as_missing(
    client: Session, a_meeting: dict, end_meeting
):
    """Ended is a different answer from never-existed, and stays 410.

    Collapsing the two would tell someone their host was never there, which is
    the one thing that did happen.
    """
    end_meeting(a_meeting["join_code"])

    assert lookup(client, a_meeting["join_code"]).status_code == 410
    assert lookup(client, "99999999999").status_code == 404


def test_a_guest_can_join_a_meeting_they_did_not_host(
    client: Session, another_visitor: Session, a_meeting: dict
):
    """No login step, no host permission required — and no claim of hosting."""
    response = lookup(another_visitor, a_meeting["join_code"])

    assert response.status_code == 200
    body = response.json()
    assert body["is_host"] is False
    assert body["host"]["id"] == a_meeting["host"]["id"]


def test_the_joined_meeting_is_the_same_one_the_host_created(
    client: Session, another_visitor: Session, a_meeting: dict
):
    joined = lookup(another_visitor, a_meeting["join_code"]).json()

    assert joined["meeting_id"] == a_meeting["meeting_id"]
    assert joined["invite_path"] == a_meeting["invite_path"]


def test_the_display_name_is_confirmed_before_entering(client: Session):
    """The name a person will be known by is the one they chose."""
    renamed = client.patch(
        "/api/session", json={"display_name": "  Priya  "}
    )

    assert renamed.status_code == 200
    assert renamed.json()["display_name"] == "Priya"
    assert client.get("/api/session").json()["display_name"] == "Priya"


def test_a_confirmed_display_name_is_stored_on_the_person_not_the_meeting(
    another_visitor: Session,
):
    """Stored against the User, so it is the same value whoever reads it later.

    Requirement 29 asks for the name *other participants* will see, and that
    cannot be asserted here: nobody is a Participant until the ticket that builds
    the live room. What can be asserted is the half that makes it true — the name
    lives on the User row every later reader will use, rather than being passed
    along for this one navigation and lost.
    """
    another_visitor.patch("/api/session", json={"display_name": "Priya"})

    assert another_visitor.get("/api/session").json()["display_name"] == "Priya"


def test_the_display_name_survives_being_confirmed_again(
    client: Session,
):
    client.patch("/api/session", json={"display_name": "Priya"})
    client.patch("/api/session", json={"display_name": "Priya Raman"})

    assert client.get("/api/session").json()["display_name"] == "Priya Raman"


@pytest.mark.parametrize(
    "typed", ["", "   "], ids=["empty", "whitespace"]
)
def test_an_unusable_display_name_is_rejected(client: Session, typed: str):
    response = client.patch("/api/session", json={"display_name": typed})

    assert response.status_code == 400
    assert client.get("/api/session").json()["display_name"] != ""


def test_a_long_display_name_is_truncated_rather_than_refused(client: Session):
    """The column holds eighty characters, so an over-long name is cut, not lost."""
    response = client.patch("/api/session", json={"display_name": "b" * 200})

    assert response.status_code == 200
    assert response.json()["display_name"] == "b" * 80
