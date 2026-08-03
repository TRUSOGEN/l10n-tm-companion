"""Database engine, session factory and base class."""

from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from ..config import Settings, get_settings


class Base(DeclarativeBase):
    """Declarative base for all ORM models."""


_engine: Engine | None = None
_SessionLocal: sessionmaker[Session] | None = None


def init_engine(settings: Settings | None = None) -> Engine:
    """Initialize the SQLAlchemy engine from settings."""

    global _engine, _SessionLocal
    if _engine is not None:
        return _engine
    settings = settings or get_settings()
    _engine = create_engine(
        settings.database_url,
        pool_pre_ping=True,
        future=True,
    )
    _SessionLocal = sessionmaker(bind=_engine, autoflush=False, autocommit=False, future=True)
    return _engine


def get_engine() -> Engine:
    if _engine is None:
        init_engine()
    assert _engine is not None
    return _engine


@contextmanager
def session_scope() -> Iterator[Session]:
    """Context manager yielding a transactional ORM session."""

    if _SessionLocal is None:
        init_engine()
    assert _SessionLocal is not None
    session = _SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
