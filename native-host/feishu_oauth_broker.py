#!/usr/bin/env python3
"""Broker-backed Feishu OAuth flow for the L10n TM Companion Native Host.

The Native Host still launches a ``localhost`` callback server and uses PKCE,
but the authorization code exchange and refresh are performed by the company
OAuth Broker service. The Feishu App Secret never touches the user's Mac,
Chrome storage, the installation package, logs, or network responses seen by
the extension.

In ``LEGACY_LOCAL_SECRET_DEV_ONLY`` builds only, the previous Keychain
exchange path is kept available behind an explicit build flag. Production
builds MUST compile with that flag disabled.
"""

from __future__ import annotations

import base64
import hashlib
import html
import json
import os
import secrets
import subprocess
import time
import urllib.error
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, Callable, Mapping
from urllib.parse import parse_qs, urlencode, urlparse


REDIRECT_URI = "http://127.0.0.1:39641/l10n-tm-companion/oauth/callback"
CALLBACK_TIMEOUT_SECONDS = 300
HTTP_TIMEOUT_SECONDS = 20
KEYCHAIN_DEVICE_TOKEN_SERVICE = "com.l10n.tm_companion.device-session-token"
KEYCHAIN_INSTALLATION_ID_SERVICE = "com.l10n.tm_companion.installation-id"
CALLBACK_RECEIVED_MESSAGE = (
    "Authorization response received. Returning to your original page while "
    "L10n TM Companion finishes connecting."
)

# A4: Dev-only compile-time flag.
#
# Defaults to False for production builds; only opt-in by explicitly setting
# the environment variable ``L10N_LOCAL_SECRET_DEV_ONLY=1`` in a developer's
# local shell. Production builds (signed / packaged .app / .dmg / installer)
# MUST NOT set this env var, MUST NOT enable legacy local secret
# configuration, and MUST treat any attempt to call configure_app_secret as
# an error. Do NOT guess the packaging system here — the code surface makes
# the safe choice (default False) and leaves packaging to the build pipeline.
#
# NOTE: the env var name is intentionally NOT "LEGACY_*" — the storage key is
# LEGACY_LOCAL_SECRET_DEV_ONLY (Python constant), but we read from
# L10N_LOCAL_SECRET_DEV_ONLY to avoid shipping legacy-named variables into
# production environments accidentally.
LEGACY_LOCAL_SECRET_DEV_ONLY = os.environ.get("L10N_LOCAL_SECRET_DEV_ONLY", "0") == "1"

if LEGACY_LOCAL_SECRET_DEV_ONLY:
    # Intentionally printed only in dev; never logged in production.
    import sys as _sys
    print(
        "[l10n-tm-companion] WARNING: legacy local-secret path enabled via "
        "L10N_LOCAL_SECRET_DEV_ONLY=1. Production builds MUST NOT set this.",
        file=_sys.stderr,
    )


class BrokerOAuthError(RuntimeError):
    """Stable OAuth error surfaced to the extension with a safe message."""


# ------------------------ keychain persistence ------------------------
def _keychain_run(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        capture_output=True,
        text=True,
        timeout=HTTP_TIMEOUT_SECONDS,
    )


def load_device_session_token() -> str:
    result = _keychain_run(
        ["/usr/bin/security", "find-generic-password", "-s", KEYCHAIN_DEVICE_TOKEN_SERVICE, "-a", "default", "-w"]
    )
    if result.returncode != 0:
        return ""
    return (result.stdout or "").strip()


def save_device_session_token(token: str) -> None:
    _keychain_run(
        ["/usr/bin/security", "delete-generic-password", "-s", KEYCHAIN_DEVICE_TOKEN_SERVICE, "-a", "default"]
    )
    result = _keychain_run(
        [
            "/usr/bin/security",
            "add-generic-password",
            "-U",
            "-s",
            KEYCHAIN_DEVICE_TOKEN_SERVICE,
            "-a",
            "default",
            "-w",
            token,
        ]
    )
    if result.returncode != 0:
        raise BrokerOAuthError("Could not persist the OAuth device session token in macOS Keychain")


def clear_device_session_token() -> None:
    _keychain_run(
        ["/usr/bin/security", "delete-generic-password", "-s", KEYCHAIN_DEVICE_TOKEN_SERVICE, "-a", "default"]
    )


def load_installation_id() -> str:
    result = _keychain_run(
        ["/usr/bin/security", "find-generic-password", "-s", KEYCHAIN_INSTALLATION_ID_SERVICE, "-a", "default", "-w"]
    )
    if result.returncode == 0 and (result.stdout or "").strip():
        return (result.stdout or "").strip()
    installation_id = secrets.token_urlsafe(24)
    _keychain_run(
        [
            "/usr/bin/security",
            "add-generic-password",
            "-U",
            "-s",
            KEYCHAIN_INSTALLATION_ID_SERVICE,
            "-a",
            "default",
            "-w",
            installation_id,
        ]
    )
    return installation_id


# ------------------------ HTTP helpers ------------------------
def _request_json(
    method: str,
    url: str,
    *,
    body: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    device_token: str = "",
) -> dict[str, Any]:
    hdrs = {"Content-Type": "application/json; charset=utf-8"}
    if device_token:
        hdrs["Authorization"] = f"Bearer {device_token}"
        hdrs["X-L10N-Device-Session-Token"] = device_token
    if headers:
        hdrs.update(headers)
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT_SECONDS) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw)
        except Exception:
            payload = {}
        err = payload.get("error", {}) if isinstance(payload, dict) else {}
        raise BrokerOAuthError(
            err.get("message") or f"Broker request failed: HTTP {error.code}"
        ) from error
    except Exception as exc:  # noqa: BLE001
        raise BrokerOAuthError(f"Broker request failed: {exc}") from exc
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise BrokerOAuthError("Broker response was not valid JSON") from exc
    return payload


# ------------------------ PKCE / callback ------------------------
def build_code_challenge(code_verifier: str) -> str:
    if not code_verifier:
        raise BrokerOAuthError("OAuth PKCE code verifier is required")
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def validate_callback(query: Mapping[str, list[str]], expected_state: str) -> str:
    state = (query.get("state") or [""])[0]
    if not secrets.compare_digest(state, expected_state):
        raise BrokerOAuthError("OAuth callback state mismatch")
    error = (query.get("error") or [""])[0]
    if error:
        raise BrokerOAuthError(f"Feishu authorization failed: {error}")
    code = (query.get("code") or [""])[0]
    if not code:
        raise BrokerOAuthError("OAuth callback did not include an authorization code")
    return code


def normalize_return_url(return_url: str) -> str:
    candidate = str(return_url or "").strip()
    parsed = urlparse(candidate)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return ""
    return candidate


def build_callback_page(message: str, success: bool, return_url: str = "") -> str:
    safe_message = html.escape(str(message or ""))
    normalized = normalize_return_url(return_url)
    safe_return_url = html.escape(normalized, quote=True)
    return_url_json = json.dumps(normalized)
    action = (
        f'<a class="button" href="{safe_return_url}">Return to the original page</a>'
        if normalized
        else '<button class="button" type="button" onclick="window.close()">Close this tab</button>'
    )
    automatic = ""
    if success:
        automatic = f"""
      const returnUrl = {return_url_json};
      window.setTimeout(() => {{
        window.close();
        if (returnUrl) {{
          window.setTimeout(() => window.location.replace(returnUrl), 350);
        }}
      }}, 180);
"""
    state_class = "success" if success else "error"
    title = "Returning to your page…" if success else "Authorization was not completed"
    return f"""<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>L10n TM Companion OAuth</title>
<style>
:root{{color-scheme:light;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}}
body{{margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f8fa;color:#1f2329}}
main{{width:min(420px,calc(100% - 32px));padding:24px;border:1px solid #e5e7eb;border-radius:12px;background:#fff}}
.mark{{width:32px;height:32px;display:grid;place-items:center;border-radius:50%;background:#e9f8f0;color:#008f57;font-weight:700}}
.error .mark{{background:#fff0f1;color:#d32030}}
h1{{margin:14px 0 6px;font-size:18px}}p{{margin:0 0 18px;color:#646a73;font-size:13px;line-height:1.5}}
.button{{display:inline-flex;align-items:center;justify-content:center;min-height:36px;padding:0 14px;border:0;border-radius:7px;background:#3157d5;color:#fff;text-decoration:none;cursor:pointer}}
</style></head>
<body><main class="{state_class}"><div class="mark">{"✓" if success else "!"}</div><h1>{title}</h1><p>{safe_message}</p>{action}</main>
<script>{automatic}</script></body></html>"""


def _make_handler(
    callback_path: str,
    expected_state: str,
    completed: dict[str, Any],
    return_url: str,
):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            parsed = urlparse(self.path)
            if parsed.path != callback_path:
                self.send_response(404)
                self.end_headers()
                return
            try:
                completed["code"] = validate_callback(parse_qs(parsed.query), expected_state)
                completed["ok"] = True
                message = CALLBACK_RECEIVED_MESSAGE
                status = 200
            except BrokerOAuthError as error:
                completed["error"] = str(error)
                message = "Authorization was not completed. You can return to L10n TM Companion."
                status = 400
            completed["done"] = True
            body = build_callback_page(message, success=status == 200, return_url=return_url).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, _format: str, *_args: object) -> None:
            """Do not log the callback query string — it contains the code."""

    return Handler


# ------------------------ broker calls ------------------------
def broker_base_url() -> str:
    return os.environ.get(
        "L10N_BROKER_BASE_URL",
        # Production URL to be supplied by the company gateway; PPE/dev override via env.
        "https://l10n-tm-companion.internal.example.com",
    ).rstrip("/")


def _gateway_headers(installation_id: str, plugin_version: str) -> dict[str, str]:
    """Identity headers injected by the Native Host's SSO/mTLS bootstrap.

    In production these are populated by the approved device identity flow.
    When ``LEGACY_LOCAL_SECRET_DEV_ONLY`` is enabled we accept a fixed dev
    subject to allow local testing; production must never send that header.
    """
    headers = {
        "X-L10N-Installation-Id": installation_id,
        "X-Plugin-Version": plugin_version,
    }
    if LEGACY_LOCAL_SECRET_DEV_ONLY:
        headers["X-Dev-Subject"] = os.environ.get("L10N_DEV_SUBJECT", "dev-user")
        headers["X-Dev-Tenant"] = os.environ.get("L10N_DEV_TENANT", "dev-tenant")
    else:
        # In production, the approved device identity bootstrap will set the
        # employee/device identity headers expected by the company gateway.
        headers["X-L10N-Device-Identity"] = os.environ.get("L10N_DEVICE_IDENTITY", "")
    return headers


def create_broker_session(
    *,
    code_challenge: str,
    plugin_version: str,
    installation_id: str,
    request_id: str = "",
) -> dict[str, Any]:
    return _request_json(
        "POST",
        f"{broker_base_url()}/v1/oauth/sessions",
        body={
            "installation_id": installation_id,
            "redirect_uri": REDIRECT_URI,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
            "plugin_version": plugin_version,
        },
        headers={
            **_gateway_headers(installation_id, plugin_version),
            "Idempotency-Key": f"session:{installation_id}:{request_id or secrets.token_hex(8)}",
        },
    )


def exchange_broker_code(
    *,
    session_id: str,
    code: str,
    state: str,
    code_verifier: str,
    installation_id: str,
    plugin_version: str,
) -> dict[str, Any]:
    return _request_json(
        "POST",
        f"{broker_base_url()}/v1/oauth/sessions/{session_id}/exchange",
        body={"code": code, "state": state, "code_verifier": code_verifier},
        headers={
            **_gateway_headers(installation_id, plugin_version),
            "X-L10N-Installation-Id": installation_id,
        },
    )


def refresh_broker_token(
    *,
    grant_id: str,
    known_token_version: int,
    plugin_version: str,
    installation_id: str,
    device_token: str,
) -> dict[str, Any]:
    return _request_json(
        "POST",
        f"{broker_base_url()}/v1/oauth/grants/{grant_id}/token",
        body={"known_token_version": known_token_version},
        headers={
            **_gateway_headers(installation_id, plugin_version),
            "X-L10N-Installation-Id": installation_id,
        },
        device_token=device_token,
    )


def revoke_broker_device(
    *,
    plugin_version: str,
    installation_id: str,
    device_token: str,
) -> dict[str, Any]:
    return _request_json(
        "DELETE",
        f"{broker_base_url()}/v1/oauth/device-sessions/current",
        headers={**_gateway_headers(installation_id, plugin_version)},
        device_token=device_token,
    )


# ------------------------ public entry points ------------------------
def authorize_via_broker(
    *,
    plugin_version: str,
    return_url: str = "",
    browser_open: Callable[[str], bool] = webbrowser.open,
) -> dict[str, Any]:
    """Run the PKCE + localhost callback flow against the OAuth Broker."""

    installation_id = load_installation_id()
    code_verifier = secrets.token_urlsafe(64)
    challenge = build_code_challenge(code_verifier)
    request_id = secrets.token_hex(8)
    session = create_broker_session(
        code_challenge=challenge,
        plugin_version=plugin_version,
        installation_id=installation_id,
        request_id=request_id,
    )
    session_id = session["session_id"]
    broker_state = session["state"]
    authorize_url = session["authorize_url"]

    parsed = urlparse(REDIRECT_URI)
    completed: dict[str, Any] = {"done": False}
    handler = _make_handler(parsed.path, broker_state, completed, return_url=return_url)
    server = HTTPServer(("127.0.0.1", parsed.port or 39641), handler)
    server.timeout = 0.5
    try:
        if not browser_open(authorize_url):
            raise BrokerOAuthError("Could not open the Feishu authorization page")
        deadline = time.monotonic() + CALLBACK_TIMEOUT_SECONDS
        while not completed["done"] and time.monotonic() < deadline:
            server.handle_request()
    finally:
        server.server_close()
    if not completed["done"]:
        raise BrokerOAuthError("Feishu authorization timed out after 5 minutes")
    if not completed.get("ok"):
        raise BrokerOAuthError(str(completed.get("error") or "Authorization was not completed"))

    token = exchange_broker_code(
        session_id=session_id,
        code=str(completed["code"]),
        state=broker_state,
        code_verifier=code_verifier,
        installation_id=installation_id,
        plugin_version=plugin_version,
    )
    save_device_session_token(token["device_session_token"])
    return {
        "ok": True,
        "access_token": token["user_access_token"],
        "expires_in": int((_parse_dt(token["access_expires_at"]) - _now_utc()).total_seconds()),
        "expires_at": token["access_expires_at"],
        "grant_id": token["grant_id"],
        "device_session_expires_at": token["device_session_expires_at"],
        "scope": " ".join(token.get("actual_scopes") or []),
        "user": token.get("user", {}),
        "token_version": 1,
    }


def _parse_dt(value: Any) -> dt.datetime:  # type: ignore[name-defined]  # noqa: F821
    import datetime as dt

    if isinstance(value, dt.datetime):
        return value.astimezone(dt.timezone.utc)
    s = str(value).strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    parsed = dt.datetime.fromisoformat(s)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc)


def _now_utc() -> dt.datetime:  # type: ignore[name-defined]  # noqa: F821
    import datetime as dt

    return dt.datetime.now(dt.timezone.utc)


def get_broker_access_token(
    *,
    grant_id: str,
    known_token_version: int,
    plugin_version: str,
) -> dict[str, Any]:
    device_token = load_device_session_token()
    if not device_token:
        raise BrokerOAuthError("No device session token; reauthorize Feishu.")
    installation_id = load_installation_id()
    token = refresh_broker_token(
        grant_id=grant_id,
        known_token_version=known_token_version,
        plugin_version=plugin_version,
        installation_id=installation_id,
        device_token=device_token,
    )
    if token.get("reauthorization_required"):
        clear_device_session_token()
        raise BrokerOAuthError("Feishu reauthorization required. Please reconnect your Feishu account.")
    return {
        "ok": True,
        "access_token": token["user_access_token"],
        "expires_in": int((_parse_dt(token["access_expires_at"]) - _now_utc()).total_seconds()),
        "token_version": int(token.get("token_version") or 1),
        "scope": " ".join(token.get("actual_scopes") or []),
    }


def broker_authorization_status(*, plugin_version: str) -> dict[str, Any]:
    """Return the current broker authorization state without forcing refresh."""
    device_token = load_device_session_token()
    installation_id = load_installation_id()
    return {
        "ok": True,
        "has_device_session": bool(device_token),
        "installation_id": installation_id,
        "broker_base_url": broker_base_url(),
        "plugin_version": plugin_version,
        "legacy_local_secret_dev_only": LEGACY_LOCAL_SECRET_DEV_ONLY,
        "redirect_uri": REDIRECT_URI,
    }


def revoke_broker_authorization(*, plugin_version: str) -> dict[str, Any]:
    device_token = load_device_session_token()
    if not device_token:
        return {"ok": True, "device_session_status": "revoked"}
    installation_id = load_installation_id()
    try:
        revoke_broker_device(
            plugin_version=plugin_version,
            installation_id=installation_id,
            device_token=device_token,
        )
    finally:
        clear_device_session_token()
    return {"ok": True, "device_session_status": "revoked"}


# ------------------------ legacy dev-only path ------------------------
def _legacy_dev_secret_paths():  # pragma: no cover - exercised only in dev builds
    from . import feishu_oauth  # type: ignore

    return feishu_oauth


def configure_app_secret_owner_only_dev(*args, **kwargs):  # pragma: no cover
    if not LEGACY_LOCAL_SECRET_DEV_ONLY:
        raise BrokerOAuthError("Production builds cannot configure a local Feishu App Secret.")
    return _legacy_dev_secret_paths().configure_app_secret(*args, **kwargs)
