"""Application configuration.

All external platform identifiers (HTTPS gateway, Secret Manager, KMS,
Starling endpoints, Feishu app credentials, ROI_Test target, etc.) are wired
through environment variables. When the company owner gates have not yet been
confirmed, feature flags default to OFF so the service can be deployed safely
without producing production traffic.
"""

from __future__ import annotations

from functools import lru_cache
from typing import List

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings loaded from the environment."""

    model_config = SettingsConfigDict(
        env_prefix="L10N_",
        env_file=".env",
        extra="ignore",
    )

    # Deployment environment. Controls adapter factory gating.
    # Allowed values: "dev" | "test" | "boe" | "ppe" | "prod" | "production".
    # Prod-like envs (ppe/prod/production) MUST use real adapters.
    env_name: str = "dev"

    # HTTP / runtime
    api_host: str = "127.0.0.1"
    api_port: int = 8080
    public_base_url: str = "http://127.0.0.1:8080"
    request_id_header: str = "x-request-id"
    subject_header: str = "x-l10n-subject-id"
    tenant_header: str = "x-l10n-tenant-id"
    min_plugin_version: str = "1.4.0"

    # Database
    database_url: str = "postgresql+psycopg://l10n:l10n@localhost:5432/l10n_tm"

    # Feature flags — production gates default to CLOSED.
    oauth_broker_enabled: bool = False
    async_roi_enabled: bool = False
    roi_archive_write_enabled: bool = False
    legacy_local_secret_dev_only: bool = False

    # Feishu App — secret value comes from the company Secret Manager adapter.
    feishu_app_id: str = "cli_aab1ca4137badbc4"
    feishu_app_secret_secret_name: str = "l10n-tm/feishu-app-secret"
    feishu_oauth_authorize_url: str = "https://accounts.feishu.cn/open-apis/authen/v1/authorize"
    feishu_token_url: str = "https://open.feishu.cn/open-apis/authen/v2/oauth/token"
    feishu_revoke_url: str = "https://open.feishu.cn/open-apis/authen/v2/oauth/revoke"
    feishu_user_info_url: str = "https://open.feishu.cn/open-apis/authen/v1/user_info"
    feishu_tenant_token_url: str = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal"

    # Strict PKCE redirect allowlist.
    feishu_redirect_allowlist: List[str] = Field(
        default_factory=lambda: ["http://127.0.0.1:39641/l10n-tm-companion/oauth/callback"]
    )
    feishu_required_scopes: List[str] = Field(
        default_factory=lambda: [
            "offline_access",
            "sheets:spreadsheet.meta:read",
            "sheets:spreadsheet:read",
            "sheets:spreadsheet:write_only",
            "wiki:node:read",
            "base:table:read",
            "base:table:create",
            "base:field:read",
            "base:field:create",
            "base:record:read",
            "base:record:retrieve",
            "base:record:create",
            "base:record:update",
            "base:view:read",
            "base:view:write_only",
            "contact:user.base:readonly",
            "contact:user.employee_id:readonly",
        ]
    )
    oauth_session_ttl_seconds: int = 300
    device_session_ttl_days: int = 30
    access_token_refresh_skew_seconds: int = 120
    refresh_lock_timeout_seconds: int = 20
    exchange_lock_timeout_seconds: int = 20

    # KMS envelope encryption — DEK is wrapped via company KMS when available.
    kms_key_id: str = ""
    kms_region: str = ""
    secret_provider: str = "env"  # "env" | "secret_manager"
    data_key_secret_name: str = "l10n-tm/data-encryption-key"

    # Starling (populated by the Starling owner).
    starling_base_url: str = ""
    starling_batch_tm_path: str = "/gateway/openapi/corpus/tm/match/batch"
    starling_projects_path: str = "/projects"
    starling_batch_size: int = 10
    starling_max_projects: int = 10
    starling_max_concurrency: int = 3
    starling_qps: float = 5.0
    starling_max_retries: int = 3
    starling_service_account_secret_name: str = "l10n-tm/starling-credentials"

    # ROI policy + archive targets.
    roi_policy_path: str = "config/policy.example.json"
    roi_test_app_token: str = ""  # Provided by ROI_Test owner
    roi_test_runs_table_id: str = ""
    roi_test_scopes_table_id: str = ""
    roi_test_items_table_id: str = ""
    roi_archive_max_records_per_table: int = 20_000
    roi_content_retention_days: int = 7

    # Job scheduling / leasing.
    job_lease_seconds: int = 60
    worker_poll_interval_seconds: float = 1.0
    worker_debounce_seconds: float = 2.0

    # Logging / observability.
    log_level: str = "INFO"
    log_redaction_enabled: bool = True


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return a cached singleton of :class:`Settings`."""

    return Settings()
