"""Core tests for the OAuth Broker and async ROI API + worker."""

from __future__ import annotations

import datetime as dt
import time
from pathlib import Path

from fastapi.testclient import TestClient

from l10n_backend.config import Settings
from l10n_backend.crypto import InsecureDevEnvelopeCrypto, generate_pkce_pair, sha256_hex
from l10n_backend.domain.policy import load_policy_from_path
from l10n_backend.domain.pricing import resolve_tm_pricing
from l10n_backend.models.db import session_scope
from l10n_backend.workers.roi_worker import InMemoryStarlingGateway, RoiWorker


def _auth_headers(device_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {device_token}", "x-l10n-device-session-token": device_token}


def _do_oauth_exchange(client: TestClient):
    verifier, challenge = generate_pkce_pair()
    sess = client.post(
        "/v1/oauth/sessions",
        headers={"Idempotency-Key": "sess", "x-l10n-installation-id": "inst-1"},
        json={
            "installation_id": "inst-1",
            "redirect_uri": "http://127.0.0.1:39641/l10n-tm-companion/oauth/callback",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "plugin_version": "1.5.0",
        },
    ).json()
    ex = client.post(
        f"/v1/oauth/sessions/{sess['session_id']}/exchange",
        headers={"x-l10n-installation-id": "inst-1"},
        json={"code": "auth-code", "state": sess["state"], "code_verifier": verifier},
    ).json()
    return sess, ex


def test_canonical_hash_crlf_nfc():
    from l10n_backend.crypto import verify_text_hash
    a = "Hello\r\nworld  café"
    b = "Hello\nworld  cafe\u0301"
    assert sha256_hex(a) == sha256_hex(b)
    assert verify_text_hash(a, sha256_hex(b))


def test_pricing_boundaries():
    assert resolve_tm_pricing(0, None).match_category == "0_75"
    assert resolve_tm_pricing(50, None).match_category == "0_75"
    assert resolve_tm_pricing(75, None).match_category == "0_75"
    assert resolve_tm_pricing(75.1, None).match_category == "75_85"
    assert resolve_tm_pricing(85, None).match_category == "75_85"
    assert resolve_tm_pricing(85.01, None).match_category == "85_95"
    assert resolve_tm_pricing(100, None).match_category == "exact_unclassified_conservative"


def test_oauth_flow_end_to_end(client: TestClient):
    _sess, ex = _do_oauth_exchange(client)
    assert ex["grant_id"]
    assert ex["device_session_token"]
    assert ex["user"]["open_id"] == "oid-1"
    device_token = ex["device_session_token"]
    r = client.post(
        f"/v1/oauth/grants/{ex['grant_id']}/token",
        headers=_auth_headers(device_token),
        json={"known_token_version": 0},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["token_version"] >= 1
    assert body["reauthorization_required"] is False
    assert body["user_access_token"]
    revoke = client.delete("/v1/oauth/device-sessions/current", headers=_auth_headers(device_token))
    assert revoke.status_code == 200
    assert revoke.json() == {"device_session_status": "revoked"}


def test_idempotency_conflict(client: TestClient):
    verifier, challenge = generate_pkce_pair()
    headers = {"Idempotency-Key": "idem-1", "x-l10n-installation-id": "inst-x"}
    body = {
        "installation_id": "inst-x",
        "redirect_uri": "http://127.0.0.1:39641/l10n-tm-companion/oauth/callback",
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "plugin_version": "1.5.0",
    }
    assert client.post("/v1/oauth/sessions", headers=headers, json=body).status_code == 201
    assert client.post("/v1/oauth/sessions", headers=headers, json=body).status_code == 201
    body["code_challenge"] = "B" * 43
    assert client.post("/v1/oauth/sessions", headers=headers, json=body).status_code == 409


def test_create_run_and_archive_shadow(client: TestClient, tmp_path):
    _sess, ex = _do_oauth_exchange(client)
    dev = _auth_headers(ex["device_session_token"])
    sources = ["Book your flight today.", "Please confirm your seat selection."]
    items = []
    for idx, text in enumerate(sources, start=2):
        items.append({
            "item_id": f"row-{idx}",
            "source_key": f"key-{idx}",
            "sheet_row": idx,
            "source_text": text,
            "source_hash": sha256_hex(text),
        })
    run_body = {
        "client_run_id": f"run-{int(time.time() * 1000)}",
        "started_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "sheet": {"document_token": "sht-1", "sheet_id": "sh-1", "source_range": "A2:A3"},
        "projects": [{"project_id": "278", "name": "TikTok_main"}],
        "display_scope": {"source_locale": "en", "target_locale": "fr", "project_ids": ["278"]},
        "items": items,
    }
    r = client.post("/v1/roi/runs", headers={**dev, "Idempotency-Key": "create-run"}, json=run_body)
    assert r.status_code == 201, r.text
    run = r.json()

    settings = Settings(
        database_url=f"sqlite:///{tmp_path}/test.db",
        roi_policy_path=str(Path(__file__).resolve().parents[1] / "config" / "policy.example.json"),
        async_roi_enabled=True,
        legacy_local_secret_dev_only=True,
    )
    worker = RoiWorker(
        settings=settings,
        policy=load_policy_from_path(settings.roi_policy_path),
        starling=InMemoryStarlingGateway(),
        crypto=InsecureDevEnvelopeCrypto(),
    )
    with session_scope() as db:
        while worker.run_once(db):
            pass

    revision = run["revision"]
    finals = ["Book your flight now.", "Please confirm your selected seat."]
    for item, final in zip(items, finals, strict=True):
        r = client.put(
            f"/v1/roi/runs/{run['run_id']}/items/{item['item_id']}/final",
            headers={**dev, "Idempotency-Key": f"final:{item['item_id']}:{sha256_hex(final)}"},
            json={
                "expected_revision": revision,
                "final_text": final,
                "final_text_hash": sha256_hex(final),
                "confirmed_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                "sheet_write_receipt": {
                    "document_token": "sht-1",
                    "sheet_id": "sh-1",
                    "row": item["sheet_row"],
                    "output_range": f"B{item['sheet_row']}:G{item['sheet_row']}",
                    "output_hash": sha256_hex(final + ":written"),
                },
                "display_final_tm": {"score": 90.0, "match_category": None},
            },
        )
        assert r.status_code == 202, r.text
        revision = r.json()["revision"]

    with session_scope() as db:
        while worker.run_once(db):
            pass

    r = client.post(
        f"/v1/roi/runs/{run['run_id']}/archive",
        headers={**dev, "Idempotency-Key": f"arch:{run['run_id']}"},
        json={"expected_revision": revision, "requested_at": dt.datetime.now(dt.timezone.utc).isoformat()},
    )
    assert r.status_code == 202, r.text

    with session_scope() as db:
        while worker.run_once(db):
            pass

    status = client.get(f"/v1/roi/runs/{run['run_id']}", headers=dev).json()
    assert status["archive_state"] in {"complete", "incomplete"}
    assert status["coverage"]["complete_a_lines"] >= 1
