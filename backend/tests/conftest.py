"""Shared test fixtures."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

# Enable dev-only legacy path and flags for the in-process tests.
os.environ.setdefault("L10N_ENV", "test")
os.environ.setdefault("L10N_OAUTH_BROKER_ENABLED", "true")
os.environ.setdefault("L10N_ASYNC_ROI_ENABLED", "true")
os.environ.setdefault("L10N_LEGACY_LOCAL_SECRET_DEV_ONLY", "true")
os.environ.setdefault("L10N_ROI_POLICY_PATH", str(ROOT / "config" / "policy.example.json"))
os.environ.setdefault("L10N_FEISHU_APP_SECRET", "test-app-secret")
os.environ.setdefault("L10N_DATABASE_URL", "sqlite:///:memory:")

from l10n_backend.api import deps as deps_module  # noqa: E402
from l10n_backend.adapters import FeishuAppCredentials  # noqa: E402
from l10n_backend.adapters.factory import RuntimeAdapters  # noqa: E402
from l10n_backend.api.app import create_app  # noqa: E402
from l10n_backend.crypto import InsecureDevEnvelopeCrypto  # noqa: E402
from l10n_backend.domain.oauth import OAuthService  # noqa: E402
from l10n_backend.models import Base  # noqa: E402
from l10n_backend.workers.roi_worker import InMemoryStarlingGateway  # noqa: E402


class FakeFeishuGateway:
    def __init__(self, settings):
        self.settings = settings
        self.exchange_calls = 0
        self.refresh_calls = 0
        self.revoke_calls = 0
        self.user_calls = 0
        self.next_refresh_failure = False

    def exchange_code(self, creds, *, code, redirect_uri, code_verifier):
        self.exchange_calls += 1
        return {
            "access_token": "u-1",
            "refresh_token": "r-1",
            "expires_in": 7200,
            "scope": "offline_access sheets:spreadsheet.meta:read sheets:spreadsheet:read sheets:spreadsheet:write_only wiki:node:read base:table:read base:table:create base:field:read base:field:create base:record:read base:record:retrieve base:record:create base:record:update base:view:read base:view:write_only contact:user.base:readonly contact:user.employee_id:readonly",
        }

    def refresh_token(self, creds, *, refresh_token):
        self.refresh_calls += 1
        if self.next_refresh_failure:
            self.next_refresh_failure = False
            raise RuntimeError("upstream exploded")
        return {
            "access_token": f"u-refreshed-{self.refresh_calls}",
            "refresh_token": f"r-refreshed-{self.refresh_calls}",
            "expires_in": 7200,
        }

    def revoke_refresh_token(self, creds, *, refresh_token):
        self.revoke_calls += 1
        return {"status": "success"}

    def user_info(self, access_token):
        self.user_calls += 1
        return {"open_id": "oid-1", "user_id": "uid-1", "name": "Tester", "avatar_url": ""}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    for key in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "all_proxy"):
        monkeypatch.delenv(key, raising=False)
    db_path = tmp_path / "test.db"
    monkeypatch.setenv("L10N_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("L10N_ENV", "test")

    engine = create_engine(f"sqlite:///{db_path}", future=True, connect_args={"check_same_thread": False})
    import l10n_backend.models.db as db_mod
    db_mod._engine = engine
    db_mod._SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    from l10n_backend.config import Settings
    import l10n_backend.config as cfg_mod
    settings = Settings(database_url=f"sqlite:///{db_path}", env_name="test")
    cfg_mod.get_settings = lambda: settings
    db_mod.init_engine = lambda s=None: engine
    Base.metadata.create_all(engine)

    gw = FakeFeishuGateway(settings)
    crypto = InsecureDevEnvelopeCrypto()
    starling = InMemoryStarlingGateway()

    test_adapters = RuntimeAdapters(
        feishu_gateway=gw,
        crypto=crypto,
        starling_gateway=starling,
        secret_provider=type("EnvLike", (), {"get_secret": staticmethod(lambda name: "test-app-secret" if name == "feishu_app_secret" else "")})(),
        feishu_gateway_adapter=None,
        app_creds=FeishuAppCredentials(app_id=settings.feishu_app_id, app_secret="test-app-secret"),
    )

    import l10n_backend.adapters.factory as factory_mod
    monkeypatch.setattr(factory_mod, "build_runtime_adapters", lambda s: test_adapters)

    _original_oauth_service = deps_module.oauth_service

    def fake_oauth_service(db, ctx):
        return OAuthService(
            db=db,
            settings=ctx.settings,
            feishu=gw,
            app_creds=FeishuAppCredentials(app_id=ctx.settings.feishu_app_id, app_secret="test-app-secret"),
            crypto=crypto,
        )

    deps_module.oauth_service = fake_oauth_service
    from l10n_backend.api import app as app_module
    app_module.oauth_service = fake_oauth_service
    app = create_app()
    app_module.oauth_service = fake_oauth_service
    with TestClient(app) as c:
        c.headers.update({
            "x-dev-subject": "subject-1",
            "x-dev-tenant": "tenant-1",
            "x-plugin-version": "1.5.0",
        })
        yield c
    deps_module.oauth_service = _original_oauth_service
