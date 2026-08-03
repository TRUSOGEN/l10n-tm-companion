"""ORM models for OAuth and async ROI.

All status fields use string enums for forward compatibility; indexes reflect
hot access paths (owner lookups, lease polling, run progress queries).
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _ensure_utc(value: dt.datetime | None) -> dt.datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=dt.timezone.utc)
    return value.astimezone(dt.timezone.utc)


class IdempotencyRecord(Base):
    """Stores canonical responses for the 30-day idempotency window."""

    __tablename__ = "idempotency_records"

    tenant_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    subject_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    method: Mapped[str] = mapped_column(String(16), primary_key=True)
    canonical_path: Mapped[str] = mapped_column(String(256), primary_key=True)
    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    payload_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    response_status: Mapped[int] = mapped_column(Integer, nullable=False)
    response_body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)

    __table_args__ = ()


class OAuthSession(Base):
    """A five-minute, one-time OAuth authorization session."""

    __tablename__ = "oauth_sessions"

    session_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_subject_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    tenant_id: Mapped[str] = mapped_column(String(64), nullable=False)
    installation_id: Mapped[str] = mapped_column(String(128), nullable=False)
    redirect_uri: Mapped[str] = mapped_column(String(256), nullable=False)
    state_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    code_challenge: Mapped[str] = mapped_column(String(128), nullable=False)
    code_challenge_method: Mapped[str] = mapped_column(String(8), nullable=False, default="S256")
    requested_scopes: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    plugin_version: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending", index=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    exchanged_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class OAuthGrant(Base):
    """Long-lived Feishu user grant bound to a company subject."""

    __tablename__ = "oauth_grants"

    grant_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_subject_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    tenant_id: Mapped[str] = mapped_column(String(64), nullable=False)
    feishu_open_id: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    feishu_user_id: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    feishu_name: Mapped[str] = mapped_column(String(256), nullable=False, default="")
    actual_scopes: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    encrypted_access_token: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    access_expires_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    encrypted_refresh_token: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    token_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active", index=True)
    refresh_attempt_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    refresh_started_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    remote_revoke_status: Mapped[str] = mapped_column(String(32), nullable=False, default="not_requested")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )

    device_sessions: Mapped[list["OAuthDeviceSession"]] = relationship(back_populates="grant")


class OAuthDeviceSession(Base):
    """Per-installation, revocable device session token (stored as hash)."""

    __tablename__ = "oauth_device_sessions"

    device_session_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    grant_id: Mapped[str] = mapped_column(String(36), ForeignKey("oauth_grants.grant_id"), nullable=False, index=True)
    owner_subject_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    tenant_id: Mapped[str] = mapped_column(String(64), nullable=False)
    installation_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    revoked_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    grant: Mapped[OAuthGrant] = relationship(back_populates="device_sessions")


class AuditEvent(Base):
    """Append-only audit log for security-sensitive actions."""

    __tablename__ = "audit_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False, index=True)
    tenant_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    subject_id_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    target_type: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    target_id: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="success")
    error_code: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    request_id: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    event_metadata: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)


class PolicySnapshot(Base):
    """Versioned snapshot of the ROI locale→vendor→rate policy."""

    __tablename__ = "policy_snapshots"

    policy_version: Mapped[str] = mapped_column(String(64), primary_key=True)
    effective_from: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    rate_catalog_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    locales_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)


class RoiRun(Base):
    """One archived or in-progress ROI computation run."""

    __tablename__ = "roi_runs"

    run_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    client_run_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    owner_subject_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    tenant_id: Mapped[str] = mapped_column(String(64), nullable=False)
    policy_version: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    source_locale: Mapped[str] = mapped_column(String(16), nullable=False)
    project_ids_json: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    projects_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False)
    display_scope_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    sheet_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    locale_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    accepted_item_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    a_state: Mapped[str] = mapped_column(String(16), nullable=False, default="queued", index=True)
    review_state: Mapped[str] = mapped_column(String(16), nullable=False, default="open", index=True)
    c_state: Mapped[str] = mapped_column(String(16), nullable=False, default="idle", index=True)
    archive_state: Mapped[str] = mapped_column(String(24), nullable=False, default="not_requested", index=True)
    started_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    sealed_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    archive_requested_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    archive_completed_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    archive_record_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    archive_snapshot_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    archive_duplicate_run_records: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    total_saving_usd: Mapped[float | None] = mapped_column(Numeric(20, 10), nullable=True)
    selected_scope_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    complete_scope_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )

    items: Mapped[list["RoiItem"]] = relationship(back_populates="run", cascade="all, delete-orphan")
    scope_results: Mapped[list["RoiScopeResult"]] = relationship(back_populates="run", cascade="all, delete-orphan")
    jobs: Mapped[list["RoiJob"]] = relationship(back_populates="run", cascade="all, delete-orphan")
    snapshot: Mapped["RoiArchiveSnapshot | None"] = relationship(back_populates="run", uselist=False)

    __table_args__ = (
        UniqueConstraint("owner_subject_id", "client_run_id", name="uq_roi_owner_client_run"),
        Index("ix_roi_runs_owner_state", "owner_subject_id", "archive_state"),
    )


class RoiItem(Base):
    """A single source/final row (one per run, not per locale)."""

    __tablename__ = "roi_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(String(36), ForeignKey("roi_runs.run_id"), nullable=False, index=True)
    item_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    source_key: Mapped[str] = mapped_column(String(256), nullable=False, default="")
    sheet_row: Mapped[int] = mapped_column(Integer, nullable=False)
    source_text_cipher: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    source_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    source_word_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    final_text_cipher: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    final_hash: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    final_word_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    confirmed_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sheet_write_receipt_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    display_final_tm_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    review_status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending", index=True)
    item_record_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    content_erased_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )

    run: Mapped[RoiRun] = relationship(back_populates="items")

    __table_args__ = (
        UniqueConstraint("run_id", "item_id", name="uq_roi_run_item"),
    )


class RoiScopeResult(Base):
    """Score/cost/result per (run, item, locale, stage=A|C)."""

    __tablename__ = "roi_scope_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(String(36), ForeignKey("roi_runs.run_id"), nullable=False, index=True)
    item_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    locale: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    stage: Mapped[str] = mapped_column(String(2), nullable=False, index=True)  # "A" or "C"
    text_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    policy_version: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    score: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    match_category: Mapped[str | None] = mapped_column(String(32), nullable=True)
    cost_usd: Mapped[float | None] = mapped_column(Numeric(20, 10), nullable=True)
    word_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="queued", index=True)
    failure_code: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    failure_reason: Mapped[str] = mapped_column(Text, nullable=False, default="")
    computed_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)

    run: Mapped[RoiRun] = relationship(back_populates="scope_results")

    __table_args__ = (
        UniqueConstraint(
            "run_id", "item_id", "locale", "stage", "text_hash", "policy_version",
            name="uq_scope_result_identity",
        ),
        Index("ix_scope_run_locale_stage", "run_id", "locale", "stage"),
    )


class RoiJob(Base):
    """Durable job queue + transactional outbox."""

    __tablename__ = "roi_jobs"

    job_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    run_id: Mapped[str] = mapped_column(String(36), ForeignKey("roi_runs.run_id"), nullable=False, index=True)
    item_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    locale: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    stage: Mapped[str] = mapped_column(String(8), nullable=False, index=True)  # A | C | archive
    text_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    policy_version: Mapped[str] = mapped_column(String(64), nullable=False)
    task_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    payload_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="queued", index=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    leased_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    fencing_token: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    leased_until: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    last_error_code: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    last_error_message: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )

    run: Mapped[RoiRun] = relationship(back_populates="jobs")

    __table_args__ = (
        UniqueConstraint(
            "run_id", "item_id", "locale", "stage", "text_hash", "policy_version", "task_type",
            name="uq_roi_job_identity",
        ),
        Index("ix_roi_jobs_poll", "status", "leased_until", "run_id"),
    )


class RoiOutboxEvent(Base):
    """Transactional outbox events for cross-system notifications."""

    __tablename__ = "roi_outbox_events"

    event_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    run_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    payload_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    published_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)


class RoiArchiveSnapshot(Base):
    """Frozen snapshot of confirmed/unconfirmed items for an archive run."""

    __tablename__ = "roi_archive_snapshots"

    snapshot_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    run_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("roi_runs.run_id"), nullable=False, unique=True, index=True
    )
    payload_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)

    run: Mapped[RoiRun] = relationship(back_populates="snapshot")


class RoiArchiveRecord(Base):
    """Per-record write bookkeeping for Runs/Scopes/Items."""

    __tablename__ = "roi_archive_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    table_name: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    logical_key: Mapped[str] = mapped_column(String(256), nullable=False, index=True)
    record_id: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    phase: Mapped[str] = mapped_column(String(24), nullable=False, default="writing", index=True)
    fencing_token: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error_code: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    last_error_message: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )

    __table_args__ = (
        UniqueConstraint("run_id", "table_name", "logical_key", name="uq_archive_record"),
    )