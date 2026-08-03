"""Production Feishu gateway stub.

The real HTTP Feishu gateway lives in :mod:`l10n_backend.api.feishu_client`
(used for local dev / tests and for the fallback in ``deps.py``). The adapter
factory only instantiates a production Feishu gateway when company Secret
Manager is wired — app secrets must never be read from process env in PPE or
prod. Until that wiring is supplied, this stub raises on every call so we
never accidentally exchange real tokens using fake credentials.
"""

from __future__ import annotations

from typing import Any


_NOT_WIRED_MSG = "Production Feishu gateway requires Secret Manager wiring. Awaiting company Secret Manager / Feishu app owner inputs."


class HttpFeishuGateway:
    """Stub production Feishu gateway. All network methods raise."""

    def __init__(
        self,
        *,
        token_url: str,
        revoke_url: str,
        user_info_url: str,
        app_id: str,
        app_secret_provider: Any = None,
    ) -> None:
        if not token_url:
            raise ValueError("token_url is required")
        if not revoke_url:
            raise ValueError("revoke_url is required")
        if not user_info_url:
            raise ValueError("user_info_url is required")
        if not app_id:
            raise ValueError("app_id is required")
        self.token_url = token_url
        self.revoke_url = revoke_url
        self.user_info_url = user_info_url
        self.app_id = app_id
        self.app_secret_provider = app_secret_provider

    def exchange_code(self, creds, *, code: str, redirect_uri: str, code_verifier: str) -> dict[str, Any]:
        raise RuntimeError(_NOT_WIRED_MSG)

    def refresh_token(self, creds, *, refresh_token: str) -> dict[str, Any]:
        raise RuntimeError(_NOT_WIRED_MSG)

    def revoke_refresh_token(self, creds, *, refresh_token: str) -> dict[str, Any]:
        raise RuntimeError(_NOT_WIRED_MSG)

    def user_info(self, access_token: str) -> dict[str, Any]:
        raise RuntimeError(_NOT_WIRED_MSG)
