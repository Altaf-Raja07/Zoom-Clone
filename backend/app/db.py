"""The database engine and session factory."""

from collections.abc import Iterator

from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from .config import get_settings
from .models import create_engine_for, session_factory_for

_engine: Engine | None = None
_sessions: sessionmaker[Session] | None = None


def get_engine() -> Engine:
    """The process-wide engine, opened lazily against one SQLite file on disk."""
    global _engine, _sessions
    if _engine is None:
        _engine = create_engine_for(get_settings().database_path)
        _sessions = session_factory_for(_engine)
    return _engine


def get_session() -> Iterator[Session]:
    """One database session per request."""
    get_engine()
    assert _sessions is not None
    with _sessions() as session:
        yield session


def reset_engine() -> None:
    """Drop the cached engine — used when settings change, e.g. between tests."""
    global _engine, _sessions
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _sessions = None
