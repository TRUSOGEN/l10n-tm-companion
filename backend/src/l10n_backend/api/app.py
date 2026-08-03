"""FastAPI application and route wiring."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..domain.oauth import OAuthError
from ..domain.roi import RoiError
from ..logging_utils import configure_logging, get_logger
from ..models import Base
from ..models.db import get_engine, init_engine
from ..schemas import (
    ArchiveAcceptedResponse,
    ArchiveRequest,
    CreateOAuthSessionRequest,
    CreateOAuthSessionResponse,
    CreateRoiRunRequest,
    CreateRoiRunResponse,
    ExchangeOAuthCodeRequest,
    ExchangeOAuthCodeResponse,
    FeishuUser,
    RefreshTokenRequest,
    RefreshTokenResponse,
    RevokeResponse,
    RoiRunStatus,
    SubmitFinalTextRequest,
    SubmitFinalTextResponse,
)
from .deps import (
    Idempotency,
    RequestContext,
    _device_token,
    _error,
    context_dep,
    db_session,
    oauth_service,
    oauth_to_http,
    roi_service,
    roi_to_http,
)

log = get_logger("app")


def create_app() -> FastAPI:
    settings: Settings = get_settings()
    configure_logging(settings.log_level)
    app = FastAPI(
        title="L10n TM Companion Broker",
        version="1.5.0",
        docs_url="/docs",
        openapi_url="/openapi.json",
    )

    @app.on_event("startup")
    def _startup() -> None:
        engine = init_engine(settings)
        if settings.database_url.startswith("sqlite"):
            Base.metadata.create_all(engine)

    @app.exception_handler(RequestValidationError)
    async def _validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        ctx: RequestContext | None = getattr(request.state, "context", None)
        request_id = ctx.request_id if ctx else ""
        return JSONResponse(
            status_code=400,
            content=_error("invalid_request", "Invalid request parameters", request_id),
        )

    @app.get("/healthz")
    def healthz() -> dict[str, Any]:
        return {"status": "ok", "service": "l10n-tm-companion-broker", "version": "1.5.0"}

    oauth_router = APIRouter(prefix="/v1/oauth", tags=["oauth"])
    roi_router = APIRouter(prefix="/v1/roi", tags=["roi"])

    # ------------------------- OAuth -------------------------
    @oauth_router.post(
        "/sessions",
        status_code=201,
        response_model=CreateOAuthSessionResponse,
        response_model_exclude_none=False,
    )
    def create_session(
        request: Request,
        response: Response,
        body: CreateOAuthSessionRequest,
        ctx: RequestContext = Depends(context_dep),
        db: Session = Depends(db_session),
        idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    ) -> CreateOAuthSessionResponse:
        idem = Idempotency(db, ctx, request, "POST")
        payload = body.model_dump()
        idem.check(idempotency_key or f"session:{body.installation_id}", payload)
        svc = oauth_service(db, ctx)
        try:
            sess, state, authorize_url = svc.create_session(
                subject_id=ctx.identity.subject_id,
                tenant_id=ctx.identity.tenant_id,
                installation_id=body.installation_id,
                redirect_uri=body.redirect_uri,
                code_challenge=body.code_challenge,
                plugin_version=ctx.plugin_version or body.plugin_version,
            )
            out = CreateOAuthSessionResponse(
                session_id=sess.session_id,
                state=state,
                authorize_url=authorize_url,
                expires_at=sess.expires_at,
            )
            idem.finalize(201, out.model_dump(mode="json"))
            response.status_code = 201
            return out
        except OAuthError as exc:
            raise oauth_to_http(exc, ctx.request_id) from exc
        except Exception as exc:  # noqa: BLE001
            log.exception("oauth_session_create_failed")
            return JSONResponse(
                status_code=503,
                content=_error("oauth_session_failed", "Could not create OAuth session", ctx.request_id, retryable=True),
            )

    @oauth_router.post(
        "/sessions/{session_id}/exchange",
        response_model=ExchangeOAuthCodeResponse,
    )
    def exchange(
        request: Request,
        session_id: str,
        body: ExchangeOAuthCodeRequest,
        ctx: RequestContext = Depends(context_dep),
        db: Session = Depends(db_session),
        installation_id: str | None = Header(default=None, alias="x-l10n-installation-id"),
    ) -> ExchangeOAuthCodeResponse:
        svc = oauth_service(db, ctx)
        if not installation_id:
            return JSONResponse(
                status_code=400,
                content=_error("installation_id_required", "x-l10n-installation-id header is required", ctx.request_id),
            )
        try:
            grant, _device, device_token, device_expires, user_info = svc.exchange_code(
                subject_id=ctx.identity.subject_id,
                tenant_id=ctx.identity.tenant_id,
                installation_id=installation_id,
                session_id=session_id,
                code=body.code,
                state=body.state,
                code_verifier=body.code_verifier,
            )
            access = svc._decrypt(grant.encrypted_access_token)
            return ExchangeOAuthCodeResponse(
                grant_id=grant.grant_id,
                device_session_token=device_token,
                device_session_expires_at=device_expires,
                user_access_token=access,
                access_expires_at=grant.access_expires_at,
                actual_scopes=list(grant.actual_scopes),
                user=FeishuUser(
                    open_id=user_info.get("open_id", ""),
                    user_id=user_info.get("user_id", ""),
                    name=user_info.get("name", ""),
                    avatar_url=user_info.get("avatar_url")
                    or user_info.get("avatar_big")
                    or user_info.get("avatar_middle")
                    or user_info.get("avatar_thumb")
                    or "",
                ),
            )
        except OAuthError as exc:
            raise oauth_to_http(exc, ctx.request_id) from exc
        except Exception as exc:  # noqa: BLE001
            log.exception("oauth_exchange_failed")
            return JSONResponse(
                status_code=503,
                content=_error("oauth_exchange_failed", "Token exchange failed", ctx.request_id, retryable=True),
            )

    @oauth_router.post(
        "/grants/{grant_id}/token",
        response_model=RefreshTokenResponse,
    )
    def refresh(
        request: Request,
        grant_id: str,
        body: RefreshTokenRequest,
        ctx: RequestContext = Depends(context_dep),
        db: Session = Depends(db_session),
    ) -> RefreshTokenResponse:
        svc = oauth_service(db, ctx)
        device_token = _device_token(request)
        try:
            dctx = svc.authenticate_device(
                subject_id=ctx.identity.subject_id,
                tenant_id=ctx.identity.tenant_id,
                device_session_token=device_token,
            )
            if dctx.grant_id != grant_id:
                return JSONResponse(
                    status_code=403,
                    content=_error("grant_access_denied", "Grant does not belong to this device session", ctx.request_id),
                )
            access, expires_at, version, scopes, reauth = svc.get_or_refresh_access_token(
                ctx=dctx, known_token_version=body.known_token_version or 0,
            )
            return RefreshTokenResponse(
                user_access_token=access,
                access_expires_at=expires_at,
                token_version=version,
                actual_scopes=scopes,
                reauthorization_required=reauth,
            )
        except OAuthError as exc:
            raise oauth_to_http(exc, ctx.request_id) from exc
        except Exception as exc:  # noqa: BLE001
            log.exception("oauth_refresh_failed")
            return JSONResponse(
                status_code=503,
                content=_error("oauth_refresh_failed", "Token refresh failed", ctx.request_id, retryable=True),
            )

    @oauth_router.delete(
        "/device-sessions/current",
        response_model=RevokeResponse,
        response_model_exclude_unset=True,
    )
    def revoke_device(
        request: Request,
        ctx: RequestContext = Depends(context_dep),
        db: Session = Depends(db_session),
    ) -> RevokeResponse:
        svc = oauth_service(db, ctx)
        device_token = _device_token(request)
        try:
            dctx = svc.authenticate_device(
                subject_id=ctx.identity.subject_id,
                tenant_id=ctx.identity.tenant_id,
                device_session_token=device_token,
            )
            svc.revoke_device_session(ctx=dctx)
            return RevokeResponse(device_session_status="revoked")
        except OAuthError as exc:
            raise oauth_to_http(exc, ctx.request_id) from exc

    @oauth_router.delete(
        "/grants/{grant_id}",
        status_code=202,
        response_model=RevokeResponse,
        response_model_exclude_unset=True,
    )
    def revoke_grant(
        request: Request,
        grant_id: str,
        ctx: RequestContext = Depends(context_dep),
        db: Session = Depends(db_session),
    ) -> RevokeResponse:
        svc = oauth_service(db, ctx)
        device_token = _device_token(request)
        dctx = svc.authenticate_device(
            subject_id=ctx.identity.subject_id,
            tenant_id=ctx.identity.tenant_id,
            device_session_token=device_token,
        )
        remote_status = svc.revoke_grant(ctx=dctx, grant_id=grant_id)
        return RevokeResponse(grant_status="revoked", remote_revoke_status=remote_status)

    # ------------------------- ROI -------------------------
    @roi_router.post(
        "/runs",
        status_code=201,
        response_model=CreateRoiRunResponse,
    )
    def create_run(
        request: Request,
        response: Response,
        body: CreateRoiRunRequest,
        ctx: RequestContext = Depends(context_dep),
        db: Session = Depends(db_session),
        idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    ) -> CreateRoiRunResponse:
        svc = roi_service(db, ctx)
        idem = Idempotency(db, ctx, request, "POST")
        payload = body.model_dump(mode="json")
        idem.check(idempotency_key or f"run:{body.client_run_id}", payload)
        try:
            run = svc.create_run(
                subject_id=ctx.identity.subject_id,
                tenant_id=ctx.identity.tenant_id,
                payload=payload,
            )
            out = CreateRoiRunResponse(
                run_id=run.run_id,
                revision=run.revision,
                a_state=run.a_state,
                review_state=run.review_state,
                c_state=run.c_state,
                archive_state=run.archive_state,
                policy_version=run.policy_version,
                locale_count=run.locale_count,
                accepted_item_count=run.accepted_item_count,
            )
            idem.finalize(201, out.model_dump(mode="json"))
            response.status_code = 201
            return out
        except RoiError as exc:
            raise roi_to_http(exc, ctx.request_id) from exc
        except Exception as exc:  # noqa: BLE001
            log.exception("roi_create_failed")
            return JSONResponse(
                status_code=503,
                content=_error("roi_run_create_failed", "Could not create ROI run", ctx.request_id, retryable=True),
            )

    @roi_router.put(
        "/runs/{run_id}/items/{item_id}/final",
        status_code=202,
        response_model=SubmitFinalTextResponse,
    )
    def submit_final(
        request: Request,
        response: Response,
        run_id: str,
        item_id: str,
        body: SubmitFinalTextRequest,
        ctx: RequestContext = Depends(context_dep),
        db: Session = Depends(db_session),
        idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    ) -> SubmitFinalTextResponse:
        svc = roi_service(db, ctx)
        osvc = oauth_service(db, ctx)
        osvc.authenticate_device(
            subject_id=ctx.identity.subject_id,
            tenant_id=ctx.identity.tenant_id,
            device_session_token=_device_token(request),
        )
        idem = Idempotency(db, ctx, request, "PUT")
        payload = body.model_dump(mode="json")
        idem.check(idempotency_key or f"final:{run_id}:{item_id}:{body.final_text_hash}", payload)
        try:
            _run, _item, revision = svc.submit_final(
                subject_id=ctx.identity.subject_id, run_id=run_id, item_id=item_id, payload=payload,
            )
            out = SubmitFinalTextResponse(run_id=run_id, item_id=item_id, revision=revision, c_state="queued")
            idem.finalize(202, out.model_dump(mode="json"))
            response.status_code = 202
            return out
        except OAuthError as exc:
            raise oauth_to_http(exc, ctx.request_id) from exc
        except RoiError as exc:
            raise roi_to_http(exc, ctx.request_id) from exc
        except Exception as exc:  # noqa: BLE001
            log.exception("roi_final_submit_failed")
            return JSONResponse(
                status_code=503,
                content=_error("roi_final_submit_failed", "Could not submit final C", ctx.request_id, retryable=True),
            )

    @roi_router.get("/runs/{run_id}", response_model=RoiRunStatus)
    def get_run(
        request: Request,
        run_id: str,
        ctx: RequestContext = Depends(context_dep),
        db: Session = Depends(db_session),
    ) -> RoiRunStatus:
        svc = roi_service(db, ctx)
        osvc = oauth_service(db, ctx)
        osvc.authenticate_device(
            subject_id=ctx.identity.subject_id,
            tenant_id=ctx.identity.tenant_id,
            device_session_token=_device_token(request),
        )
        try:
            data = svc.get_run_status(subject_id=ctx.identity.subject_id, run_id=run_id)
            return RoiRunStatus.model_validate(data)
        except RoiError as exc:
            raise roi_to_http(exc, ctx.request_id) from exc

    @roi_router.post(
        "/runs/{run_id}/archive",
        status_code=202,
        response_model=ArchiveAcceptedResponse,
    )
    def archive_run(
        request: Request,
        response: Response,
        run_id: str,
        body: ArchiveRequest,
        ctx: RequestContext = Depends(context_dep),
        db: Session = Depends(db_session),
        idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    ) -> ArchiveAcceptedResponse:
        svc = roi_service(db, ctx)
        osvc = oauth_service(db, ctx)
        osvc.authenticate_device(
            subject_id=ctx.identity.subject_id,
            tenant_id=ctx.identity.tenant_id,
            device_session_token=_device_token(request),
        )
        idem = Idempotency(db, ctx, request, "POST")
        payload = body.model_dump(mode="json")
        idem.check(idempotency_key or f"archive:{run_id}:{body.expected_revision}", payload)
        try:
            run, snap = svc.request_archive(
                subject_id=ctx.identity.subject_id, run_id=run_id, payload=payload,
            )
            out = ArchiveAcceptedResponse(
                run_id=run.run_id,
                archive_state=run.archive_state,
                snapshot_id=snap.snapshot_id,
                status_url=f"/v1/roi/runs/{run.run_id}",
            )
            idem.finalize(202, out.model_dump(mode="json"))
            response.status_code = 202
            return out
        except RoiError as exc:
            raise roi_to_http(exc, ctx.request_id) from exc
        except Exception as exc:  # noqa: BLE001
            log.exception("roi_archive_failed")
            return JSONResponse(
                status_code=503,
                content=_error("roi_archive_failed", "Could not accept archive request", ctx.request_id, retryable=True),
            )

    app.include_router(oauth_router)
    app.include_router(roi_router)
    return app


app = create_app()
