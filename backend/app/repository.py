"""Data access.

Repository functions are reached only through the API — no test drives one
directly, and no caller bypasses one. That is what makes the constraints they
encode actually hold: the `left_at IS NULL` filter for "who is in this room"
is worth a rule precisely because nothing can go around it.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from .identity import new_display_name
from .models import Meeting, Participant, User


def create_user(session: Session, display_name: str | None = None) -> User:
    """A new User, with a generated Display Name when none was chosen."""
    user = User(display_name=(display_name or new_display_name()).strip()[:80])
    session.add(user)
    session.commit()
    return user


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


def get_meeting_by_join_code(session: Session, join_code: str) -> Meeting | None:
    return session.scalar(select(Meeting).where(Meeting.join_code == join_code))


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
