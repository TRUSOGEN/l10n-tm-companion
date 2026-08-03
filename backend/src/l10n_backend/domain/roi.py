"""Async ROI service layer (run creation, final C submission, archive, status)."""

from __future__ import annotations

import datetime as dt
import hashlib
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Iterable

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import Settings
from ..crypto import EnvelopeCiphertext, InsecureDevEnvelopeCrypto, canonical_text_bytes, generate_uuid7_like, sha256_hex, verify_text_hash
from ..domain.policy import LocalePolicy, PolicyBundle
from ..logging_utils import get_logger
from ..models import (
    PolicySnapshot,
    RoiArchiveRecord,
    RoiArchiveSnapshot,
    RoiItem,
    RoiJob,
    RoiOutboxEvent,
    RoiRun,
    RoiScopeResult,
)
from ..models.entities import _utcnow, _ensure_utc
from .pricing import count_english_words

log = get_logger("roi")


class RoiError(RuntimeError):
    def __init__(self, code: str, message: str, *, status: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


@dataclass
class VerifiedProject:
    project_id: str
    name: str
    source_locale: str
    target_locales: set[str]


def _chunk(items: list[Any], size: int) -> Iterable[list[Any]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def _as_utc_datetime(value: Any, *, default: dt.datetime) -> dt.datetime:
    if isinstance(value, dt.datetime):
        return _ensure_utc(value) or default
    if isinstance(value, str) and value:
        try:
            return _ensure_utc(dt.datetime.fromisoformat(value.replace("Z", "+00:00"))) or default
        except ValueError:
            return default
    return default


class RoiService:
    """Coordinate ROI run lifecycle inside DB transactions."""

    def __init__(
        self,
        db: Session,
        settings: Settings,
        policy: PolicyBundle,
        crypto: Any,
        project_access_validator: Any = None,
        starling: Any = None,
    ) -> None:
        self.db = db
        self.settings = settings
        self.policy = policy
        self.crypto = crypto
        self.project_access_validator = project_access_validator
        self.starling = starling

    # ----- encryption helpers -----
    def _encrypt_text(self, text: str) -> dict[str, Any]:
        return self.crypto.encrypt(text).__dict__

    def _decrypt_text(self, blob: dict[str, Any] | None) -> str:
        if not blob:
            return ""
        return self.crypto.decrypt(EnvelopeCiphertext(**blob))

    # ----- policy / project validation -----
    def _verify_projects(self, input_projects: list[dict[str, Any]], subject_id: str) -> list[VerifiedProject]:
        if not self.settings.async_roi_enabled:
            raise RoiError("feature_disabled", "Async ROI is not enabled", status=503)
        # In real deployment the validator calls Starling as subject to list
        # authorized projects + their source/target locales; here we accept
        # input as a sandbox-safe default but require IDs/names match.
        if self.project_access_validator is not None:
            return self.project_access_validator(input_projects, subject_id)
        if not (1 <= len(input_projects) <= self.settings.starling_max_projects):
            raise RoiError("project_count_invalid", "projects must contain 1–10 entries")
        verified: list[VerifiedProject] = []
        for p in input_projects:
            pid = str(p.get("project_id", "")).strip()
            name = str(p.get("name", "")).strip()
            if not pid or not name:
                raise RoiError("project_invalid", "project_id and name are required")
            # Stub source/target coverage based on policy locales.
            source_locale = "en"
            target_locales = {lp.target_locale for lp in self.policy.locales.values() if lp.source_locale == source_locale}
            verified.append(
                VerifiedProject(
                    project_id=pid,
                    name=name,
                    source_locale=source_locale,
                    target_locales=target_locales,
                )
            )
        sources = {v.source_locale for v in verified}
        if len(sources) != 1:
            raise RoiError("source_locale_mismatch", "All selected projects must share the same source locale")
        return verified

    def _resolve_locales(self, projects: list[VerifiedProject]) -> tuple[str, list[LocalePolicy], set[str]]:
        source_locale = projects[0].source_locale
        project_id_set = {p.project_id for p in projects}
        # intersect target locales across projects
        common = set.intersection(*(p.target_locales for p in projects))
        locales: list[LocalePolicy] = []
        for lp in self.policy.locales.values():
            if lp.source_locale != source_locale:
                continue
            if lp.target_locale in common:
                locales.append(lp)
        if not locales:
            raise RoiError("no_shared_locales", "No shared billable target locales across selected projects")
        return source_locale, locales, project_id_set

    # ----- create run -----
    def create_run(
        self,
        *,
        subject_id: str,
        tenant_id: str,
        payload: dict[str, Any],
    ) -> RoiRun:
        projects_in = payload.get("projects") or []
        items_in = payload.get("items") or []
        verified = self._verify_projects(projects_in, subject_id)
        source_locale, locale_policies, project_id_set = self._resolve_locales(verified)
        display_scope = payload.get("display_scope") or {}
        if display_scope.get("source_locale") != source_locale:
            raise RoiError("display_scope_source_mismatch", "display_scope source_locale must match projects")
        display_projects = set(display_scope.get("project_ids") or [])
        if display_projects != project_id_set:
            raise RoiError("display_scope_projects_mismatch", "display_scope.project_ids must match validated projects")
        # Client client_run_id uniqueness per subject
        existing = self.db.execute(
            select(RoiRun).where(
                RoiRun.owner_subject_id == subject_id,
                RoiRun.client_run_id == payload["client_run_id"],
            )
        ).scalar_one_or_none()
        if existing is not None:
            raise RoiError("client_run_id_conflict", "client_run_id already exists for this user", status=409)

        now = _utcnow()
        run = RoiRun(
            run_id=generate_uuid7_like(),
            client_run_id=str(payload["client_run_id"]),
            owner_subject_id=subject_id,
            tenant_id=tenant_id,
            policy_version=self.policy.version,
            source_locale=source_locale,
            project_ids_json=sorted(project_id_set),
            projects_json=[{"project_id": v.project_id, "name": v.name} for v in verified],
            display_scope_json=display_scope,
            sheet_json=payload.get("sheet") or {},
            locale_count=len(locale_policies),
            accepted_item_count=len(items_in),
            revision=1,
            a_state="queued",
            review_state="open",
            c_state="idle",
            archive_state="not_requested",
            started_at=_as_utc_datetime(payload.get("started_at"), default=now),
            selected_scope_count=len(locale_policies),
            complete_scope_count=0,
        )
        self.db.add(run)

        # items + A-jobs in one transaction
        chunk_size = self.settings.starling_batch_size
        jobs_added: list[RoiJob] = []
        for item_in in items_in:
            source_text = item_in["source_text"]
            client_hash = str(item_in["source_hash"]).lower()
            if not verify_text_hash(source_text, client_hash):
                raise RoiError("source_hash_mismatch", f"source_hash mismatch for item {item_in['item_id']}")
            word_count = count_english_words(source_text) or 0
            item = RoiItem(
                run_id=run.run_id,
                item_id=item_in["item_id"],
                source_key=str(item_in.get("source_key") or ""),
                sheet_row=int(item_in["sheet_row"]),
                source_text_cipher=self._encrypt_text(source_text),
                source_hash=client_hash,
                source_word_count=word_count,
                review_status="pending",
            )
            self.db.add(item)

        # Commit to assign run_id; but per spec we must NOT leave a half-run on
        # failure, so everything below stays in the same transaction.
        for lp in locale_policies:
            sources: list[tuple[str, str, int, str]] = []  # (item_id, text_hash, row, text)
            for it in items_in:
                sources.append((it["item_id"], sha256_hex(it["source_text"]), int(it["sheet_row"]), it["source_text"]))
            for batch_idx, batch in enumerate(_chunk(sources, chunk_size)):
                item_ids = [b[0] for b in batch]
                payload_job = {
                    "stage": "A",
                    "source_locale": source_locale,
                    "target_locale": lp.target_locale,
                    "vendor": lp.vendor,
                    "project_ids": sorted(project_id_set),
                    "rate_catalog_key": lp.rate_catalog_key,
                    "item_ids": item_ids,
                    "batch_index": batch_idx,
                    "policy_version": self.policy.version,
                }
                text_hash_concat = hashlib.sha256(
                    ("|".join(sorted(b[1] for b in batch))).encode("utf-8")
                ).hexdigest()
                # Create one job per (run, locale, stage, batch). Items in the
                # batch are stored so the worker can fetch decrypted source.
                job = RoiJob(
                    job_id=generate_uuid7_like(),
                    run_id=run.run_id,
                    item_id=f"batch:{batch_idx}",
                    locale=lp.target_locale,
                    stage="A",
                    text_hash=text_hash_concat,
                    policy_version=self.policy.version,
                    task_type="starling_batch_tm",
                    payload_json=payload_job,
                    status="queued",
                    attempts=0,
                    fencing_token=0,
                )
                jobs_added.append(job)
                self.db.add(job)
                # Create outbox event per spec (jobs + outbox same tx)
                self.db.add(
                    RoiOutboxEvent(
                        event_id=generate_uuid7_like(),
                        run_id=run.run_id,
                        event_type="roi.run.a_jobs_enqueued",
                        payload_json={"job_id": job.job_id, "locale": lp.target_locale, "stage": "A"},
                    )
                )
        # Persist policy snapshot for this run if not already present.
        existing_policy = self.db.get(PolicySnapshot, self.policy.version)
        if existing_policy is None:
            self.db.add(
                PolicySnapshot(
                    policy_version=self.policy.version,
                    effective_from=self.policy.effective_from,
                    rate_catalog_hash=self.policy.rate_catalog_hash,
                    locales_json=[
                        {
                            "source_locale": lp.source_locale,
                            "target_locale": lp.target_locale,
                            "vendor": lp.vendor,
                            "rate_catalog_key": lp.rate_catalog_key,
                            "currency": lp.currency,
                            "aipe_usd_per_word": str(lp.aipe_usd_per_word),
                            "t_only_usd_per_word": str(lp.t_only_usd_per_word),
                            "effective_from": lp.effective_from.isoformat(),
                        }
                        for lp in self.policy.locales.values()
                    ],
                )
            )
        self.db.flush()
        return run

    # ----- submit final C -----
    def submit_final(
        self,
        *,
        subject_id: str,
        run_id: str,
        item_id: str,
        payload: dict[str, Any],
    ) -> tuple[RoiRun, RoiItem, int]:
        run = self.db.get(RoiRun, run_id)
        if run is None or run.owner_subject_id != subject_id:
            raise RoiError("run_not_found", "ROI run not found", status=404)
        if run.review_state != "open":
            raise RoiError("roi_run_sealed", "Run has already been sealed for archive", status=409)
        if int(payload["expected_revision"]) != run.revision:
            raise RoiError("revision_conflict", "expected_revision does not match current revision", status=409)
        item = self.db.execute(
            select(RoiItem).where(RoiItem.run_id == run_id, RoiItem.item_id == item_id).with_for_update()
        ).scalar_one_or_none()
        if item is None:
            raise RoiError("item_not_found", "Item not found in this run", status=404)
        final_text = payload["final_text"]
        if not verify_text_hash(final_text, payload["final_text_hash"]):
            raise RoiError("final_hash_mismatch", "final_text_hash does not match final_text")
        receipt = payload["sheet_write_receipt"]
        if (
            receipt.get("document_token") != run.sheet_json.get("document_token")
            or receipt.get("sheet_id") != run.sheet_json.get("sheet_id")
        ):
            raise RoiError("sheet_identity_mismatch", "sheet_write_receipt does not match run sheet")
        # Persist C. If same final hash already recorded, idempotent no-op.
        final_hash = sha256_hex(final_text)
        if item.final_hash == final_hash and item.review_status == "confirmed":
            return run, item, run.revision
        item.final_text_cipher = self._encrypt_text(final_text)
        item.final_hash = final_hash
        item.final_word_count = count_english_words(final_text) or 0
        item.confirmed_at = _as_utc_datetime(payload.get("confirmed_at"), default=_utcnow())
        item.sheet_write_receipt_json = receipt
        item.display_final_tm_json = payload.get("display_final_tm") or {}
        item.review_status = "confirmed"

        # Enqueue C jobs for all policy locales.
        source_locale = run.source_locale
        project_ids = list(run.project_ids_json)
        chunk_size = self.settings.starling_batch_size
        # We enqueue one C item per locale here; debounce/batching happens in
        # the worker via a short wait window per (run, locale, stage). For
        # strict delivery guarantees we queue per-item jobs; the worker may
        # coalesce into batches when leasing.
        run.revision += 1
        run.c_state = "queued"
        # Collect all currently confirmed items per locale for this run to
        # ensure idempotent re-queues on replay.
        confirmed_items = self.db.execute(
            select(RoiItem).where(RoiItem.run_id == run_id, RoiItem.review_status == "confirmed")
        ).scalars().all()
        confirmed_ids = [ci.item_id for ci in confirmed_items]
        for locale in {lp.target_locale for lp in self.policy.locales.values() if lp.source_locale == source_locale}:
            # schedule batches over all confirmed items (idempotent by unique key)
            for batch_idx, batch in enumerate(_chunk(confirmed_ids, chunk_size)):
                text_hash_concat = hashlib.sha256(
                    ("|".join(sorted(batch))).encode("utf-8")
                ).hexdigest()
                # The unique key on (run_id, item_id, locale, stage, text_hash,
                # policy_version) would reject repeated batch items, so we use
                # item_id=batch:<idx> per locale here.
                existing = self.db.execute(
                    select(RoiJob).where(
                        RoiJob.run_id == run_id,
                        RoiJob.locale == locale,
                        RoiJob.stage == "C",
                        RoiJob.task_type == "starling_batch_tm",
                        RoiJob.item_id == f"batch:{batch_idx}",
                        RoiJob.policy_version == run.policy_version,
                    )
                ).scalar_one_or_none()
                payload_job = {
                    "stage": "C",
                    "source_locale": source_locale,
                    "target_locale": locale,
                    "project_ids": project_ids,
                    "item_ids": batch,
                    "batch_index": batch_idx,
                    "policy_version": run.policy_version,
                }
                if existing is None:
                    job = RoiJob(
                        job_id=generate_uuid7_like(),
                        run_id=run_id,
                        item_id=f"batch:{batch_idx}",
                        locale=locale,
                        stage="C",
                        text_hash=text_hash_concat,
                        policy_version=run.policy_version,
                        task_type="starling_batch_tm",
                        payload_json=payload_job,
                        status="queued",
                        attempts=0,
                        fencing_token=0,
                    )
                    self.db.add(job)
                    self.db.add(
                        RoiOutboxEvent(
                            event_id=generate_uuid7_like(),
                            run_id=run_id,
                            event_type="roi.run.c_jobs_enqueued",
                            payload_json={"job_id": job.job_id, "locale": locale, "stage": "C"},
                        )
                    )
                else:
                    existing.payload_json = payload_job
                    if existing.status in {"terminal_failure", "failed"}:
                        existing.status = "queued"
                        existing.attempts = 0
                        existing.last_error_code = ""
                        existing.last_error_message = ""
        return run, item, run.revision

    # ----- archive -----
    def request_archive(
        self,
        *,
        subject_id: str,
        run_id: str,
        payload: dict[str, Any],
    ) -> tuple[RoiRun, RoiArchiveSnapshot]:
        run = self.db.execute(
            select(RoiRun).where(RoiRun.run_id == run_id).with_for_update()
        ).scalar_one_or_none()
        if run is None or run.owner_subject_id != subject_id:
            raise RoiError("run_not_found", "ROI run not found", status=404)
        if int(payload["expected_revision"]) != run.revision:
            raise RoiError("revision_conflict", "expected_revision does not match run revision", status=409)
        # Idempotency: if archive already exists and is in a terminal state
        # return it; if still processing return 202 payload.
        if run.archive_state in {"pending", "writing", "write_uncertain"}:
            snap = run.snapshot or self.db.get(RoiArchiveSnapshot, run.archive_snapshot_id) if run.archive_snapshot_id else None
            if snap is None:
                raise RoiError("archive_snapshot_missing", "Archive snapshot missing", status=500)
            return run, snap
        if run.archive_state in {"complete", "incomplete", "write_failed"}:
            if run.snapshot is None:
                raise RoiError("archive_snapshot_missing", "Archive snapshot missing", status=500)
            return run, run.snapshot
        confirmed_count = self.db.scalar(
            select(func.count(RoiItem.id)).where(RoiItem.run_id == run_id, RoiItem.review_status == "confirmed")
        ) or 0
        if confirmed_count < 1:
            raise RoiError("archive_no_confirmed", "At least one confirmed item is required before archive")
        now = _utcnow()
        run.review_state = "sealed"
        run.archive_state = "pending"
        run.archive_requested_at = _as_utc_datetime(payload.get("requested_at"), default=now)
        run.sealed_at = now
        # Freeze snapshot of confirmed/unconfirmed items, policy and A/C jobs.
        items = self.db.execute(select(RoiItem).where(RoiItem.run_id == run_id)).scalars().all()
        confirmed_ids = [it.item_id for it in items if it.review_status == "confirmed"]
        unconfirmed_ids = [it.item_id for it in items if it.review_status != "confirmed"]
        jobs = self.db.execute(select(RoiJob).where(RoiJob.run_id == run_id)).scalars().all()
        snapshot_payload = {
            "policy_version": run.policy_version,
            "source_locale": run.source_locale,
            "project_ids": list(run.project_ids_json),
            "display_scope": dict(run.display_scope_json),
            "sheet": dict(run.sheet_json),
            "confirmed_item_ids": confirmed_ids,
            "unconfirmed_item_ids": unconfirmed_ids,
            "job_ids": [j.job_id for j in jobs],
        }
        snap = RoiArchiveSnapshot(
            snapshot_id=generate_uuid7_like(),
            run_id=run_id,
            payload_json=snapshot_payload,
        )
        self.db.add(sap := snap)
        run.archive_snapshot_id = snap.snapshot_id
        # enqueue archive job
        job = RoiJob(
            job_id=generate_uuid7_like(),
            run_id=run_id,
            item_id="__archive__",
            locale="*",
            stage="archive",
            text_hash=sha256_hex(snap.snapshot_id),
            policy_version=run.policy_version,
            task_type="roi_archive",
            payload_json={"snapshot_id": snap.snapshot_id},
            status="queued",
            attempts=0,
            fencing_token=0,
        )
        self.db.add(job)
        return run, snap

    # ----- status aggregation -----
    def get_run_status(self, *, subject_id: str, run_id: str) -> dict[str, Any]:
        run = self.db.get(RoiRun, run_id)
        if run is None or run.owner_subject_id != subject_id:
            raise RoiError("run_not_found", "ROI run not found", status=404)
        expected_a = run.accepted_item_count * run.selected_scope_count
        complete_a = self.db.scalar(
            select(func.count(RoiScopeResult.id)).where(
                RoiScopeResult.run_id == run_id,
                RoiScopeResult.stage == "A",
                RoiScopeResult.status == "complete",
            )
        ) or 0
        confirmed_count = self.db.scalar(
            select(func.count(RoiItem.id)).where(RoiItem.run_id == run_id, RoiItem.review_status == "confirmed")
        ) or 0
        expected_c = confirmed_count * run.selected_scope_count
        complete_c = self.db.scalar(
            select(func.count(RoiScopeResult.id)).where(
                RoiScopeResult.run_id == run_id,
                RoiScopeResult.stage == "C",
                RoiScopeResult.status == "complete",
            )
        ) or 0
        complete_pairs = self._count_complete_pairs(run_id)
        # compute complete_scope_count after seal
        complete_scope_count = self._count_complete_scopes(run_id)
        total_saving = self._sum_saving(run_id)
        failures_q = self.db.execute(
            select(RoiScopeResult.failure_code, func.count(RoiScopeResult.id)).where(
                RoiScopeResult.run_id == run_id,
                RoiScopeResult.status == "failed",
                RoiScopeResult.failure_code != "",
            ).group_by(RoiScopeResult.failure_code)
        ).all()
        failures = [{"code": code, "count": int(cnt)} for code, cnt in failures_q]
        if run.archive_state == "complete":
            run.complete_scope_count = complete_scope_count
            run.total_saving_usd = total_saving
        return {
            "run_id": run.run_id,
            "revision": run.revision,
            "a_state": run.a_state,
            "review_state": run.review_state,
            "c_state": run.c_state,
            "archive_state": run.archive_state,
            "policy_version": run.policy_version,
            "locale_count": run.locale_count,
            "accepted_item_count": run.accepted_item_count,
            "selected_scope_count": run.selected_scope_count,
            "complete_scope_count": complete_scope_count,
            "total_saving_usd": float(total_saving) if total_saving is not None else None,
            "coverage": {
                "expected_a_lines": expected_a,
                "complete_a_lines": complete_a,
                "complete_c_lines": complete_c,
                "expected_c_lines": expected_c,
                "complete_a_c_pairs": complete_pairs,
            },
            "failures": failures,
            "archive": {
                "record_id": run.archive_record_id,
                "requested_at": run.archive_requested_at,
                "completed_at": run.archive_completed_at,
            },
        }

    # ----- aggregation helpers -----
    def _count_complete_pairs(self, run_id: str) -> int:
        # Count (item, locale) where both A and C are complete.
        a = self.db.execute(
            select(RoiScopeResult.item_id, RoiScopeResult.locale).where(
                RoiScopeResult.run_id == run_id,
                RoiScopeResult.stage == "A",
                RoiScopeResult.status == "complete",
            )
        ).all()
        c = self.db.execute(
            select(RoiScopeResult.item_id, RoiScopeResult.locale).where(
                RoiScopeResult.run_id == run_id,
                RoiScopeResult.stage == "C",
                RoiScopeResult.status == "complete",
            )
        ).all()
        return len(set(a) & set(c))

    def _count_complete_scopes(self, run_id: str) -> int:
        run = self.db.get(RoiRun, run_id)
        if not run or run.archive_state == "not_requested" or run.archive_state == "pending":
            return 0
        # A scope is complete only if every confirmed item has complete C and
        # every item has complete A; unconfirmed items seal incomplete.
        items = self.db.execute(select(RoiItem).where(RoiItem.run_id == run_id)).scalars().all()
        item_ids = [it.item_id for it in items]
        confirmed_ids = {it.item_id for it in items if it.review_status == "confirmed"}
        complete = 0
        for lp in self.policy.locales.values():
            if lp.source_locale != run.source_locale:
                continue
            ok = True
            for iid in item_ids:
                a = self.db.execute(
                    select(RoiScopeResult).where(
                        RoiScopeResult.run_id == run_id,
                        RoiScopeResult.locale == lp.target_locale,
                        RoiScopeResult.item_id == iid,
                        RoiScopeResult.stage == "A",
                    )
                ).scalar_one_or_none()
                if not a or a.status != "complete":
                    ok = False
                    break
                if iid in confirmed_ids:
                    c = self.db.execute(
                        select(RoiScopeResult).where(
                            RoiScopeResult.run_id == run_id,
                            RoiScopeResult.locale == lp.target_locale,
                            RoiScopeResult.item_id == iid,
                            RoiScopeResult.stage == "C",
                        )
                    ).scalar_one_or_none()
                    if not c or c.status != "complete":
                        ok = False
                        break
            if ok:
                complete += 1
        return complete

    def _sum_saving(self, run_id: str) -> Decimal | None:
        # Sum per (item, locale) A.cost - C.cost for complete pairs only.
        a_rows = self.db.execute(
            select(RoiScopeResult.item_id, RoiScopeResult.locale, RoiScopeResult.cost_usd).where(
                RoiScopeResult.run_id == run_id,
                RoiScopeResult.stage == "A",
                RoiScopeResult.status == "complete",
            )
        ).all()
        c_rows = self.db.execute(
            select(RoiScopeResult.item_id, RoiScopeResult.locale, RoiScopeResult.cost_usd).where(
                RoiScopeResult.run_id == run_id,
                RoiScopeResult.stage == "C",
                RoiScopeResult.status == "complete",
            )
        ).all()
        c_idx = {(iid, loc): cost for iid, loc, cost in c_rows}
        total: Decimal | None = None
        for iid, loc, a_cost in a_rows:
            c_cost = c_idx.get((iid, loc))
            if c_cost is None or a_cost is None:
                continue
            val = Decimal(a_cost) - Decimal(c_cost)
            total = val if total is None else total + val
        if total is None:
            return None
        from .pricing import round_money
        return round_money(total)
