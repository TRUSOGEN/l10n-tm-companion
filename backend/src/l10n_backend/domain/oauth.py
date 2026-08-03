"""OAuth Broker service layer.

Implements the security-critical flows in contract order: session create,
code exchange, device session issuance, token refresh (serialized per grant
with ``refreshing → active | refresh_uncertain`` state machine), remote
revoke, and audit logging.
"""

from __future__ import annotations

import datetime as dt
import hashlib
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..adapters import FeishuAppCredentials, FeishuGateway
from ..config import Settings
from ..crypto import (
    InsecureDevEnvelopeCrypto,
    EnvelopeCiphertext,
    constant_time_equal,
    generate_device_session_token,
    generate_uuid7_like,
    hash_device_token,
)
from ..logging_utils import get_logger
from ..models import (
    AuditEvent,
    OAuthDeviceSession,
    OAuthGrant,
    OAuthSession,
)
from ..models.entities import _utcnow, _ensure_utc

log = get_logger("oauth")


class OAuthError(RuntimeError):
    """Safe, user-facing OAuth error with a stable code."""

    def __init__(self, code: str, message: str, *, status: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


@dataclass
class DeviceSessionContext:
    subject_id: str
    tenant_id: str
    grant_id: str
    installation_id: str
    device_session_id: str


class OAuthService:
    """Coordinate OAuth session/grant/device-session transactions."""

    def __init__(
        self,
        db: Session,
        settings: Settings,
        feishu: FeishuGateway,
        app_creds: FeishuAppCredentials,
        crypto: InsecureDevEnvelopeCrypto,
    ) -> None:
        self.db = db
        self.settings = settings
        self.feishu = feishu
        self.app_creds = app_creds
        self.crypto = crypto

    # ---------- helpers ----------
    def _audit(self, *, tenant_id: str, subject_id: str, action: str, **extra: Any) -> None:
        subj_hash = hashlib.sha256(subject_id.encode("utf-8")).hexdigest()
        self.db.add(
            AuditEvent(
                tenant_id=tenant_id,
                subject_id_hash=subj_hash,
                action=action,
                metadata=extra or {},
            )
        )

    def _encrypt(self, plaintext: str) -> dict[str, Any]:
        bundle = self.crypto.encrypt(plaintext)
        return bundle.__dict__

    def _decrypt(self, blob: dict[str, Any]) -> str:
        return self.crypto.decrypt(EnvelopeCiphertext(**blob))

    # ---------- session ----------
    def create_session(
        self,
        *,
        subject_id: str,
        tenant_id: str,
        installation_id: str,
        redirect_uri: str,
        code_challenge: str,
        plugin_version: str,
    ) -> tuple[OAuthSession, str, str]:
        if not self.settings.oauth_broker_enabled:
            raise OAuthError("feature_disabled", "OAuth broker is not enabled", status=503)
        if redirect_uri not in self.settings.feishu_redirect_allowlist:
            raise OAuthError("invalid_redirect_uri", "redirect_uri is not in the allowlist")
        state = hashlib.sha256(generate_device_session_token().encode("ascii")).hexdigest()[:32]
        now = _utcnow()
        expires = now + dt.timedelta(seconds=self.settings.oauth_session_ttl_seconds)
        session = OAuthSession(
            session_id=generate_uuid7_like(),
            owner_subject_id=subject_id,
            tenant_id=tenant_id,
            installation_id=installation_id,
            redirect_uri=redirect_uri,
            state_hash=hashlib.sha256(state.encode("ascii")).hexdigest(),
            code_challenge=code_challenge,
            requested_scopes=list(self.settings.feishu_required_scopes),
            plugin_version=plugin_version,
            status="pending",
            expires_at=expires,
        )
        self.db.add(session)
        self._audit(
            tenant_id=tenant_id,
            subject_id=subject_id,
            action="oauth_session_create",
            session_id=session.session_id,
            installation_id=installation_id,
        )
        # Broker-issued authorize_url uses the Feishu app with PKCE; offline_access
        # is requested along with all user scopes per contract.
        from urllib.parse import urlencode

        params = urlencode(
            {
                "client_id": self.app_creds.app_id,
                "redirect_uri": redirect_uri,
                "response_type": "code",
                "scope": " ".join(self.settings.feishu_required_scopes),
                "state": state,
                "code_challenge": code_challenge,
                "code_challenge_method": "S256",
                "prompt": "consent",
            }
        )
        authorize_url = f"{self.settings.feishu_oauth_authorize_url}?{params}"
        return session, state, authorize_url

    def _lock_session(self, session_id: str) -> OAuthSession:
        sess = self.db.execute(
            select(OAuthSession).where(OAuthSession.session_id == session_id).with_for_update()
        ).scalar_one_or_none()
        if sess is None:
            raise OAuthError("session_not_found", "OAuth session was not found", status=404)
        return sess

    def exchange_code(
        self,
        *,
        subject_id: str,
        tenant_id: str,
        installation_id: str,
        session_id: str,
        code: str,
        state: str,
        code_verifier: str,
    ) -> tuple[OAuthGrant, OAuthDeviceSession, str, dt.datetime, dict]:
        sess = self._lock_session(session_id)
        now = _utcnow()
        if sess.owner_subject_id != subject_id or sess.tenant_id != tenant_id:
            raise OAuthError("session_subject_mismatch", "session owner mismatch", status=403)
        if sess.installation_id != installation_id:
            raise OAuthError("installation_mismatch", "installation_id does not match session", status=403)
        if _ensure_utc(sess.expires_at) < now or sess.status == "expired":
            sess.status = "expired"
            raise OAuthError("session_expired", "OAuth session expired; start over", status=400)
        if sess.status != "pending":
            # Idempotency/replay: if already exchanging/complete/exchange_uncertain, refuse.
            if sess.status == "complete":
                raise OAuthError("session_already_used", "OAuth session is single-use", status=409)
            if sess.status == "exchange_uncertain":
                raise OAuthError(
                    "oauth_reauthorization_required",
                    "Token exchange is in an uncertain state; please reauthorize.",
                    status=409,
                )
            raise OAuthError("session_busy", "Token exchange already in progress", status=409)
        # state
        state_hash = hashlib.sha256(state.encode("ascii")).hexdigest()
        if not constant_time_equal(state_hash, sess.state_hash):
            raise OAuthError("state_mismatch", "OAuth callback state mismatch")
        # PKCE S256 check recomputed on server
        from ..crypto import base64url_sha256

        expected = base64url_sha256(code_verifier.encode("ascii"))
        if not constant_time_equal(expected, sess.code_challenge):
            raise OAuthError("pkce_mismatch", "PKCE code_verifier does not match challenge")

        # Mark exchanging BEFORE network call to detect crash windows.
        sess.status = "exchanging"
        self.db.flush()

        try:
            token = self.feishu.exchange_code(
                self.app_creds,
                code=code,
                redirect_uri=sess.redirect_uri,
                code_verifier=code_verifier,
            )
        except Exception as exc:  # noqa: BLE001
            # Network/HTTP failures leave session in exchanging; recovery job
            # will mark exchange_uncertain after timeout.
            log.warning("oauth_exchange_failed", error=str(exc))
            raise OAuthError("oauth_exchange_failed", "Feishu token exchange failed", status=503) from exc

        granted = str(token.get("scope") or "")
        granted_set = set(granted.split())
        required = set(self.settings.feishu_required_scopes)
        missing = sorted(required - granted_set)
        if missing:
            sess.status = "pending"  # revert; can retry once (real apps should force re-auth)
            raise OAuthError(
                "oauth_scope_missing",
                "Feishu did not grant required scopes: " + ",".join(missing),
                status=403,
            )

        access_token = str(token["access_token"])
        refresh_token = str(token.get("refresh_token") or "")
        if not refresh_token:
            raise OAuthError("oauth_refresh_missing", "Feishu did not return a refresh token", status=503)
        expires_in = int(token.get("expires_in") or 7200)
        access_expires = now + dt.timedelta(seconds=max(60, expires_in))

        # Fetch user profile.
        try:
            user_info = self.feishu.user_info(access_token)
        except Exception as exc:  # noqa: BLE001
            log.warning("oauth_user_info_failed", error=str(exc))
            raise OAuthError("oauth_user_info_failed", "Could not read Feishu user profile", status=503) from exc

        grant = OAuthGrant(
            grant_id=generate_uuid7_like(),
            owner_subject_id=subject_id,
            tenant_id=tenant_id,
            feishu_open_id=str(user_info.get("open_id") or ""),
            feishu_user_id=str(user_info.get("user_id") or ""),
            feishu_name=str(user_info.get("name") or ""),
            actual_scopes=sorted(granted_set),
            encrypted_access_token=self._encrypt(access_token),
            access_expires_at=access_expires,
            encrypted_refresh_token=self._encrypt(refresh_token),
            token_version=1,
            status="active",
        )
        self.db.add(grant)

        device_token = generate_device_session_token()
        device_expires = now + dt.timedelta(days=self.settings.device_session_ttl_days)
        device = OAuthDeviceSession(
            device_session_id=generate_uuid7_like(),
            grant_id=grant.grant_id,
            owner_subject_id=subject_id,
            tenant_id=tenant_id,
            installation_id=installation_id,
            token_hash=hash_device_token(device_token),
            expires_at=device_expires,
        )
        self.db.add(device)

        sess.status = "complete"
        sess.exchanged_at = now

        self._audit(
            tenant_id=tenant_id,
            subject_id=subject_id,
            action="oauth_exchange_complete",
            session_id=sess.session_id,
            grant_id=grant.grant_id,
            device_session_id=device.device_session_id,
        )
        return grant, device, device_token, device_expires, user_info

    # ---------- device session ----------
    def authenticate_device(
        self,
        *,
        subject_id: str,
        tenant_id: str,
        device_session_token: str,
    ) -> DeviceSessionContext:
        token_hash = hash_device_token(device_session_token)
        now = _utcnow()
        row = self.db.execute(
            select(OAuthDeviceSession).where(OAuthDeviceSession.token_hash == token_hash).with_for_update()
        ).scalar_one_or_none()
        if row is None or row.revoked_at is not None or _ensure_utc(row.expires_at) < now:
            raise OAuthError("invalid_device_session", "Device session is invalid or expired", status=401)
        if row.owner_subject_id != subject_id or row.tenant_id != tenant_id:
            raise OAuthError("subject_device_mismatch", "Device session does not match caller", status=403)
        grant = self.db.get(OAuthGrant, row.grant_id)
        if grant is None or grant.status == "revoked":
            raise OAuthError("grant_revoked", "OAuth grant has been revoked", status=401)
        return DeviceSessionContext(
            subject_id=subject_id,
            tenant_id=tenant_id,
            grant_id=grant.grant_id,
            installation_id=row.installation_id,
            device_session_id=row.device_session_id,
        )

    def get_or_refresh_access_token(
        self,
        *,
        ctx: DeviceSessionContext,
        known_token_version: int,
    ) -> tuple[str, dt.datetime, int, list[str], bool]:
        # Serialize per grant via SELECT ... FOR UPDATE.
        grant = self.db.execute(
            select(OAuthGrant).where(OAuthGrant.grant_id == ctx.grant_id).with_for_update()
        ).scalar_one_or_none()
        if grant is None:
            raise OAuthError("grant_not_found", "OAuth grant no longer exists", status=404)
        if grant.status == "revoked":
            return ("", _utcnow(), grant.token_version, list(grant.actual_scopes), True)
        if grant.status == "refresh_uncertain":
            return ("", _utcnow(), grant.token_version, list(grant.actual_scopes), True)
        now = _utcnow()
        skew = dt.timedelta(seconds=self.settings.access_token_refresh_skew_seconds)
        # If still valid, return cached token.
        if _ensure_utc(grant.access_expires_at) - skew > now and grant.status == "active":
            return (
                self._decrypt(grant.encrypted_access_token),
                grant.access_expires_at,
                grant.token_version,
                list(grant.actual_scopes),
                False,
            )
        # Need refresh. If another concurrent request already set refreshing,
        # wait in a tight bounded loop for it to resolve.
        attempt_start = now
        deadline = now + dt.timedelta(seconds=self.settings.refresh_lock_timeout_seconds)
        while grant.status == "refreshing" and _utcnow() < deadline:
            self.db.flush()
            self.db.commit()
            import time

            time.sleep(0.1)
            self.db.refresh(grant)
        if grant.status == "active" and _ensure_utc(grant.access_expires_at) - skew > _utcnow()():
            return (
                self._decrypt(grant.encrypted_access_token),
                grant.access_expires_at,
                grant.token_version,
                list(grant.actual_scopes),
                False,
            )
        if grant.status in {"refresh_uncertain", "revoked"}:
            return ("", _utcnow(), grant.token_version, list(grant.actual_scopes), True)

        # We become the refresher.
        grant.status = "refreshing"
        grant.refresh_attempt_id = generate_uuid7_like()
        grant.refresh_started_at = _utcnow()
        self.db.flush()
        refresh_token = self._decrypt(grant.encrypted_refresh_token)
        try:
            token = self.feishu.refresh_token(self.app_creds, refresh_token=refresh_token)
        except Exception as exc:  # noqa: BLE001
            log.warning("oauth_refresh_failed", error=str(exc))
            # Mark uncertain and ask for reauthorization — we cannot prove
            # whether Feishu rotated the refresh token before failure.
            grant.status = "refresh_uncertain"
            self._audit(
                tenant_id=ctx.tenant_id,
                subject_id=ctx.subject_id,
                action="oauth_refresh_uncertain",
                grant_id=grant.grant_id,
                error=str(exc)[:120],
            )
            raise OAuthError(
                "oauth_reauthorization_required",
                "Token refresh is in an uncertain state; please reauthorize.",
                status=401,
            ) from exc
        new_access = str(token["access_token"])
        new_refresh = str(token.get("refresh_token") or refresh_token)
        expires_in = int(token.get("expires_in") or 7200)
        new_expires = _utcnow() + dt.timedelta(seconds=max(60, expires_in))
        grant.encrypted_access_token = self._encrypt(new_access)
        grant.encrypted_refresh_token = self._encrypt(new_refresh)
        grant.access_expires_at = new_expires
        grant.token_version = (grant.token_version or known_token_version) + 1
        grant.status = "active"
        grant.refresh_attempt_id = None
        grant.refresh_started_at = None
        self._audit(
            tenant_id=ctx.tenant_id,
            subject_id=ctx.subject_id,
            action="oauth_refresh_success",
            grant_id=grant.grant_id,
            token_version=grant.token_version,
        )
        return new_access, new_expires, grant.token_version, list(grant.actual_scopes), False

    def revoke_device_session(
        self, *, ctx: DeviceSessionContext
    ) -> None:
        device = self.db.get(OAuthDeviceSession, ctx.device_session_id)
        if device is None:
            raise OAuthError("device_session_not_found", "Device session not found", status=404)
        device.revoked_at = _utcnow()
        self._audit(
            tenant_id=ctx.tenant_id,
            subject_id=ctx.subject_id,
            action="oauth_device_revoke",
            grant_id=ctx.grant_id,
            device_session_id=ctx.device_session_id,
        )

    def revoke_grant(self, *, ctx: DeviceSessionContext, grant_id: str) -> str:
        if ctx.grant_id != grant_id:
            raise OAuthError("grant_access_denied", "Cannot revoke another grant", status=403)
        grant = self.db.get(OAuthGrant, grant_id)
        if grant is None:
            raise OAuthError("grant_not_found", "Grant not found", status=404)
        grant.status = "revoked"
        grant.revoked_at = _utcnow()
        # Revoke all devices for this grant.
        devices = self.db.execute(
            select(OAuthDeviceSession).where(OAuthDeviceSession.grant_id == grant_id)
        ).scalars().all()
        for d in devices:
            if d.revoked_at is None:
                d.revoked_at = _utcnow()
        # Best-effort remote revoke; status tracked but never blocks local revoke.
        remote_status = "not_attempted"
        try:
            refresh_token = self._decrypt(grant.encrypted_refresh_token)
            result = self.feishu.revoke_refresh_token(self.app_creds, refresh_token=refresh_token)
            remote_status = "success" if result else "failed"
        except Exception as exc:  # noqa: BLE001
            log.warning("oauth_remote_revoke_failed", error=str(exc))
            remote_status = "failed"
        grant.remote_revoke_status = remote_status
        self._audit(
            tenant_id=ctx.tenant_id,
            subject_id=ctx.subject_id,
            action="oauth_grant_revoke",
            grant_id=grant_id,
            remote_status=remote_status,
        )
        return remote_status

    def recover_uncertain_sessions(self) -> None:
        """Mark stale ``exchanging`` sessions as ``exchange_uncertain``.

        Called by a scheduled job; after the exchange timeout passes without
        the session reaching ``complete``, we cannot safely replay the code
        (single-use) and must force reauthorization.
        """

        now = _utcnow()
        deadline = now - dt.timedelta(seconds=self.settings.exchange_lock_timeout_seconds * 2)
        q = select(OAuthSession).where(
            OAuthSession.status == "exchanging",
            OAuthSession.exchanged_at.is_(None),
            OAuthSession.created_at < deadline,
        )
        for sess in self.db.execute(q).scalars():
            sess.status = "exchange_uncertain"
            self._audit(
                tenant_id=sess.tenant_id,
                subject_id=sess.owner_subject_id,
                action="oauth_session_uncertain_recovery",
                session_id=sess.session_id,
            )

        rg = select(OAuthGrant).where(
            OAuthGrant.status == "refreshing",
            OAuthGrant.refresh_started_at.isnot(None),
            OAuthGrant.refresh_started_at < now - dt.timedelta(seconds=self.settings.refresh_lock_timeout_seconds * 2),
        )
        for grant in self.db.execute(rg).scalars():
            grant.status = "refresh_uncertain"
            self._audit(
                tenant_id=grant.tenant_id,
                subject_id=grant.owner_subject_id,
                action="oauth_refresh_uncertain_recovery",
                grant_id=grant.grant_id,
            )
