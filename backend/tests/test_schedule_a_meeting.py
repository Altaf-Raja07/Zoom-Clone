"""Scheduling a Meeting, at the API seam.

A Scheduled Meeting and an Instant Meeting are the same row, told apart by the
presence of a start time — so the interesting claims here are not "a row was
written" but "the absence is what marks the Instant case" and "the start time is
a gate, not a label". Neither is visible from inside the database, so every
assertion below is an HTTP response.

The gate is asserted from both sides — refused before the start time, admitted
once it has passed — because a rule that only ever refuses is indistinguishable
from a Meeting that is simply broken until someone waits for one to open.
"""

from datetime import UTC, datetime, timedelta

from .conftest import Session

# Written once here and asserted against, so a wording change has to be a
# deliberate edit in the test as well as in the endpoint.
NOT_STARTED = "That meeting has not started yet. Try again when it is time to join."


def at(offset: timedelta) -> str:
    """An absolute instant, as the browser sends it: an offset and all."""
    return (datetime.now(UTC) + offset).isoformat()


def schedule(client: Session, **overrides):
    """A Scheduled Meeting, with only the fields the test cares about."""
    body = {
        "title": "Standup",
        "description": "What did you do yesterday?",
        "scheduled_start_at": at(timedelta(hours=2)),
        "duration_minutes": 30,
    }
    return client.post("/api/meetings/scheduled", json=body | overrides)


def test_a_meeting_is_scheduled_with_a_title_description_date_time_and_duration(
    client: Session,
):
    response = schedule(client)

    assert response.status_code == 201
    body = response.json()
    assert body["title"] == "Standup"
    assert body["description"] == "What did you do yesterday?"
    assert body["duration_minutes"] == 30
    assert body["scheduled_start_at"] is not None


def test_a_scheduled_meeting_stores_the_start_time_it_was_given(client: Session):
    """The start time the host picked is the one the gate is later read from."""
    chosen = "2026-10-01T09:00:00+00:00"

    body = schedule(client, scheduled_start_at=chosen).json()

    assert datetime.fromisoformat(body["scheduled_start_at"]) == datetime.fromisoformat(
        chosen
    )


def test_a_scheduled_meeting_is_told_apart_from_an_instant_one_by_that_absence(
    client: Session,
):
    """Instant means absent data, not a discriminator column (ADR-0004).

    Both responses are compared together on purpose. A `kind` field would make
    each assertion pass on its own while the two could still disagree about
    which one is which; the null cannot.
    """
    scheduled = schedule(client).json()
    instant = client.post("/api/meetings").json()

    assert scheduled["scheduled_start_at"] is not None
    assert instant["scheduled_start_at"] is None
    # Everything else about the two is the same shape, which is the point.
    assert instant["duration_minutes"] is None
    assert scheduled["is_host"] is instant["is_host"] is True


def test_a_scheduled_meeting_receives_an_invite_link_before_it_begins(
    client: Session,
):
    """The link is handed out at scheduling time, not when the Meeting starts.

    Nobody has joined and nothing has begun — a scheduled Meeting that could not
    be shared until its moment arrived would be a calendar entry, and the whole
    claim of this ticket is that it is an action.
    """
    body = schedule(client).json()

    assert body["invite_path"] == f"/join/{body['join_code']}"
    assert body["started_at"] is None


def test_the_host_can_read_their_own_invite_link_before_the_start_time(
    client: Session,
):
    """The room door stays open, because it is how the link is read.

    The gate belongs on the door that *admits*. Refusing the room address would
    leave a host unable to open the Meeting they just made and copy its link,
    and it would close a hole that does not exist: the Invite Link carries the
    Meeting ID, not the internal id this route is addressed by.
    """
    created = schedule(client).json()

    response = client.get(f"/api/meetings/{created['id']}")

    assert response.status_code == 200
    assert response.json()["invite_path"] == created["invite_path"]


def test_a_scheduled_meeting_cannot_be_joined_before_its_start_time(
    client: Session, another_visitor: Session
):
    """The gate, from the side that refuses.

    Answered from a second visitor rather than the host, because the refusal a
    guest meets is the one the Invite Link exists for.
    """
    created = schedule(client).json()

    response = another_visitor.get(f"/api/meetings/by-code/{created['join_code']}")

    assert response.status_code == 425
    assert response.json()["detail"] == NOT_STARTED


def test_a_scheduled_meeting_can_be_joined_once_its_start_time_has_arrived(
    client: Session, another_visitor: Session
):
    """The gate, from the side that admits — the other half of the same rule.

    Scheduled a moment into the past rather than by waiting: the claim is about
    the comparison the API makes, and a test that slept for an hour would prove
    the same thing far more slowly.
    """
    created = schedule(
        client, scheduled_start_at=at(timedelta(minutes=-1))
    ).json()

    response = another_visitor.get(f"/api/meetings/by-code/{created['join_code']}")

    assert response.status_code == 200
    assert response.json()["id"] == created["id"]


def test_a_meeting_is_joinable_at_the_instant_it_starts(client: Session):
    """The direction of the boundary, which is the half an off-by-one usually gets wrong.

    A host who says "starts at nine" means nine, not nine sharp — so a Meeting
    whose start time is the very moment of the request must be admitted, and a
    gate written as "starts strictly after now" would refuse it.

    What this cannot observe is the other side of the character: the start time
    is already microseconds in the past by the time the request is answered, so
    a `<` and a `<=` are indistinguishable from out here. Pinning that would
    need a clock this seam deliberately does not have.
    """
    created = schedule(client, scheduled_start_at=at(timedelta(0))).json()

    response = client.get(f"/api/meetings/by-code/{created['join_code']}")

    assert response.status_code == 200


def test_an_instant_meeting_is_never_refused_for_being_early(client: Session):
    """The null is not "no start time known" — it is "open now".

    A gate that compared a null start time against the clock would refuse every
    Instant Meeting, and the regression here is the cheapest way to notice.
    """
    created = client.post("/api/meetings").json()

    response = client.get(f"/api/meetings/by-code/{created['join_code']}")

    assert response.status_code == 200


def test_not_yet_started_is_not_reported_as_missing_or_as_finished(
    client: Session, another_visitor: Session
):
    """Waiting, missing and finished are three different answers.

    Collapsing "not yet" into either of the others would tell someone their host
    was never there, or that the Meeting is over, at the moment before it starts.
    """
    created = schedule(client).json()

    assert (
        another_visitor.get(f"/api/meetings/by-code/{created['join_code']}").status_code
        == 425
    )
    assert (
        another_visitor.get("/api/meetings/by-code/99999999999").status_code == 404
    )


def test_the_title_and_the_description_are_optional(client: Session):
    """Neither is required, and a Meeting without them is still a Meeting.

    The two are dropped entirely rather than sent as empty strings, so this
    covers the request a browser actually makes when both fields are blank.
    """
    created = schedule(
        client,
        title=None,
        description=None,
    )

    assert created.status_code == 201
    body = created.json()
    assert body["title"] is None
    assert body["description"] is None
    # Absent words are not a reason to lose the schedule: the gate is unaffected.
    assert body["scheduled_start_at"] is not None
    assert body["duration_minutes"] == 30


def test_a_title_of_only_whitespace_is_stored_as_absence(client: Session):
    """A blank field is not a title of spaces.

    Otherwise a form the host left untouched would leave a Meeting titled "  ",
    which every later surface has to know to hide — a fact kept only in the
    presentation, and therefore each place's problem to solve.
    """
    body = schedule(client, title="   ", description="\n\t ").json()

    assert body["title"] is None
    assert body["description"] is None


def test_a_long_title_is_truncated_rather_than_refused(client: Session):
    """The column holds two hundred characters, so an over-long one is cut."""
    body = schedule(client, title="t" * 400).json()

    assert body["title"] == "t" * 200


def test_a_start_time_with_no_offset_is_refused(client: Session):
    """A local wall-clock time with nothing to anchor it is not a time.

    Time-zone selection is out of scope, so the API never guesses one: a naive
    timestamp has no single instant behind it, and storing the server's idea of
    it would put a host's nine o'clock at whatever the server's clock believed.
    The browser, which does know the viewer's zone, sends the instant instead.
    """
    response = client.post(
        "/api/meetings/scheduled",
        json={
            "scheduled_start_at": "2026-10-01T09:00:00",
            "duration_minutes": 30,
        },
    )

    assert response.status_code == 400
    assert "time zone" in response.json()["detail"]


def test_a_start_time_is_stored_as_the_instant_that_was_given(client: Session):
    """Five and a half hours is five and a half hours, whoever sent it.

    Sent as an offset rather than as a zone name, so the assertion is about the
    instant and not about a timezone database being present in the image.
    """
    body = schedule(
        client, scheduled_start_at="2026-10-01T09:00:00+05:30"
    ).json()

    stored = datetime.fromisoformat(body["scheduled_start_at"])
    assert stored == datetime(2026, 10, 1, 3, 30, tzinfo=UTC)


def test_a_start_time_in_the_past_is_stored_rather_than_refused(client: Session):
    """A start time already gone means the Meeting is open now, not invalid.

    The gate is one comparison against the clock, and it answers this case
    correctly. A second rule, refusing a past time at creation, would be the
    same fact checked twice — and the two would eventually disagree.
    """
    created = schedule(client, scheduled_start_at=at(timedelta(hours=-3)))

    assert created.status_code == 201
    assert client.get(
        f"/api/meetings/by-code/{created.json()['join_code']}"
    ).status_code == 200


def test_a_duration_must_be_a_whole_positive_number_of_minutes(client: Session):
    """Zero and negative lengths are not lengths, and a day is the ceiling.

    The upper bound is a rule the API owns rather than one the form suggests:
    the form offers 15 to 720, and a client that asked for 1441 minutes gets
    told no rather than a Meeting nobody could sit through.
    """
    for minutes in (0, -30, 24 * 60 + 1):
        response = schedule(client, duration_minutes=minutes)
        assert response.status_code == 422, minutes

    assert schedule(client, duration_minutes=24 * 60).status_code == 201


def test_whoever_schedules_the_meeting_is_its_host(client: Session):
    created = schedule(client).json()

    assert created["is_host"] is True
    assert created["host"]["id"] == client.get("/api/session").json()["id"]


def test_a_scheduled_meeting_takes_a_fresh_meeting_id_under_collision(
    app_factory,
):
    """Scheduling shares the retry the Instant path already relies on.

    A collision here would be an IntegrityError surfacing as a 500 on the button
    a host pressed to plan a meeting — so the retry is asserted for this path
    too, rather than assumed because the other one has it.
    """
    taken = "12345678901"
    offered = iter([taken, taken, "98765432109"])
    app = app_factory(join_code_source=lambda: next(offered))

    with Session(app) as instant, Session(app) as scheduler:
        first = instant.post("/api/meetings")
        second = scheduler.post(
            "/api/meetings/scheduled",
            json={"scheduled_start_at": at(timedelta(hours=1)), "duration_minutes": 30},
        )

    assert second.status_code == 201
    assert first.json()["join_code"] == taken
    assert second.json()["join_code"] == "98765432109"
