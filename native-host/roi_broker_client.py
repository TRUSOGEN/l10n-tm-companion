#!/usr/bin/env python3
"""Native Messaging helper to call the L10n Broker ROI API.

This module provides Python functions used by ``starling-bridge.py`` to proxy
asynchronous ROI calls from the extension (create run, submit final C, get
status, request archive). Device identity and the device session token are
read from macOS Keychain through ``feishu_oauth_broker`` so the extension
never handles App Secret or long-lived credentials.
"""

from __future__ import annotations

import importlib.util
import json
import os
import secrets
import urllib.error
import urllib.request
from typing import Any


_BROKER_MODULE_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "feishu_oauth_broker.py"
)
_broker_spec = importlib.util.spec_from_file_location("l10n_feishu_oauth_broker", _BROKER_MODULE_PATH)
if not _broker_spec or not _broker_spec.loader:
    raise RuntimeError("Feishu OAuth broker module is unavailable")
broker = importlib.util.module_from_spec(_broker_spec)
_broker_spec.loader.exec_module(broker)


def _request(method: str, path: str, *, body: dict[str, Any] | None = None,
             device_token: str | None = None, idempotency_key: str | None = None) -> dict[str, Any]:
    base = broker.broker_base_url()
    url = f"{base}{path}"
    headers = {
        "Content-Type": "application/json; charset=utf-8",
        "X-Plugin-Version": os.environ.get("L10N_PLUGIN_VERSION", "1.5.0"),
    }
    installation_id = broker.load_installation_id()
    headers.update(broker._gateway_headers(installation_id, headers["X-Plugin-Version"]))  # noqa: SLF001
    if device_token:
        headers["Authorization"] = f"Bearer {device_token}"
        headers["X-L10N-Device-Session-Token"] = device_token
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=broker.HTTP_TIMEOUT_SECONDS) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as err:
        raw = err.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw)
        except Exception:  # noqa: BLE001
            payload = {"error": {"code": "broker_http_error", "message": f"HTTP {err.code}"}}
        raise RuntimeError(json.dumps(payload)) from err
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(json.dumps({"error": {"code": "broker_network_error", "message": str(exc)}})) from exc
    return json.loads(raw)


def create_run(payload: dict[str, Any]) -> dict[str, Any]:
    device_token = broker.load_device_session_token()
    return _request(
        "POST",
        "/v1/roi/runs",
        body=payload,
        device_token=device_token,
        idempotency_key=f"run:{payload.get('client_run_id')}:{secrets.token_hex(4)}",
    )


def submit_final(run_id: str, item_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    device_token = broker.load_device_session_token()
    return _request(
        "PUT",
        f"/v1/roi/runs/{run_id}/items/{item_id}/final",
        body=payload,
        device_token=device_token,
        idempotency_key=f"final:{run_id}:{item_id}:{payload.get('final_text_hash')}",
    )


def get_run_status(run_id: str) -> dict[str, Any]:
    device_token = broker.load_device_session_token()
    return _request("GET", f"/v1/roi/runs/{run_id}", device_token=device_token)


def request_archive(run_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    device_token = broker.load_device_session_token()
    return _request(
        "POST",
        f"/v1/roi/runs/{run_id}/archive",
        body=payload,
        device_token=device_token,
        idempotency_key=f"archive:{run_id}:{payload.get('expected_revision')}",
    )
