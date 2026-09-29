"""The dashboard's two sections, at the API seam.

Every claim here is about what a person would be shown, so every assertion is an
HTTP response. The ordering in particular is not a detail: "most recently active
first" is the difference between a list a host trusts and one they have to read
carefully, and a sort key chosen for convenience rather than meaning would still
produce a list — just the wrong one.

The seeded cases are reached through the seed itself rather than by arranging
rows, because several of the interesting orders need a `created_at` and a
`started_at` that differ, and a test that wrote those by hand would be asserting
against its own fixture rather than against the application.
"""

from datetime import UTC, datetime, timedelta

from .conftest import Session


def at(offset: timedelta) -> str:
    return (datetime.now(UTC) + offset).isoformat()


def schedule(client: Session, **overrides):
    body = {
        "title": "Standup",
        "description": None,
        "scheduled_start_at": at(timedelta(hours=3)),
        "duration_minutes": 30,
    }
    return client.post("/api/meetings/scheduled", json=body | overrides)


def upcoming(client: Session) -> list[dict]:
    response = client.get("/api/dashboard/upcoming")
    assert response.status_code == 200, response.text
    return response.json()["upcoming"]


def recent(client: Session) -> list[dict]:
    response = client.get("/api/dashboard/recent")
    assert response.status_code == 200, response.text
    return response.json()["recent"]


# --- Upcoming -------------------------------------------------------------


def test_a_scheduled_meeting_appears_under_upcoming_with_its_date_and_time(
    client: Session,
):
    """The stored instant, not the text that was sent.

    Built from `at()` rather than a literal date: Upcoming filters on a start time
    in the *future*, so a hardcoded `2026-10-04` passes today and fails on the
    fifth — as a product regression, in a test nobody remembers writing.
    """
    created = schedule(client, scheduled_start_at=at(timedelta(days=2))).json()

    listed = upcoming(client)

    assert [meeting["id"] for meeting in listed] == [created["id"]]
    # The stored instant, so the browser renders the time the gate will use
    # rather than the wall-clock text the host happened to type.
    assert listed[0]["scheduled_start_at"] == created["scheduled_start_at"]


def test_upcoming_is_ordered_with_the_soonest_meeting_first(client: Session):
    later = schedule(
        client, title="Later", scheduled_start_at=at(timedelta(days=4))
    ).json()
    sooner = schedule(
        client, title="Sooner", scheduled_start_at=at(timedelta(hours=1))
    ).json()

    assert [meeting["id"] for meeting in upcoming(client)] == [sooner["id"], later["id"]]


def test_an_instant_meeting_is_not_upcoming_because_it_has_no_start_time(
    client: Session,
):
    """It cannot be "coming" — it is here now, and Recent is where it belongs."""
    client.post("/api/meetings")

    assert upcoming(client) == []


def test_a_meeting_whose_time_has_already_passed_is_no_longer_upcoming(client: Session):
    """Past the start time the gate is open, so the door is elsewhere, not here.

    Whether anyone has actually joined it is a separate question, and one the
    room answers — not a reason to keep a Meeting in Upcoming for ever.
    """
    schedule(client, scheduled_start_at=at(timedelta(hours=-1)))

    assert upcoming(client) == []


def test_upcoming_shows_only_meetings_the_viewer_hosts(
    client: Session, another_visitor: Session
):
    """A stranger's booking is not on this dashboard.

    Upcoming and Recent answer one question — "what of mine?" — and a list that
    showed every Meeting in the app would put a stranger's private booking on a
    first-run dashboard, which is worse than an empty one.
    """
    theirs = schedule(another_visitor).json()

    assert upcoming(client) == []
    assert [meeting["id"] for meeting in upcoming(another_visitor)] == [theirs["id"]]


# --- Recent ---------------------------------------------------------------


def test_a_freshly_created_instant_meeting_is_the_most_recent(client: Session):
    """The list reflects what the host just did, without a refresh or a page.

    Ordering by the *scheduled* start time would put an Instant Meeting nowhere
    at all — the column is null for every one of them, which is precisely the
    case a host makes most often.
    """
    first = client.post("/api/meetings").json()
    second = client.post("/api/meetings").json()

    assert [meeting["id"] for meeting in recent(client)][0] == second["id"]
    assert first["id"] in [meeting["id"] for meeting in recent(client)]


def test_recent_lists_only_meetings_the_viewer_hosted(client: Session, another_visitor: Session):
    """Hosted only — the hosted-or-attended union was rejected (ADR-0004).

    A Meeting somebody else hosted is not on this list even when this viewer was
    in the room, because the list answers "what did I run", and a second meaning
    would make every row ambiguous about why it is there.
    """
    theirs = schedule(another_visitor).json()

    assert [meeting["id"] for meeting in recent(client)] == []
    assert theirs["id"] in [meeting["id"] for meeting in recent(another_visitor)]


def test_recent_is_empty_when_the_viewer_has_hosted_nothing(client: Session):
    """Story 12: an empty list is the answer, not a gap to be filled.

    A blank section reads as a bug, so the *frontend* owes this an empty state.
    Backfilling rows here would make the dashboard look designed and the product
    dishonest — invented history is a claim about what somebody did.
    """
    assert recent(client) == []


def test_a_meeting_that_never_started_is_still_listed_as_recent(client: Session):
    """The overdue-and-never-begun case, from the listing side.

    It is not in Upcoming — its time has passed — and Recent does not exclude it
    either, because "has anybody started this?" is a question about *running* a
    Meeting and Recent is a question about *owning* one. Filtering on
    `started_at` here would be the same fact checked twice: a host who booked a
    Meeting, nobody turned up, and the Meeting then vanished from both sections
    of their own dashboard.
    """
    overdue = schedule(client, scheduled_start_at=at(timedelta(days=-1))).json()

    assert upcoming(client) == []
    assert [meeting["id"] for meeting in recent(client)] == [overdue["id"]]
    assert recent(client)[0]["started_at"] is None


def test_recent_is_not_filtered_by_the_start_time_in_either_direction(
    client: Session,
):
    """Every Meeting the viewer hosted is here, in recency order, whatever it is.

    One filter — `host_id` — and one ordering. A second filter on
    `scheduled_start_at` would make the list answer a question the section does
    not ask, and would put the two sections out of step: a Meeting can be in
    Upcoming *and* Recent, which is not a contradiction but two answers to two
    questions — what is coming, and what is mine.
    """
    tomorrow = schedule(client, scheduled_start_at=at(timedelta(days=1))).json()
    yesterday = schedule(client, scheduled_start_at=at(timedelta(days=-1))).json()

    assert {meeting["id"] for meeting in recent(client)} == {
        tomorrow["id"],
        yesterday["id"],
    }


# --- Recent ordering, including the case that will otherwise be "fixed" ----


def test_recent_is_ordered_by_the_later_of_created_at_and_started_at(seeded):
    """Recency of *activity*, newest first.

    Checked against the value the section claims to sort by, recomputed here from
    the two timestamps the API returns — so the assertion is about the promise
    rather than about matching one hard-coded list.

    The seeded completed Meeting is the one row that pins the `started_at` branch:
    it started a minute after it was created, and it is two days old, so it must
    sort *below* the three seeded bookings created today. Ordering by
    `created_at` alone would put those three first anyway and pass — so what is
    asserted is the property that separates them: the timestamp each row is sorted
    on is never earlier than its own creation, and the list is non-increasing in
    that value.
    """
    demo = Session(seeded).get("/api/dashboard/demo").json()["recent"]

    def recency(meeting: dict) -> datetime:
        created_at = datetime.fromisoformat(meeting["created_at"])
        if not meeting["started_at"]:
            return created_at
        return max(created_at, datetime.fromisoformat(meeting["started_at"]))

    recencies = [recency(meeting) for meeting in demo]

    assert len(demo) >= 2, "the seed must leave more than one Meeting to order"
    assert recencies == sorted(recencies, reverse=True)
    assert any(meeting["started_at"] for meeting in demo), (
        "the branch that reads started_at needs a Meeting that really started"
    )


def test_a_scheduled_meeting_nobody_started_sorts_by_when_it_was_created(
    seeded, client: Session
):
    """The regression, named so it is not later mistaken for a bug.

    A Scheduled Meeting whose start time has passed but which nobody joined has a
    null `started_at` — so it sorts by `created_at` and can fall *below* a fresh
    Instant Meeting. That is correct: nobody started it. The tempting "fix" is to
    sort by the start time, which would then rank a Meeting that never happened
    above one that did.
    """
    overdue = schedule(
        client, scheduled_start_at=at(timedelta(minutes=-1))
    ).json()
    fresh = client.post("/api/meetings").json()

    listed = [meeting["id"] for meeting in recent(client)]

    assert listed[0] == fresh["id"]
    assert overdue["id"] in listed


def test_the_three_seeded_meetings_that_share_one_timestamp_come_back_in_one_order(
    seeded,
):
    """The tie-break, on a tie that actually exists.

    The seed writes its Scheduled Meetings in a single pass, so all three carry
    the same `created_at` and none has a `started_at` — a genuine three-way tie in
    the recency ordering, and the only way to reach one from outside the
    database: two Meetings created by two HTTP requests differ by microseconds
    and never tie.

    Without an `id` tie-break the order of a tie is whatever the query does not
    specify. In practice SQLite is stable, which is what makes this worth
    asserting: the guarantee comes from the ORDER BY and not from the engine, and
    would change under a different one.
    """
    demo = Session(seeded).get("/api/dashboard/demo").json()["recent"]

    tied = [meeting for meeting in demo if not meeting["started_at"]]

    assert len(tied) >= 3
    assert [meeting["id"] for meeting in tied] == sorted(
        meeting["id"] for meeting in tied
    )
