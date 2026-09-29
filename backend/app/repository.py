"""Data access.

Repository functions are reached only through the API — no test drives one
directly, and no caller bypasses one. That is what makes the constraints they
encode actually hold: the `left_at IS NULL` filter for "who is in this room"
is worth a rule precisely because nothing can go around it.
"""

from collections.abc import Callable
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .identity import new_display_name
from .models import Meeting, Participant, User, utcnow

# How many Meeting IDs to try before giving up. Eleven digits is a big space, so
# exhausting this means something is deeply wrong — an order of magnitude of
# retries still fails in a millisecond, and a create endpoint should fail rather
# than spin.
JOIN_CODE_ATTEMPTS = 10


class JoinCodeUnavailable(RuntimeError):
    """Every Meeting ID offered was already taken."""


def create_user(session: Session, display_name: str | None = None) -> User:
    """A new User, with a generated Display Name when none was chosen."""
    user = User(display_name=(display_name or new_display_name()).strip()[:80])
    session.add(user)
    session.commit()
    return user


def create_instant_meeting(
    session: Session,
    host: User,
    code_source: Callable[[], str],
) -> Meeting:
    """A Meeting with no title and no start time, and a Meeting ID nobody has.

    An Instant Meeting is defined by that absence rather than by a `kind`
    column, so there is nothing here to set — the nulls are the record
    (ADR-0004). It is otherwise the same row a Scheduled Meeting is, which is
    why the two share the one function that has to get a Meeting ID.
    """
    return _create_meeting_with_a_unique_join_code(session, host, code_source)


def create_scheduled_meeting(
    session: Session,
    host: User,
    code_source: Callable[[], str],
    *,
    scheduled_start_at: datetime,
    duration_minutes: int,
    title: str | None = None,
    description: str | None = None,
) -> Meeting:
    """A Meeting with a start time, and everything else an Instant Meeting has.

    The start time is the whole of the difference, so this is not a second kind
    of row: it is the same row with the one column that was null filled in
    (ADR-0004). Everything about the Meeting ID — the space, the collision
    retry, the exhausted case — is deliberately not repeated here, because two
    copies of the same ten-attempt loop would be two things to keep in step.

    `title` and `description` are trimmed and truncated to the width of their
    columns, matching how a Display Name is stored: a value that does not fit is
    cut to what does, rather than refused, and a field left blank is stored as
    absence so that every later surface can trust a title to be worth showing.
    """
    return _create_meeting_with_a_unique_join_code(
        session,
        host,
        code_source,
        title=_clean_optional_text(title, 200),
        description=_clean_optional_text(description, 1000),
        scheduled_start_at=scheduled_start_at,
        duration_minutes=duration_minutes,
    )


def _clean_optional_text(value: str | None, width: int) -> str | None:
    """A trimmed, column-width-bounded string — or None if there is nothing there.

    One definition of "this field was left empty", so that a blank title cannot
    be stored one way here and rendered as a title of spaces somewhere else.
    """
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed[:width] or None


def _create_meeting_with_a_unique_join_code(
    session: Session,
    host: User,
    code_source: Callable[[], str],
    **fields,
) -> Meeting:
    """A Meeting hosted by `host`, with a Meeting ID nobody else has.

    Uniqueness of the Meeting ID is the interesting part, and it is the same
    problem for every Meeting whatever its start time, which is why this is one
    function rather than one per kind. The obvious version — generate, insert,
    let a unique-violation propagate — turns a birthday problem into a
    user-visible 500, and this code is generated inside a request where nobody
    is watching. So a code already in use is simply drawn again. The
    `IntegrityError` arm is not belt-and-braces: two hosts creating at the same
    moment both pass the "is it taken?" check, and only the database can settle
    which of them wins.

    `code_source` is required rather than defaulted, so that where a Meeting ID
    comes from is a decision the caller makes and states, not a hidden fallback.
    """
    for _ in range(JOIN_CODE_ATTEMPTS):
        join_code = code_source()
        if get_meeting_by_join_code(session, join_code) is not None:
            continue

        meeting = Meeting(join_code=join_code, host_id=host.id, **fields)
        session.add(meeting)
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            # A unique violation on the join code means someone else took it
            # between the check above and this insert — try again. Any other
            # integrity error (a host that no longer exists, say) would fail
            # identically on all ten attempts, so it is raised now rather than
            # reported as "could not find a free Meeting ID".
            if get_meeting_by_join_code(session, join_code) is None:
                raise
            continue
        return meeting

    raise JoinCodeUnavailable(
        f"Could not find a free Meeting ID in {JOIN_CODE_ATTEMPTS} attempts."
    )


def get_user(session: Session, user_id: str | None) -> User | None:
    if not user_id:
        return None
    return session.get(User, user_id)


def update_display_name(session: Session, user: User, display_name: str) -> User:
    user.display_name = display_name.strip()[:80]
    session.commit()
    return user


def get_meeting(session: Session, meeting_id: str) -> Meeting | None:
    return session.get(Meeting, meeting_id)


def get_host(session: Session, meeting: Meeting) -> User | None:
    """The User who created a Meeting.

    Authority is read from the meeting rather than from a participant row,
    because there is no `role` column to disagree with it (ADR-0004).
    """
    return session.get(User, meeting.host_id)


def get_meeting_by_join_code(session: Session, join_code: str) -> Meeting | None:
    return session.scalar(select(Meeting).where(Meeting.join_code == join_code))


def has_ended(meeting: Meeting) -> bool:
    """Whether a Meeting has finished.

    Read from the Meeting's own `ended_at`, because that column is the only
    record of it — there is no `kind` or status column that could disagree
    (ADR-0004). Derived rather than stored so the answer cannot go stale.
    """
    return meeting.ended_at is not None


def has_started(meeting: Meeting) -> bool:
    """Whether a Meeting's start time has arrived.

    The other half of a Meeting's life, and the rule that makes a schedule an
    action rather than a label: a Scheduled Meeting is not open until this
    says so, and an Instant Meeting — the null start time — is open from the
    moment it exists.

    Read from `scheduled_start_at` rather than from `started_at`, deliberately.
    `started_at` is stamped when the first participant joins, which makes it
    the honest record of whether anyone *has* started it but a dishonest gate:
    a Meeting at nine o'clock with nobody in it would be locked at nine, and a
    guest arriving a minute early would be told to come back. The plan is what
    is being checked here, not the attendance.

    Derived rather than stored, so there is no second answer to keep in step
    with the first — and so "the start time has passed" is a comparison against
    the clock rather than a field that has to be written by something.
    """
    if meeting.scheduled_start_at is None:
        return True
    return meeting.scheduled_start_at <= utcnow()


def is_host(meeting: Meeting, user_id: str) -> bool:
    """Authority is derived from the meeting, never from a stored role."""
    return meeting.host_id == user_id


def list_present_participants(session: Session, meeting_id: str) -> list[Participant]:
    """Who is in this room right now.

    This is the *only* place the `left_at IS NULL` filter appears. A bare
    `WHERE meeting_id = ?` would return past attendees, which is the whole
    reason participation is soft-deleted.
    """
    return list(
        session.scalars(
            select(Participant).where(
                Participant.meeting_id == meeting_id,
                Participant.left_at.is_(None),
            )
        )
    )


def get_participation(
    session: Session, meeting_id: str, user_id: str
) -> Participant | None:
    return session.scalar(
        select(Participant).where(
            Participant.meeting_id == meeting_id,
            Participant.user_id == user_id,
        )
    )
