"""HTTP Starling gateway stub.

The real Starling endpoint, mTLS identity, AK/SK resolution through Secret
Manager, and batch contract will be wired by the Starling gateway owner.
This stub fails loudly so production cannot silently score with fakes.
"""

from __future__ import annotations

from typing import Any


_PRODUCTION_WIRING_MSG = "Starling gateway adapter is not wired yet. Awaiting company Starling owner inputs."


class HttpStarlingGateway:
    """Stub production Starling gateway. All network methods raise."""

    def __init__(self, *, base_url: str, timeout_seconds: float = 20.0, max_retries: int = 3) -> None:
        if not base_url:
            raise ValueError("starling_base_url is required")
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.max_retries = max_retries

    def batch_tm(
        self,
        *,
        access_key: str,
        secret_key: str,
        project_ids: list[str],
        source_locale: str,
        target_locale: str,
        source_contents: list[str],
    ) -> list[dict[str, Any]]:
        raise RuntimeError(_PRODUCTION_WIRING_MSG)
