"""HTTP client adapter for Feishu OpenAPI.

All responses are validated to strip upstream error bodies before bubbling up.
The adapter implements bounded retries for network timeouts, 429, and 5xx.
"""

from __future__ import annotations

import time
from typing import Any

import httpx

from ..config import Settings
from ..logging_utils import get_logger

log = get_logger("feishu")


class FeishuHttpError(RuntimeError):
    def __init__(self, code: str, status: int = 503) -> None:
        super().__init__(code)
        self.code = code
        self.status = status


class HttpFeishuGateway:
    def __init__(self, settings: Settings, client: httpx.Client | None = None) -> None:
        self.settings = settings
        if client is not None:
            self.client = client
            return
        # Avoid inheriting potentially malformed environment proxies inside the
        # sandbox / corporate env. Production wiring configures an explicit
        # proxy through the internal gateway adapter.
        self.client = httpx.Client(timeout=20.0, trust_env=False, mounts={"all://": httpx.HTTPTransport(proxy=None)})

    # ----- low-level helpers -----
    def _request(self, method: str, url: str, *, json_body: dict[str, Any] | None = None,
                 headers: dict[str, str] | None = None, token: str | None = None,
                 retries: int | None = None) -> dict[str, Any]:
        retries = retries if retries is not None else 3
        hdrs = {"Content-Type": "application/json; charset=utf-8"}
        if token:
            hdrs["Authorization"] = f"Bearer {token}"
        if headers:
            hdrs.update(headers)
        last_exc: Exception | None = None
        for attempt in range(retries + 1):
            try:
                resp = self.client.request(method, url, json=json_body, headers=hdrs, timeout=20.0)
            except httpx.HTTPError as exc:
                last_exc = exc
                if attempt >= retries:
                    raise FeishuHttpError("feishu_network_error", status=503) from exc
                time.sleep(0.5 * (attempt + 1))
                continue
            if resp.status_code == 429 or 500 <= resp.status_code < 600:
                if attempt < retries:
                    time.sleep(0.5 * (attempt + 1))
                    continue
                raise FeishuHttpError(
                    "feishu_upstream_error" if resp.status_code != 429 else "feishu_rate_limited",
                    status=503,
                )
            # Try to parse JSON safely. We deliberately do NOT log raw bodies.
            try:
                data = resp.json()
            except Exception as exc:  # noqa: BLE001
                raise FeishuHttpError("feishu_invalid_response", status=503) from exc
            if resp.status_code >= 400:
                # Map common oauth errors using stable codes; body details redacted.
                code = data.get("code") if isinstance(data, dict) else None
                if code in {99991663, 99991664, 99991668}:
                    raise FeishuHttpError("oauth_invalid_grant", status=401)
                raise FeishuHttpError("feishu_upstream_error", status=503)
            if isinstance(data, dict) and data.get("code") not in (None, 0):
                # Feishu returns HTTP 200 with business code.
                raise FeishuHttpError("feishu_business_error", status=503)
            return data
        raise FeishuHttpError("feishu_network_error", status=503) from last_exc

    # ----- gateway methods -----
    def exchange_code(
        self, creds, *, code: str, redirect_uri: str, code_verifier: str
    ) -> dict[str, Any]:
        data = self._request(
            "POST",
            self.settings.feishu_token_url,
            json_body={
                "grant_type": "authorization_code",
                "client_id": creds.app_id,
                "client_secret": creds.app_secret,
                "code": code,
                "redirect_uri": redirect_uri,
                "code_verifier": code_verifier,
            },
        )
        # Feishu payload contains access_token/refresh_token at top level.
        return data.get("data") if isinstance(data.get("data"), dict) else data

    def refresh_token(self, creds, *, refresh_token: str) -> dict[str, Any]:
        data = self._request(
            "POST",
            self.settings.feishu_token_url,
            json_body={
                "grant_type": "refresh_token",
                "client_id": creds.app_id,
                "client_secret": creds.app_secret,
                "refresh_token": refresh_token,
            },
        )
        return data.get("data") if isinstance(data.get("data"), dict) else data

    def revoke_refresh_token(self, creds, *, refresh_token: str) -> dict[str, Any]:
        try:
            data = self._request(
                "POST",
                self.settings.feishu_revoke_url,
                json_body={
                    "client_id": creds.app_id,
                    "client_secret": creds.app_secret,
                    "token": refresh_token,
                    "token_type_hint": "refresh_token",
                },
            )
            return data.get("data") if isinstance(data.get("data"), dict) else data
        except FeishuHttpError:
            return {"status": "failed"}

    def user_info(self, access_token: str) -> dict[str, Any]:
        data = self._request("GET", self.settings.feishu_user_info_url, token=access_token)
        return data.get("data") if isinstance(data.get("data"), dict) else data
