"""The first-run seed, at the API seam.

The seed exists so a reviewer opening the app sees a populated dashboard rather
than an empty one, and the interesting claims are the ones about what it refuses
to write: no fake presence, no chat, and nothing that would shadow a real guest's
identity. Those are the claims with a silent failure mode, so they are asserted
against the database rather than against a screenshot.

Idempotence is asserted by running the seed twice and comparing every table's
count, rather than by checking that the counts "look right" — a seed that ran
twice and one that ran once are indistinguishable from a count alone. And because
the seed's Meetings are dated from whenever it ran, "still populated next week" is
asserted against a clock the test controls rather than against today's date.
"""

import sqlite3
import uuid
from datetime import timedelta
from pathlib import Path

from app.db import get_engine
from app.models import Meeting, session_factory_for
from app.seed import _PLANNED, _find_planned_meeting, _id_for, seed

from .conftest import Session


def demo_dashboard(client: Session) -> dict:
    """The Demo Identity's dashboard, asserted to have answered.

    A 404 here means the fixture did not seed, and a bare `["upcoming"]` on the
    response would raise a `KeyError` on the validation error instead — which
    reads as a broken test rather than as an unseeded database.
    """
    response = client.get("/api/dashboard/demo")
    assert response.status_code == 200, response.text
    return response.json()


def query(database_path: Path, sql: str) -> int:
    """One number straight from the database file.

    Deliberately not going through the API: "seeding writes no fake presence" and
    "no messages table exists" are claims about storage, and the application has
    no endpoint that could show either of them. The session and the dashboard
    *are* asserted over HTTP; this is the storage underneath them.
    """
    with sqlite3.connect(database_path) as connection:
        return connection.execute(sql).fetchone()[0]


def run_seed() -> bool:
    """The seed's own entry point, as the start script calls it."""
    with session_factory_for(get_engine())() as session:
        return seed(session)


def age_every_upcoming_meeting_past_its_start_time() -> None:
    """Make every seeded Scheduled Meeting stale, the way a week of uptime does.

    The start times are moved rather than the clock advanced, because this seam
    has no clock: `utcnow` is read by the application and asserting about it
    would mean asserting about when the test ran. What is under test is the
    *relationship* — a seeded Meeting whose start time has passed, on the next run
    of the seed — and that relationship is the same whichever end of it is real.
    """
    with session_factory_for(get_engine())() as session:
        for plan in _PLANNED:
            meeting = session.get(Meeting, _id_for(f"meeting:{plan.key}"))
            assert meeting is not None, f"the seed did not write {plan.key}"
            meeting.scheduled_start_at -= timedelta(days=plan.offset_days + 1)
        session.commit()


def test_the_seed_creates_a_demo_identity_and_some_guests(seeded):
    assert demo_dashboard(Session(seeded))["display_name"] == "Altaf Raja"


def test_the_seeded_upcoming_section_is_populated_with_scheduled_meetings(seeded):
    """Story 11: the section looks populated on a fresh database, not empty."""
    upcoming = demo_dashboard(Session(seeded))["upcoming"]

    assert len(upcoming) == len(_PLANNED)
    for meeting in upcoming:
        # A start time is what makes it Scheduled, and no `started_at` is what
        # makes it still to come (ADR-0004).
        assert meeting["scheduled_start_at"] is not None
        assert meeting["started_at"] is None


def test_the_seeded_recent_section_holds_a_meeting_that_really_happened(seeded):
    """Story 7: the schema's decisions are visible rather than merely claimed.

    A completed Meeting with genuine join and leave timestamps is the only thing
    that shows soft-deleted attendance surviving the end of a Meeting — a seeded
    Instant Meeting with no participants would prove nothing about either.
    """
    recent = demo_dashboard(Session(seeded))["recent"]

    # Identified by `started_at` rather than `ended_at`, which the dashboard does
    # not render: a Meeting with a start time and no scheduled start time is the
    # Instant Meeting that genuinely ran.
    began = [meeting for meeting in recent if meeting["started_at"]]
    assert len(began) == 1
    assert began[0]["scheduled_start_at"] is None


def test_the_completed_meeting_has_real_join_and_leave_timestamps(
    seeded, database_path
):
    """Nobody is left standing in a room from two days ago.

    Asserted with the same filter the live room uses to decide who is present,
    so the seed is held to the rule the application is: a `left_at IS NULL` row
    in a seeded database would show up in the participant panel of a meeting that
    ended before the reviewer opened the app.
    """
    assert query(
        database_path, "SELECT COUNT(*) FROM participants WHERE left_at IS NULL"
    ) == 0
    assert (
        query(
            database_path,
            "SELECT COUNT(*) FROM participants "
            "WHERE joined_at IS NOT NULL AND left_at IS NOT NULL",
        )
        >= 2
    )


def test_seeding_stores_no_chat_messages(seeded, database_path):
    """There is no messages table, and adding one to hold seeded chat would be the
    wrong fix.

    Chat is live-only by design and stated plainly in the README. Seeding it would
    mean inventing a conversation nobody had, in a table the schema deliberately
    does not have — so the claim is that the tables are exactly the three.
    """
    with sqlite3.connect(database_path) as connection:
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
            # Alembic's own bookkeeping, which is not a table the seed chose.
        } - {"alembic_version"}

    assert tables == {"users", "meetings", "participants"}


def test_running_the_seed_again_adds_no_users_meetings_or_attendance(
    seeded, count_rows, database_path
):
    """Idempotence, measured rather than assumed.

    Counts before and after, for all three tables — including `participants`,
    which has no endpoint and so would be the easiest row to duplicate without
    anything noticing.
    """
    before = count_rows(database_path)

    assert run_seed() is False

    assert count_rows(database_path) == before


def test_the_upcoming_meetings_are_still_upcoming_after_they_have_all_passed(
    seeded,
):
    """The seed's own clock does not expire.

    "Over the next few days" is measured from whenever the seed last ran, so a
    database seeded once has an empty Upcoming section five days later — and the
    deployed app re-seeds on every restart, which is what makes that reachable
    rather than theoretical. So the seeded Meetings are aged past their start
    times and the seed run again, and Upcoming must be populated once more.

    The start times are rewritten rather than the clock moved, because this seam
    deliberately has no clock: the only thing being asserted is the *relationship*
    between a stale row and the next run.
    """
    stale = Session(seeded).get("/api/dashboard/demo").json()
    assert stale["upcoming"], "the seed must start out populated"

    age_every_upcoming_meeting_past_its_start_time()

    assert Session(seeded).get("/api/dashboard/demo").json()["upcoming"] == []

    assert run_seed() is True

    demo = Session(seeded).get("/api/dashboard/demo").json()
    assert len(demo["upcoming"]) == len(_PLANNED)
    assert all(meeting["started_at"] is None for meeting in demo["upcoming"])


def test_rolling_a_stale_meeting_forward_does_not_add_a_row(
    seeded, count_rows, database_path
):
    """Repaired, not replaced.

    This is what keeps the seed safe to run on every restart: a rolled Meeting is
    an existing row given a new time, so a database that has been up for a month
    has exactly as many seeded Meetings as one seeded this morning.
    """
    age_every_upcoming_meeting_past_its_start_time()

    before = count_rows(database_path)
    assert run_seed() is True

    assert count_rows(database_path) == before


def test_a_seed_edited_since_the_database_was_seeded_does_not_duplicate_a_meeting(
    seeded, count_rows, database_path
):
    """A renamed seed must not take the app down on every start.

    The seeded ids are derived from the plan's keys, so editing a key renames a row
    that is already in the database. A seed that looked its Meetings up by id
    alone would then try to insert the same Meeting ID a second time — which is a
    `UNIQUE` violation, thrown on every start, for the life of the deployment.
    So a row already sitting under the stored Meeting ID is adopted, not
    duplicated.

    Reproduced by moving the rows to ids this version of the seed would not
    generate, which is exactly the state an edited seed finds.
    """
    before = count_rows(database_path)
    with session_factory_for(get_engine())() as session:
        for plan in _PLANNED:
            meeting = _find_planned_meeting(session, plan)
            meeting.id = str(uuid.uuid4())
        session.commit()

    # No exception is the assertion: the crash this prevents happened inside
    # `session.commit()`, so a test that merely checked the counts would pass
    # against a seed that had died.
    assert run_seed() is False

    assert count_rows(database_path) == before
    assert len(Session(seeded).get("/api/dashboard/demo").json()["upcoming"]) == len(
        _PLANNED
    )


def test_the_completed_meeting_is_never_rolled_forward(seeded, database_path):
    """A Meeting that keeps completing is a Meeting that never happened.

    Only the Scheduled Meetings age. Re-dating the completed one would leave the
    demo data with no past in it, which is the only reason it has a past.
    """
    with session_factory_for(get_engine())() as session:
        meeting = session.get(Meeting, _id_for("meeting:completed"))
        before = (meeting.started_at, meeting.ended_at)

    assert run_seed() is False

    with session_factory_for(get_engine())() as session:
        meeting = session.get(Meeting, _id_for("meeting:completed"))
        assert (meeting.started_at, meeting.ended_at) == before


def test_a_production_guest_always_gets_their_own_user_and_never_the_demo_identity(
    seeded, client: Session
):
    """The seed creates a User; it does not hand that User to anyone.

    The identity cookie is minted per visitor and names a row the seed never
    wrote, so the Demo Identity cannot shadow a real guest — the failure this
    rule prevents would be a reviewer's own Meetings quietly appearing under
    someone else's name.
    """
    demo = demo_dashboard(client)

    assert client.get("/api/session").json()["display_name"] != demo["display_name"]

    demo_meeting_ids = {meeting["id"] for meeting in demo["upcoming"] + demo["recent"]}
    mine = {
        meeting["id"]
        for meeting in (
            client.get("/api/dashboard/upcoming").json()["upcoming"]
            + client.get("/api/dashboard/recent").json()["recent"]
        )
    }

    # Compared as ids, not as counts: "empty" and "full" both pass a count check,
    # and full is exactly the case that would mean the guest had been handed the
    # Demo Identity.
    assert mine == set()
    assert not mine & demo_meeting_ids


def test_a_guest_who_creates_a_meeting_sees_only_their_own(seeded, client: Session):
    """The Demo Identity's Meetings stay on the Demo Identity's dashboard."""
    mine = client.post("/api/meetings").json()
    demo = demo_dashboard(client)

    assert [
        meeting["id"] for meeting in client.get("/api/dashboard/recent").json()["recent"]
    ] == [mine["id"]]
    assert mine["id"] not in {meeting["id"] for meeting in demo["recent"]}


def test_reading_the_demo_dashboard_does_not_change_the_viewers_identity(
    seeded, client: Session
):
    """Looking at the Demo Identity's Meetings is not becoming them.

    Read-only on purpose: if this endpoint switched the reviewer's cookie, the
    Meetings they had just created would move onto a shared identity and their own
    two sections would quietly change underneath them.
    """
    before = client.get("/api/session").json()

    client.get("/api/dashboard/demo")

    assert client.get("/api/session").json()["id"] == before["id"]


def test_the_demo_dashboard_is_absent_rather_than_empty_on_an_unseeded_database(
    client: Session,
):
    """404, because two empty lists would claim the Demo Identity has no Meetings.

    That is a statement about a User who does not exist in this database, and it
    would read on screen as "the demo data is broken" rather than "this database
    was never seeded".
    """
    response = client.get("/api/dashboard/demo")

    assert response.status_code == 404
    assert "Demo Identity" in response.json()["detail"]


def test_the_demo_dashboards_sections_answer_about_the_demo_identity(
    seeded, client: Session
):
    """`is_host` is true on the Demo Identity's own Meetings.

    Rendered with the Demo Identity as the viewer, so the copy on them is a
    host's copy — a list of somebody else's Meetings with somebody else's buttons
    would be the wrong screen.
    """
    demo = demo_dashboard(client)

    assert all(meeting["is_host"] for meeting in demo["upcoming"])
    assert all(meeting["is_host"] for meeting in demo["recent"])
