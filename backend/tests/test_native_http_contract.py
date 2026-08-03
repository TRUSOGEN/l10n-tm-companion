"""Phase B: Native-host <-> backend HTTP contract tests.

These tests start the FastAPI TestClient on a real thread/socket and call the
native-host Python client through urllib to validate the wire contract
(URLs, headers, idempotency keys, JSON payloads, success + error shapes).
Keychain access is monkey-patched because these tests run on Linux CI.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import socket
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
NATIVE = ROOT.parent / "native-host"
for p in (SRC, NATIVE):
    sp = str(p)
    if sp not in sys.path:
        sys.path.insert(0, sp)

# Dev-only flags for the backend; native client dev headers will be sent via patched gateway header logic.
os.environ.setdefault("L10N_OAUTH_BROKER_ENABLED", "true")
os.environ.setdefault("L10N_ASYNC_ROI_ENABLED", "true")
os.environ.setdefault("L10N_LEGACY_LOCAL_SECRET_DEV_ONLY", "true")
os.environ.setdefault("L10N_FEISHU_APP_SECRET", "test-app-secret")
os.environ.setdefault("L10N_ROI_POLICY_PATH", str(ROOT / "config" / "policy.example.json"))
os.environ.setdefault("L10N_PLUGIN_VERSION", "1.5.0")
os.environ.setdefault("L10N_LOCAL_SECRET_DEV_ONLY", "1")
for _proxy_key in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "all_proxy"):
    os.environ.pop(_proxy_key, None)


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _serve(app, host: str, port: int) -> HTTPServer:
    from fastapi.testclient import TestClient

    # Reuse Starlette/FastAPI ASGI app via a tiny WSGI/HTTP adapter? Simpler: use FastAPI TestClient with a threading WSGI?
    # Use a raw http.server that proxies to the ASGI TestClient transport.
    client = TestClient(app, raise_server_exceptions=False)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format, *args):  # noqa: A003
            return

        def _forward(self):
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b""
            headers = {k: v for k, v in self.headers.items()}
            with client as tc:
                method = self.command
                url = self.path
                if method == "GET":
                    resp = tc.get(url, headers=headers)
                elif method == "POST":
                    body = json.loads(raw.decode("utf-8")) if raw else None
                    resp = tc.post(url, headers=headers, json=body)
                elif method == "PUT":
                    body = json.loads(raw.decode("utf-8")) if raw else None
                    resp = tc.put(url, headers=headers, json=body)
                elif method == "DELETE":
                    resp = tc.delete(url, headers=headers)
                else:
                    self.send_response(405)
                    self.end_headers()
                    return
                payload = resp.content
                self.send_response(resp.status_code)
                for k, v in resp.headers.items():
                    lower = k.lower()
                    if lower in {"content-encoding", "transfer-encoding", "connection"}:
                        continue
                    self.send_header(k, v)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                if payload:
                    self.wfile.write(payload)

        def do_GET(self):  # noqa: N802
            self._forward()

        def do_POST(self):  # noqa: N802
            self._forward()

        def do_PUT(self):  # noqa: N802
            self._forward()

        def do_DELETE(self):  # noqa: N802
            self._forward()

    httpd = HTTPServer((host, port), Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd


import l10n_backend.config as cfg_mod  # noqa: E402
from l10n_backend.adapters import FeishuAppCredentials  # noqa: E402
from l10n_backend.api import app as app_module  # noqa: E402
from l10n_backend.api import deps as deps_module  # noqa: E402
from l10n_backend.api.app import create_app  # noqa: E402
from l10n_backend.crypto import InsecureDevEnvelopeCrypto  # noqa: E402
from l10n_backend.domain.oauth import OAuthService  # noqa: E402
from l10n_backend.models import Base  # noqa: E402
import feishu_oauth_broker  # noqa: E402
import roi_broker_client  # noqa: E402


def _patch_keychain(monkeypatch, *, installation_id: str, token_getter, token_setter):
    """Replace macOS security CLI helpers with in-memory stubs so contract tests run on Linux."""
    def fake_run(args, **kwargs):
        class _Result:
            def __init__(self, returncode, stdout=""):
                self.returncode = returncode
                self.stdout = stdout
        if not args:
            return _Result(1)
        op = args[2] if len(args) >= 3 else ""
        if op == "find-generic-password" and "installation-id" in args:
            out = installation_id or ""
            return _Result(0 if out else 1, out)
        if op == "find-generic-password" and "device-session-token" in args:
            out = token_getter()
            return _Result(0 if out else 1, out)
        return _Result(0, "")
    monkeypatch.setattr(feishu_oauth_broker, "_keychain_run", fake_run)
    monkeypatch.setattr(roi_broker_client.broker, "_keychain_run", fake_run)
    # roi_broker_client imports broker module internally through its local `broker` name;
    # patch module-level attribute accesses as well in case it reads load_* helpers directly.
    monkeypatch.setattr(roi_broker_client.broker, "load_installation_id", lambda: installation_id)
    monkeypatch.setattr(roi_broker_client.broker, "load_device_session_token", lambda: token_getter())


class _FakeGateway:
    def __init__(self, settings):
        self.settings = settings

    def exchange_code(self, creds, *, code, redirect_uri, code_verifier):
        return {
            "access_token": "u-http",
            "refresh_token": "r-http",
            "expires_in": 7200,
            "scope": "offline_access sheets:spreadsheet.meta:read sheets:spreadsheet:read sheets:spreadsheet:write_only wiki:node:read base:table:read base:table:create base:field:read base:field:create base:record:read base:record:retrieve base:record:create base:record:update base:view:read base:view:write_only contact:user.base:readonly contact:user.employee_id:readonly",
        }

    def refresh_token(self, creds, *, refresh_token):
        return {"access_token": "u-http-ref", "refresh_token": "r-http-ref", "expires_in": 7200}

    def revoke_refresh_token(self, creds, *, refresh_token):
        return {"status": "success"}

    def user_info(self, access_token):
        return {"open_id": "oid-http", "user_id": "uid-http", "name": "HTTP Tester", "avatar_url": ""}


def _make_app(db_dir: Path):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from l10n_backend.models import db as db_mod

    db_path = db_dir / "contract.db"
    engine = create_engine(f"sqlite:///{db_path}", future=True, connect_args={"check_same_thread": False})
    db_mod._engine = engine
    db_mod._SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    settings = cfg_mod.Settings(database_url=f"sqlite:///{db_path}")
    cfg_mod.get_settings = lambda: settings
    db_mod.init_engine = lambda s=None: engine
    Base.metadata.create_all(engine)

    gw = _FakeGateway(settings)

    def fake_oauth_service(db, ctx):
        return OAuthService(
            db=db,
            settings=ctx.settings,
            feishu=gw,
            app_creds=FeishuAppCredentials(app_id=ctx.settings.feishu_app_id, app_secret="test-app-secret"),
            crypto=InsecureDevEnvelopeCrypto(),
        )

    deps_module.oauth_service = fake_oauth_service
    app_module.oauth_service = fake_oauth_service
    app = create_app()
    app_module.oauth_service = fake_oauth_service
    return app


def test_native_http_contract_oauth_create_submit_archive(tmp_path, monkeypatch):
    port = _free_port()
    base_url = f"http://127.0.0.1:{port}"
    monkeypatch.setenv("L10N_BROKER_BASE_URL", base_url)
    monkeypatch.setenv("L10N_PLUGIN_VERSION", "1.5.0")
    monkeypatch.setenv("L10N_DEV_SUBJECT", "subject-http")
    monkeypatch.setenv("L10N_DEV_TENANT", "tenant-http")

    # Patch keychain helpers so we don't hit macOS security tooling.
    installation_id = "inst-http"
    device_token_holder = {"token": ""}
    _patch_keychain(
        monkeypatch,
        installation_id=installation_id,
        token_getter=lambda: device_token_holder["token"],
        token_setter=lambda token: device_token_holder.__setitem__("token", token),
    )
    # Force dev-only gateway header path even when module-level LEGACY_LOCAL_SECRET_DEV_ONLY was imported before env set.
    monkeypatch.setattr(feishu_oauth_broker, "LEGACY_LOCAL_SECRET_DEV_ONLY", True, raising=False)

    httpd = _serve(_make_app(tmp_path), "127.0.0.1", port)
    try:
        # OAuth create session + exchange through native broker module.
        verifier = feishu_oauth_broker.create_code_verifier() if hasattr(feishu_oauth_broker, "create_code_verifier") else _pkce_verifier()
        if not hasattr(feishu_oauth_broker, "create_code_verifier"):
            # fallback import-safe verifier (base64url 32 bytes)
            import secrets as _secrets
            import base64 as _b64
            verifier = _b64.urlsafe_b64encode(_secrets.token_bytes(32)).rstrip(b"=").decode("ascii")
        challenge = feishu_oauth_broker.build_code_challenge(verifier)
        sess = feishu_oauth_broker.create_broker_session(
            code_challenge=challenge,
            plugin_version="1.5.0",
            installation_id=installation_id,
            request_id="http-1",
        )
        assert sess["session_id"]
        assert sess["authorize_url"].startswith("https://")
        ex = feishu_oauth_broker.exchange_broker_code(
            session_id=sess["session_id"],
            code="auth-code-http",
            state=sess["state"],
            code_verifier=verifier,
            installation_id=installation_id,
            plugin_version="1.5.0",
        )
        assert ex["device_session_token"]
        assert ex["user"]["open_id"] == "oid-http"
        # save token into fake keychain for subsequent roi client calls
        device_token_holder["token"] = ex["device_session_token"]

        from l10n_backend.crypto import sha256_hex
        run_body = {
            "client_run_id": f"native-http-{int(time.time()*1000)}",
            "started_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "sheet": {"document_token": "sht-http", "sheet_id": "sh-http", "source_range": "A2:A3"},
            "projects": [{"project_id": "278", "name": "TikTok_main"}],
            "display_scope": {"source_locale": "en", "target_locale": "fr", "project_ids": ["278"]},
            "items": [
                {
                    "item_id": "row-2",
                    "source_key": "key-2",
                    "sheet_row": 2,
                    "source_text": "Book your flight today.",
                    "source_hash": sha256_hex("Book your flight today."),
                }
            ],
        }
        run = roi_broker_client.create_run(run_body)
        assert run["run_id"]
        assert run["revision"] == 1
        final_text = "Book your flight now."
        final_hash = sha256_hex(final_text)
        submitted = roi_broker_client.submit_final(run["run_id"], "row-2", {
            "expected_revision": run["revision"],
            "final_text": final_text,
            "final_text_hash": final_hash,
            "confirmed_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "sheet_write_receipt": {
                "document_token": "sht-http",
                "sheet_id": "sh-http",
                "row": 2,
                "output_range": "B2:G2",
                "output_hash": sha256_hex(final_text + ":written"),
            },
        })
        assert submitted["revision"] >= 2
        # Worker shadow is not auto-run through TestClient here; the broker archive endpoint accepts requests
        # with expected_revision and returns queued / incomplete while async processing is pending.
        arch = roi_broker_client.request_archive(run["run_id"], {
            "expected_revision": submitted["revision"],
            "requested_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        })
        assert arch["run_id"] == run["run_id"]
        assert arch["archive_state"] in {"queued", "incomplete", "complete", "pending"}
        status = roi_broker_client.get_run_status(run["run_id"])
        assert status["run_id"] == run["run_id"]
        assert status["revision"] >= submitted["revision"]
    finally:
        httpd.shutdown()
        httpd.server_close()


def _pkce_verifier() -> str:
    import base64
    import secrets
    return base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode("ascii")
