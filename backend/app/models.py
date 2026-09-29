"""The database engine and session factory, plus the schema in ADR-0004.

Three tables, and every fact stored exactly once:

- `users` — a person who owns meetings. No password, no login.
- `meetings` — a scheduled or in-progress gathering. A UUID surrogate key for
  storage identity, and a separate unique `join_code` grouped 3-4-4 for the
  public identity that the invite link carries. A null `scheduled_start_at`
  marks an Instant Meeting, so there is deliberately no `kind` discriminator.
- `participants` — soft-deleted attendance. Leaving stamps `left_at` rather
  than deleting the row, so "who is in this room" is a *query* and the
  `left_at IS NULL` filter lives in exactly one repository function.
"""

import uuid
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    TypeDecorator,
    UniqueConstraint,
    create_engine,
    event,
)
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker


class UtcDateTime(TypeDecorator):
    """A timestamp that reads back as UTC, whatever the database kept.

    SQLite has no timezone, so a value written as `2026-09-29 18:00+00` comes
    back naive. Left alone that reaches the browser as `2026-09-29T18:00`, and
    `new Date(...)` then reads it as *local* time — a timestamp silently shifted
    by the viewer's offset, on a page whose whole job is telling people when a
    meeting is. Every column here is UTC by definition, so the type reattaches
    the offset on the way out rather than leaving each call site to remember.
    """

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        return value

    def process_result_value(self, value, dialect):
        if value is not None and value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value


class Base(DeclarativeBase):
    pass


def _utcnow() -> datetime:
    return datetime.now(UTC)


class User(Base):
    """A person, created on first visit. There is no password column."""

    __tablename__ = "users"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    display_name: Mapped[str] = mapped_column(String(80), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        UtcDateTime, nullable=False, default=_utcnow
    )


class Meeting(Base):
    """A scheduled or in-progress gathering.

    `started_at` is null until the first participant joins, which is the honest
    test for whether a meeting has actually begun.
    """

    __tablename__ = "meetings"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    join_code: Mapped[str] = mapped_column(String(16), nullable=False, unique=True)
    host_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False, index=True
    )
    title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    description: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    # Null scheduled_start_at means an Instant Meeting — the distinction is
    # carried by the null itself, so no `kind` column duplicates it.
    scheduled_start_at: Mapped[datetime | None] = mapped_column(
        UtcDateTime, nullable=True
    )
    duration_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(
        UtcDateTime, nullable=True
    )
    ended_at: Mapped[datetime | None] = mapped_column(
        UtcDateTime, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        UtcDateTime, nullable=False, default=_utcnow
    )


class Participant(Base):
    """Attendance, soft-deleted: leaving stamps `left_at` and keeps the row.

    There is no `role` column. "Is this user the host?" is `meetings.host_id` —
    one source of truth, which a stale role column could disagree with.
    """

    __tablename__ = "participants"
    __table_args__ = (
        UniqueConstraint("meeting_id", "user_id", name="uq_participant_per_meeting"),
        Index("ix_participants_meeting_present", "meeting_id", "left_at"),
    )

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    meeting_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("meetings.id"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False, index=True
    )
    joined_at: Mapped[datetime] = mapped_column(
        UtcDateTime, nullable=False, default=_utcnow
    )
    left_at: Mapped[datetime | None] = mapped_column(
        UtcDateTime, nullable=True
    )
    is_muted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_video_on: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


def create_engine_for(database_path) -> Engine:
    """An engine for one SQLite file on disk, with foreign keys enforced.

    SQLite ignores foreign keys unless asked, so a connection-time hook turns
    them on; without it the schema's relationships would be decoration.
    """
    database_path = str(database_path)
    connect_args = {"check_same_thread": False}
    # SQLite will not create the directory it lives in, and a first run on a
    # fresh checkout should not need a manual `mkdir`.
    Path(database_path).parent.mkdir(parents=True, exist_ok=True)

    engine = create_engine(f"sqlite:///{database_path}", connect_args=connect_args)

    @event.listens_for(engine, "connect")
    def _enable_foreign_keys(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    return engine


def session_factory_for(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
