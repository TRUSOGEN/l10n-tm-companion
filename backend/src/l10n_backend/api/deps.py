"""FastAPI dependency wiring."""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import uuid
from dataclasses import dataclass
from typing import Any, Generator

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..adapters import CallerIdentity, FeishuAppCredentials
from ..adapters.factory import RuntimeAdapters, build_runtime_adapters
from ..config import Settings, get_settings
from ..domain.oauth import OAuthError, OAuthService
from ..domain.policy import load_policy_from_path
from ..domain.roi import RoiError, RoiService
from ..logging_utils import get_logger
from ..models import IdempotencyRecord
from ..models.db import session_scope

log = get_logger("api")


@dataclass
class RequestContext:
    request_id: str
    identity: CallerIdentity
    plugin_version: str
    settings: Settings
    adapters: RuntimeAdapters


def _parse_plugin_version(v: str) -> tuple[int, ...]:
    try:
        return tuple(int(p) for p in str(v or "").split(".") if p.strip())
    except Exception:  # noqa: BLE001
        return (0, 0, 0)


def _request_id(x_request_id: str | None) -> str:
    return (x_request_id or "").strip() or str(uuid.uuid4())


def _gateway_identity(settings: Settings, request: Request) -> CallerIdentity:
    subject = request.headers.get(settings.subject_header, "").strip()
    tenant = request.headers.get(settings.tenant_header, "").strip()
    strength = request.headers.get("x-l10n-auth-strength", "").strip() or "employee_sso"
    if subject and tenant:
        return CallerIdentity(subject_id=subject, tenant_id=tenant, auth_strength=strength)
    if settings.legacy_local_secret_dev_only:
        return CallerIdentity(
            subject_id=request.headers.get("x-dev-subject", "dev-user").strip(),
            tenant_id=request.headers.get("x-dev-tenant", "dev-tenant").strip(),
            auth_strength="dev",
        )
    raise HTTPException(status_code=401, detail=_error("identity_required", "Missing company gateway identity headers.", ""))


def _error(code: str, message: str, request_id: str, retryable: bool = False) -> dict[str, Any]:
    return {"error": {"code": code, "message": message, "request_id": request_id, "retryable": retryable}}


def _http_error(code: str, message: str, request_id: str, *, status: int = 400, retryable: bool = False) -> HTTPException:
    return HTTPException(status_code=status, detail=_error(code, message, request_id, retryable=retryable))


def get_settings_dep() -> Settings:
    return get_settings()


def db_session() -> Generator[Session, None, None]:
    with session_scope() as session:
        yield session


def _resolve_app_secret(adapters: RuntimeAdapters, settings: Settings) -> str:
    """Resolve Feishu app secret.

    In prod this MUST come from the Secret Manager adapter (which raises
    loudly until wired). In dev/test we fall back to the L10N_FEISHU_APP_SECRET
    environment variable through the EnvVarSecretProvider.
    """

    # If factory already built non-empty creds (dev happy-path), use them.
    if adapters.app_creds and adapters.app_creds.app_secret:
        return adapters.app_creds.app_secret
    # Try the secret provider by canonical name.
    try:
        secret = adapters.secret_provider.get_secret("feishu_app_secret")
    except RuntimeError:
        raise RuntimeError(
            "Feishu app secret could not be resolved. Production requires Secret Manager wiring."
        )
    if secret:
        return secret
    # Legacy direct env lookup as a last resort for local dev convenience.
    import os
    return os.environ.get("L10N_FEISHU_APP_SECRET", "").strip()


def context_dep(
    request: Request,
    x_request_id: str | None = Header(default=None),
    settings: Settings = Depends(get_settings_dep),
    db: Session = Depends(db_session),
) -> RequestContext:
    del db  # db dependency intentionally not used in context; retained for ordering
    identity = _gateway_identity(settings, request)
    plugin_version = request.headers.get("x-plugin-version", "").strip()
    if _parse_plugin_version(plugin_version) < _parse_plugin_version(settings.min_plugin_version):
        raise _http_error(
            "plugin_upgrade_required",
            "Plugin version is below the minimum required version; upgrade before continuing.",
            _request_id(x_request_id),
            status=426,
        )
    adapters = build_runtime_adapters(settings)
    req_id = _request_id(x_request_id)
    ctx = RequestContext(
        request_id=req_id,
        identity=identity,
        plugin_version=plugin_version,
        settings=settings,
        adapters=adapters,
    )
    request.state.context = ctx
    return ctx


def _device_token(request: Request) -> str:
    token = request.headers.get("x-l10n-device-session-token", "").strip()
    if not token:
        authz = request.headers.get("authorization", "")
        if authz.startswith("Bearer "):
            token = authz[len("Bearer "):].strip()
    return token


def oauth_service(db: Session = Depends(db_session), ctx: RequestContext = Depends(context_dep)) -> OAuthService:
    s = ctx.settings
    adapters = ctx.adapters
    app_secret = _resolve_app_secret(adapters, s)
    app_creds = FeishuAppCredentials(app_id=s.feishu_app_id, app_secret=app_secret)
    return OAuthService(
        db=db,
        settings=s,
        feishu=adapters.feishu_gateway,
        app_creds=app_creds,
        crypto=adapters.crypto,
    )


def roi_service(db: Session = Depends(db_session), ctx: RequestContext = Depends(context_dep)) -> RoiService:
    s = ctx.settings
    policy = load_policy_from_path(s.roi_policy_path)
    return RoiService(
        db=db,
        settings=s,
        policy=policy,
        crypto=ctx.adapters.crypto,
        starling=ctx.adapters.starling_gateway,
    )


class Idempotency:
    """Guard write endpoints with an Idempotency-Key contract."""

    def __init__(self, db: Session, ctx: RequestContext, request: Request, method: str) -> None:
        self.db = db
        self.ctx = ctx
        self.request = request
        self.method = method
        self.record: IdempotencyRecord | None = None

    def check(self, idem_key: str, payload: Any) -> None:
        if not idem_key:
            raise _http_error("idempotency_key_required", "Idempotency-Key header is required for write requests.", self.ctx.request_id, status=400)
        route = self.request.scope.get("route")
        canonical_path = route.path if route is not None else self.request.url.path
        payload_hash = hashlib.sha256(
            json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        ).hexdigest()
        existing = self.db.execute(
            select(IdempotencyRecord).where(
                IdempotencyRecord.key == idem_key,
                IdempotencyRecord.tenant_id == self.ctx.identity.tenant_id,
                IdempotencyRecord.subject_id == self.ctx.identity.subject_id,
                IdempotencyRecord.method == self.method,
                IdempotencyRecord.canonical_path == canonical_path,
            )
        ).scalar_one_or_none()
        now = dt.datetime.now(dt.timezone.utc)
        if existing is not None:
            if existing.payload_hash != payload_hash:
                raise _http_error(
                    "idempotency_payload_conflict",
                    "Idempotency-Key reused with a different payload.",
                    self.ctx.request_id,
                    status=409,
                )
            try:
                body = json.loads(existing.response_body)
            except Exception:  # noqa: BLE001
                body = {"message": existing.response_body}
            raise HTTPException(status_code=existing.response_status, detail=body, headers={"x-l10n-replayed": "true"})
        self.record = IdempotencyRecord(
            key=idem_key,
            tenant_id=self.ctx.identity.tenant_id,
            subject_id=self.ctx.identity.subject_id,
            method=self.method,
            canonical_path=canonical_path,
            payload_hash=payload_hash,
            response_status=200,
            response_body="",
            expires_at=now + dt.timedelta(days=30),
        )
        self.db.add(self.record)

    def finalize(self, status: int, body: Any) -> None:
        if self.record is None:
            return
        self.record.response_status = status
        self.record.response_body = json.dumps(body, ensure_ascii=False, default=str)


def oauth_to_http(exc: OAuthError, request_id: str) -> HTTPException:
    return _http_error(exc.code, str(exc), request_id, status=exc.status)


def roi_to_http(exc: RoiError, request_id: str) -> HTTPException:
    return _http_error(exc.code, str(exc), request_id, status=exc.status)
