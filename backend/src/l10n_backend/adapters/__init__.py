"""Pluggable adapters for external company platforms.

The concrete production adapters (company HTTPS gateway identity, company
Secret Manager, company KMS, internal Starling gateway, Feishu tenant-app
token for ROI_Test) depend on internal systems that are not available in the
open sandbox. The interfaces here are deliberately stable so domain code can
be developed and fully unit/integration-tested behind in-memory fakes before
the company-side wiring is supplied.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class CallerIdentity:
    """Identity the company HTTPS gateway injects on every verified request."""

    subject_id: str
    tenant_id: str
    auth_strength: str = "employee_sso"


class IdentityVerifier(Protocol):
    """Verify the caller and return the injected company identity."""

    def verify(self, headers: dict[str, str]) -> CallerIdentity: ...


class SecretProvider(Protocol):
    """Fetch secrets (App Secret, data key, Starling creds) by name."""

    def get_secret(self, name: str) -> str: ...


class KeyManagementService(Protocol):
    """Wrap/unwrap data encryption keys using the company KMS."""

    def generate_data_key(self, key_id: str) -> tuple[bytes, bytes]:
        """Return (plaintext_key, encrypted_key_blob)."""

    def decrypt_data_key(self, wrapped_key_blob: bytes) -> bytes: ...


@dataclass(frozen=True)
class FeishuAppCredentials:
    app_id: str
    app_secret: str


class FeishuGateway(Protocol):
    """HTTP interactions with Feishu OpenAPI."""

    def exchange_code(
        self, creds: FeishuAppCredentials, code: str, redirect_uri: str, code_verifier: str
    ) -> dict: ...

    def refresh_token(self, creds: FeishuAppCredentials, refresh_token: str) -> dict: ...

    def revoke_refresh_token(self, creds: FeishuAppCredentials, refresh_token: str) -> dict: ...

    def user_info(self, access_token: str) -> dict: ...


class StarlingGateway(Protocol):
    """HTTP interactions with the Starling Batch TM endpoint."""

    def batch_tm(
        self,
        *,
        access_key: str,
        secret_key: str,
        project_ids: list[str],
        source_locale: str,
        target_locale: str,
        source_contents: list[str],
    ) -> list[dict]:
        """Return one result per source with keys ``score`` and ``match_category``."""
