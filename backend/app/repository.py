"""Data access.

Repository functions are reached only through the API — no test drives one
directly, and no caller bypasses one. That is what makes the constraints they
encode actually hold: the `left_at IS NULL` filter for "who is in this room"
is worth a rule precisely because nothing can go around it.
"""

from collections.abc import Callable

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .identity import new_display_name
from .models import Meeting, Participant, User

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
    (ADR-0004).

    Uniqueness of the Meeting ID is the interesting part. The obvious version —
    generate, insert, let a unique-violation propagate — turns a birthday
    problem into a user-visible 500, and this code is generated inside a request
    where nobody is watching. So a code already in use is simply drawn again. The
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

        meeting = Meeting(join_code=join_code, host_id=host.id)
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
