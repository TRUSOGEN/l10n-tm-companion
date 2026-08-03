"""Pydantic request/response models.

These models mirror the external HTTP contract in
``docs/oauth-broker-async-roi-contract.md`` and never expose secrets or
full source text in error paths.
"""

from __future__ import annotations

import datetime as dt
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ClientError(BaseModel):
    code: str
    message: str
    request_id: str
    retryable: bool = False


class ErrorResponse(BaseModel):
    error: ClientError


class CreateOAuthSessionRequest(BaseModel):
    installation_id: str = Field(min_length=1, max_length=128)
    redirect_uri: str
    code_challenge: str = Field(min_length=43, max_length=128)
    code_challenge_method: Literal["S256"] = "S256"
    plugin_version: str = Field(min_length=3, max_length=32)


class CreateOAuthSessionResponse(BaseModel):
    session_id: str
    state: str
    authorize_url: str
    expires_at: dt.datetime


class ExchangeOAuthCodeRequest(BaseModel):
    code: str
    state: str
    code_verifier: str = Field(min_length=43, max_length=128)


class FeishuUser(BaseModel):
    open_id: str
    user_id: str
    name: str
    avatar_url: str


class ExchangeOAuthCodeResponse(BaseModel):
    grant_id: str
    device_session_token: str
    device_session_expires_at: dt.datetime
    user_access_token: str
    access_expires_at: dt.datetime
    actual_scopes: list[str]
    user: FeishuUser


class RefreshTokenRequest(BaseModel):
    known_token_version: int = Field(ge=0, le=10_000_000, default=0)


class RefreshTokenResponse(BaseModel):
    user_access_token: str
    access_expires_at: dt.datetime
    token_version: int
    actual_scopes: list[str]
    reauthorization_required: bool = False


class RevokeResponse(BaseModel):
    device_session_status: Literal["revoked"] | None = None
    grant_status: Literal["revoked"] | None = None
    remote_revoke_status: str | None = None


class SheetRef(BaseModel):
    document_token: str
    sheet_id: str
    source_range: str = Field(max_length=64)


class ProjectRef(BaseModel):
    project_id: str
    name: str


class DisplayScope(BaseModel):
    source_locale: str
    target_locale: str
    project_ids: list[str]

    @field_validator("project_ids")
    @classmethod
    def _validate_projects(cls, value: list[str]) -> list[str]:
        if not 1 <= len(value) <= 10:
            raise ValueError("project_ids must contain 1–10 projects")
        return value


class RoiItemInput(BaseModel):
    item_id: str = Field(min_length=1, max_length=128)
    source_key: str = Field(default="", max_length=256)
    sheet_row: int = Field(ge=1, le=1_000_000)
    source_text: str
    source_hash: str = Field(min_length=64, max_length=64)

    @field_validator("source_hash")
    @classmethod
    def _lower_hash(cls, value: str) -> str:
        if len(value) != 64 or any(c not in "0123456789abcdef" for c in value.lower()):
            raise ValueError("source_hash must be a lowercase hex SHA-256")
        return value.lower()


class CreateRoiRunRequest(BaseModel):
    client_run_id: str = Field(min_length=1, max_length=128)
    started_at: dt.datetime
    sheet: SheetRef
    projects: list[ProjectRef]
    display_scope: DisplayScope
    items: list[RoiItemInput]

    @field_validator("projects")
    @classmethod
    def _validate_projects(cls, value: list[ProjectRef]) -> list[ProjectRef]:
        if not 1 <= len(value) <= 10:
            raise ValueError("projects must contain 1–10 entries")
        return value

    @field_validator("items")
    @classmethod
    def _validate_items(cls, value: list[RoiItemInput]) -> list[RoiItemInput]:
        if len(value) < 1 or len(value) > 500:
            raise ValueError("items must contain 1–500 entries")
        ids = {it.item_id for it in value}
        if len(ids) != len(value):
            raise ValueError("item_id must be unique within a run")
        return value


class CreateRoiRunResponse(BaseModel):
    run_id: str
    revision: int
    a_state: str
    review_state: str
    c_state: str
    archive_state: str
    policy_version: str
    locale_count: int
    accepted_item_count: int


class SheetWriteReceipt(BaseModel):
    document_token: str
    sheet_id: str
    row: int
    output_range: str
    output_hash: str = Field(min_length=64, max_length=64)

    @field_validator("output_hash")
    @classmethod
    def _lower_hash(cls, value: str) -> str:
        return value.lower()


class DisplayFinalTM(BaseModel):
    score: float = Field(ge=0, le=100)
    match_category: str | None = None


class SubmitFinalTextRequest(BaseModel):
    expected_revision: int = Field(ge=1)
    final_text: str
    final_text_hash: str = Field(min_length=64, max_length=64)
    confirmed_at: dt.datetime
    sheet_write_receipt: SheetWriteReceipt
    display_final_tm: DisplayFinalTM | None = None

    @field_validator("final_text_hash")
    @classmethod
    def _lower_hash(cls, value: str) -> str:
        return value.lower()


class SubmitFinalTextResponse(BaseModel):
    run_id: str
    item_id: str
    revision: int
    c_state: str


class FailureCount(BaseModel):
    code: str
    count: int


class CoverageInfo(BaseModel):
    expected_a_lines: int
    complete_a_lines: int
    complete_c_lines: int
    expected_c_lines: int
    complete_a_c_pairs: int


class ArchiveInfo(BaseModel):
    record_id: str | None
    requested_at: dt.datetime | None
    completed_at: dt.datetime | None


class RoiRunStatus(BaseModel):
    run_id: str
    revision: int
    a_state: str
    review_state: str
    c_state: str
    archive_state: str
    policy_version: str
    locale_count: int
    accepted_item_count: int
    selected_scope_count: int
    complete_scope_count: int
    total_saving_usd: float | None
    coverage: CoverageInfo
    failures: list[FailureCount]
    archive: ArchiveInfo


class ArchiveRequest(BaseModel):
    expected_revision: int = Field(ge=1)
    requested_at: dt.datetime


class ArchiveAcceptedResponse(BaseModel):
    run_id: str
    archive_state: str
    snapshot_id: str
    status_url: str


class GenericMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    message: str


# Helpers
def error_body(code: str, message: str, request_id: str, retryable: bool = False) -> dict[str, Any]:
    return ErrorResponse(
        error=ClientError(code=code, message=message, request_id=request_id, retryable=retryable)
    ).model_dump()
