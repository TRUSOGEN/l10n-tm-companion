"""initial schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-07-30
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "idempotency_records",
        sa.Column("key", sa.String(length=128), nullable=False),
        sa.Column("tenant_id", sa.String(length=64), nullable=False),
        sa.Column("subject_id", sa.String(length=128), nullable=False),
        sa.Column("method", sa.String(length=16), nullable=False),
        sa.Column("canonical_path", sa.String(length=256), nullable=False),
        sa.Column("payload_hash", sa.String(length=64), nullable=False),
        sa.Column("response_status", sa.Integer(), nullable=False),
        sa.Column("response_body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("key"),
        sa.UniqueConstraint("tenant_id", "subject_id", "method", "canonical_path", "key", name="uq_idempotency_scope_key"),
    )
    op.create_index("ix_idempotency_tenant", "idempotency_records", ["tenant_id"])
    op.create_index("ix_idempotency_subject", "idempotency_records", ["subject_id"])
    op.create_index("ix_idempotency_expires", "idempotency_records", ["expires_at"])

    op.create_table(
        "oauth_sessions",
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("owner_subject_id", sa.String(length=128), nullable=False),
        sa.Column("tenant_id", sa.String(length=64), nullable=False),
        sa.Column("installation_id", sa.String(length=128), nullable=False),
        sa.Column("redirect_uri", sa.String(length=256), nullable=False),
        sa.Column("state_hash", sa.String(length=64), nullable=False),
        sa.Column("code_challenge", sa.String(length=128), nullable=False),
        sa.Column("code_challenge_method", sa.String(length=8), nullable=False, server_default="S256"),
        sa.Column("requested_scopes", sa.JSON(), nullable=False),
        sa.Column("plugin_version", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("exchanged_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("session_id"),
    )
    op.create_index("ix_oauth_sessions_owner", "oauth_sessions", ["owner_subject_id"])
    op.create_index("ix_oauth_sessions_status", "oauth_sessions", ["status"])
    op.create_index("ix_oauth_sessions_expires", "oauth_sessions", ["expires_at"])

    op.create_table(
        "oauth_grants",
        sa.Column("grant_id", sa.String(length=36), nullable=False),
        sa.Column("owner_subject_id", sa.String(length=128), nullable=False),
        sa.Column("tenant_id", sa.String(length=64), nullable=False),
        sa.Column("feishu_open_id", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("feishu_user_id", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("feishu_name", sa.String(length=256), nullable=False, server_default=""),
        sa.Column("actual_scopes", sa.JSON(), nullable=False),
        sa.Column("encrypted_access_token", sa.JSON(), nullable=False),
        sa.Column("access_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("encrypted_refresh_token", sa.JSON(), nullable=False),
        sa.Column("token_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="active"),
        sa.Column("refresh_attempt_id", sa.String(length=36), nullable=True),
        sa.Column("refresh_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("remote_revoke_status", sa.String(length=32), nullable=False, server_default="not_requested"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("grant_id"),
    )
    op.create_index("ix_oauth_grants_owner", "oauth_grants", ["owner_subject_id"])
    op.create_index("ix_oauth_grants_status", "oauth_grants", ["status"])

    op.create_table(
        "oauth_device_sessions",
        sa.Column("device_session_id", sa.String(length=36), nullable=False),
        sa.Column("grant_id", sa.String(length=36), sa.ForeignKey("oauth_grants.grant_id"), nullable=False),
        sa.Column("owner_subject_id", sa.String(length=128), nullable=False),
        sa.Column("tenant_id", sa.String(length=64), nullable=False),
        sa.Column("installation_id", sa.String(length=128), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("device_session_id"),
    )
    op.create_index("ix_oauth_devices_owner", "oauth_device_sessions", ["owner_subject_id"])
    op.create_index("ix_oauth_devices_installation", "oauth_device_sessions", ["installation_id"])
    op.create_index("ix_oauth_devices_expires", "oauth_device_sessions", ["expires_at"])

    op.create_table(
        "audit_events",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("tenant_id", sa.String(length=64), nullable=False),
        sa.Column("subject_id_hash", sa.String(length=64), nullable=False),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("target_type", sa.String(length=32), nullable=False, server_default=""),
        sa.Column("target_id", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="success"),
        sa.Column("error_code", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("request_id", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("event_metadata", sa.JSON(), nullable=False, server_default="{}"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_audit_created", "audit_events", ["created_at"])
    op.create_index("ix_audit_tenant", "audit_events", ["tenant_id"])
    op.create_index("ix_audit_subject", "audit_events", ["subject_id_hash"])

    op.create_table(
        "policy_snapshots",
        sa.Column("policy_version", sa.String(length=64), nullable=False),
        sa.Column("effective_from", sa.DateTime(timezone=True), nullable=False),
        sa.Column("rate_catalog_hash", sa.String(length=64), nullable=False),
        sa.Column("locales_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("policy_version"),
    )

    op.create_table(
        "roi_runs",
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("client_run_id", sa.String(length=128), nullable=False),
        sa.Column("owner_subject_id", sa.String(length=128), nullable=False),
        sa.Column("tenant_id", sa.String(length=64), nullable=False),
        sa.Column("policy_version", sa.String(length=64), nullable=False),
        sa.Column("source_locale", sa.String(length=16), nullable=False),
        sa.Column("project_ids_json", sa.JSON(), nullable=False),
        sa.Column("projects_json", sa.JSON(), nullable=False),
        sa.Column("display_scope_json", sa.JSON(), nullable=False),
        sa.Column("sheet_json", sa.JSON(), nullable=False),
        sa.Column("locale_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("accepted_item_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("a_state", sa.String(length=16), nullable=False, server_default="queued"),
        sa.Column("review_state", sa.String(length=16), nullable=False, server_default="open"),
        sa.Column("c_state", sa.String(length=16), nullable=False, server_default="idle"),
        sa.Column("archive_state", sa.String(length=24), nullable=False, server_default="not_requested"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sealed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("archive_requested_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("archive_completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("archive_record_id", sa.String(length=64), nullable=True),
        sa.Column("archive_snapshot_id", sa.String(length=36), nullable=True),
        sa.Column("archive_duplicate_run_records", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("total_saving_usd", sa.Numeric(20, 10), nullable=True),
        sa.Column("selected_scope_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("complete_scope_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("run_id"),
        sa.UniqueConstraint("owner_subject_id", "client_run_id", name="uq_roi_owner_client_run"),
    )
    op.create_index("ix_roi_runs_client", "roi_runs", ["owner_subject_id", "client_run_id"])
    op.create_index("ix_roi_runs_owner_state", "roi_runs", ["owner_subject_id", "archive_state"])
    for col in ["policy_version", "a_state", "review_state", "c_state", "archive_state"]:
        op.create_index(f"ix_roi_runs_{col}", "roi_runs", [col])

    op.create_table(
        "roi_items",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("run_id", sa.String(length=36), sa.ForeignKey("roi_runs.run_id"), nullable=False),
        sa.Column("item_id", sa.String(length=128), nullable=False),
        sa.Column("source_key", sa.String(length=256), nullable=False, server_default=""),
        sa.Column("sheet_row", sa.Integer(), nullable=False),
        sa.Column("source_text_cipher", sa.JSON(), nullable=True),
        sa.Column("source_hash", sa.String(length=64), nullable=False),
        sa.Column("source_word_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("final_text_cipher", sa.JSON(), nullable=True),
        sa.Column("final_hash", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("final_word_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sheet_write_receipt_json", sa.JSON(), nullable=True),
        sa.Column("display_final_tm_json", sa.JSON(), nullable=True),
        sa.Column("review_status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("item_record_id", sa.String(length=64), nullable=True),
        sa.Column("content_erased_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", "item_id", name="uq_roi_run_item"),
    )
    op.create_index("ix_roi_items_run", "roi_items", ["run_id"])
    op.create_index("ix_roi_items_item", "roi_items", ["item_id"])
    op.create_index("ix_roi_items_review", "roi_items", ["review_status"])

    op.create_table(
        "roi_scope_results",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("run_id", sa.String(length=36), sa.ForeignKey("roi_runs.run_id"), nullable=False),
        sa.Column("item_id", sa.String(length=128), nullable=False),
        sa.Column("locale", sa.String(length=16), nullable=False),
        sa.Column("stage", sa.String(length=2), nullable=False),
        sa.Column("text_hash", sa.String(length=64), nullable=False),
        sa.Column("policy_version", sa.String(length=64), nullable=False),
        sa.Column("score", sa.Numeric(10, 4), nullable=True),
        sa.Column("match_category", sa.String(length=32), nullable=True),
        sa.Column("cost_usd", sa.Numeric(20, 10), nullable=True),
        sa.Column("word_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="queued"),
        sa.Column("failure_code", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("failure_reason", sa.Text(), nullable=False, server_default=""),
        sa.Column("computed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "run_id", "item_id", "locale", "stage", "text_hash", "policy_version",
            name="uq_scope_result_identity",
        ),
    )
    op.create_index("ix_scope_run_locale_stage", "roi_scope_results", ["run_id", "locale", "stage"])
    for col in ["item_id", "locale", "stage", "policy_version", "status"]:
        op.create_index(f"ix_scope_results_{col}", "roi_scope_results", [col])

    op.create_table(
        "roi_jobs",
        sa.Column("job_id", sa.String(length=36), nullable=False),
        sa.Column("run_id", sa.String(length=36), sa.ForeignKey("roi_runs.run_id"), nullable=False),
        sa.Column("item_id", sa.String(length=128), nullable=False),
        sa.Column("locale", sa.String(length=16), nullable=False),
        sa.Column("stage", sa.String(length=8), nullable=False),
        sa.Column("text_hash", sa.String(length=64), nullable=False),
        sa.Column("policy_version", sa.String(length=64), nullable=False),
        sa.Column("task_type", sa.String(length=32), nullable=False),
        sa.Column("payload_json", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="queued"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("max_attempts", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("leased_by", sa.String(length=64), nullable=True),
        sa.Column("fencing_token", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("leased_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error_code", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("last_error_message", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("job_id"),
        sa.UniqueConstraint(
            "run_id", "item_id", "locale", "stage", "text_hash", "policy_version", "task_type",
            name="uq_roi_job_identity",
        ),
    )
    op.create_index("ix_roi_jobs_poll", "roi_jobs", ["status", "leased_until", "run_id"])
    for col in ["run_id", "item_id", "locale", "stage", "task_type", "status"]:
        op.create_index(f"ix_roi_jobs_{col}", "roi_jobs", [col])

    op.create_table(
        "roi_outbox_events",
        sa.Column("event_id", sa.String(length=36), nullable=False),
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("payload_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("event_id"),
    )
    op.create_index("ix_outbox_run", "roi_outbox_events", ["run_id"])
    op.create_index("ix_outbox_type", "roi_outbox_events", ["event_type"])
    op.create_index("ix_outbox_published", "roi_outbox_events", ["published_at"])

    op.create_table(
        "roi_archive_snapshots",
        sa.Column("snapshot_id", sa.String(length=36), nullable=False),
        sa.Column("run_id", sa.String(length=36), sa.ForeignKey("roi_runs.run_id"), nullable=False, unique=True),
        sa.Column("payload_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("snapshot_id"),
    )

    op.create_table(
        "roi_archive_records",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("table_name", sa.String(length=32), nullable=False),
        sa.Column("logical_key", sa.String(length=256), nullable=False),
        sa.Column("record_id", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("phase", sa.String(length=24), nullable=False, server_default="writing"),
        sa.Column("fencing_token", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error_code", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("last_error_message", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", "table_name", "logical_key", name="uq_archive_record"),
    )
    op.create_index("ix_archive_run", "roi_archive_records", ["run_id"])
    op.create_index("ix_archive_table", "roi_archive_records", ["table_name"])
    op.create_index("ix_archive_phase", "roi_archive_records", ["phase"])


def downgrade() -> None:
    for table in [
        "roi_archive_records",
        "roi_archive_snapshots",
        "roi_outbox_events",
        "roi_jobs",
        "roi_scope_results",
        "roi_items",
        "roi_runs",
        "policy_snapshots",
        "audit_events",
        "oauth_device_sessions",
        "oauth_grants",
        "oauth_sessions",
        "idempotency_records",
    ]:
        op.drop_table(table)
