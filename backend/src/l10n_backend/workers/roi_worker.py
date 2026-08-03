"""Async ROI Worker.

The worker polls durable jobs via ``SELECT ... FOR UPDATE SKIP LOCKED``,
respects leases/fencing tokens, debounces quick successive C submissions,
calls Starling Batch TM in bounded batches, persists A/C scope results and
money, and — when enabled — writes the ROI_Test archive in the prescribed
order: ``Run(writing) → Scopes → Items → Run(complete|incomplete)``.

Pending items are *not* prematurely marked incomplete. We only mark a job as
a terminal failure on parameter/policy/identity/permission/content errors;
network timeouts, HTTP 429 and platform 5xx receive bounded retries.
"""

from __future__ import annotations

import datetime as dt
import os
import time
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Iterable

from sqlalchemy import and_, func, select, update
from sqlalchemy.orm import Session

from ..adapters import StarlingGateway
from ..config import Settings, get_settings
from ..crypto import EnvelopeCiphertext, InsecureDevEnvelopeCrypto
from ..domain.policy import PolicyBundle, load_policy_from_path
from ..domain.pricing import compute_ac_costs, round_money
from ..logging_utils import get_logger
from ..models import (
    RoiArchiveRecord,
    RoiArchiveSnapshot,
    RoiItem,
    RoiJob,
    RoiRun,
    RoiScopeResult,
)
from ..models.db import session_scope
from ..models.entities import _utcnow, _ensure_utc

log = get_logger("worker")


class StarlingBatchError(RuntimeError):
    def __init__(self, code: str, message: str, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable


class InMemoryStarlingGateway(StarlingGateway):
    """A deterministic fake used by tests and local dev.

    For a given source string it returns a stable pseudo-score so A/B/C
    parity fixtures can be computed without network access.
    """

    def __init__(self, score_fn=None) -> None:
        self.score_fn = score_fn or self._default_score

    @staticmethod
    def _default_score(text: str, target_locale: str) -> float:
        # Deterministic pseudo-score for smoke tests.
        seed = sum(ord(c) for c in text) + sum(ord(c) for c in target_locale)
        # Return scores distributed around 70-95 so the AI eligibility window
        # (50 ≤ Score A < 85) is exercised in both AI and non-AI cases.
        return float(50 + (seed % 4500) / 100)  # 50.00 .. 94.99

    def batch_tm(
        self,
        *,
        access_key: str,
        secret_key: str,
        project_ids: list[str],
        source_locale: str,
        target_locale: str,
        source_contents: list[str],
    ) -> list[dict[str, Any]]:
        del access_key, secret_key, project_ids, source_locale
        return [
            {"score": self.score_fn(text, target_locale), "match_category": None}
            for text in source_contents
        ]


@dataclass
class Lease:
    job: RoiJob
    fencing_token: int
    owner: str


class RoiWorker:
    def __init__(
        self,
        settings: Settings | None = None,
        policy: PolicyBundle | None = None,
        starling: StarlingGateway | None = None,
        crypto: InsecureDevEnvelopeCrypto | None = None,
        owner: str | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.policy = policy or load_policy_from_path(self.settings.roi_policy_path)
        self.starling = starling or InMemoryStarlingGateway()
        self.crypto = crypto or InsecureDevEnvelopeCrypto()
        self.owner = owner or f"worker-{os.getpid()}-{int(time.time())}"

    # ----- public entry points -----
    def run_once(self, db: Session) -> int:
        """Lease and process one job; return 1 if work was done, 0 otherwise."""

        job = self._lease_job(db)
        if job is None:
            return 0
        try:
            self._process_job(db, job)
            return 1
        except StarlingBatchError as exc:
            self._mark_retryable(db, job, exc.code, str(exc)) if exc.retryable else self._mark_terminal(db, job, exc.code, str(exc))
            return 1
        except Exception as exc:  # noqa: BLE001
            log.exception("worker_job_failed", job_id=job.job_id, error=str(exc))
            self._mark_retryable(db, job, "worker_internal_error", str(exc)[:200])
            return 1

    def run_forever(self) -> None:
        while True:
            did = 0
            with session_scope() as db:
                did = self.run_once(db)
            if not did:
                time.sleep(self.settings.worker_poll_interval_seconds)

    # ----- leasing -----
    def _lease_job(self, db: Session) -> RoiJob | None:
        now = _utcnow()
        candidate = db.execute(
            select(RoiJob).where(
                RoiJob.status.in_(["queued", "failed"]),
                (RoiJob.leased_until.is_(None)) | (RoiJob.leased_until < now),
            ).order_by(RoiJob.created_at.asc()).with_for_update(skip_locked=True).limit(1)
        ).scalar_one_or_none()
        if candidate is None:
            return None
        candidate.fencing_token = (candidate.fencing_token or 0) + 1
        candidate.leased_by = self.owner
        candidate.leased_until = now + dt.timedelta(seconds=self.settings.job_lease_seconds)
        candidate.status = "running"
        candidate.attempts = (candidate.attempts or 0) + 1
        db.flush()
        return candidate

    def _renew(self, db: Session, job: RoiJob) -> None:
        db.execute(
            update(RoiJob).where(
                RoiJob.job_id == job.job_id,
                RoiJob.fencing_token == job.fencing_token,
            ).values(leased_until=_utcnow() + dt.timedelta(seconds=self.settings.job_lease_seconds))
        )

    def _mark_retryable(self, db: Session, job: RoiJob, code: str, message: str) -> None:
        if job.attempts >= job.max_attempts:
            self._mark_terminal(db, job, code, message)
            return
        job.status = "queued"
        job.leased_by = None
        job.leased_until = None
        job.last_error_code = code
        job.last_error_message = message[:500]

    def _mark_terminal(self, db: Session, job: RoiJob, code: str, message: str) -> None:
        job.status = "terminal_failure"
        job.leased_by = None
        job.leased_until = None
        job.last_error_code = code
        job.last_error_message = message[:500]
        self._mark_scope_results_failed(db, job, code, message)
        self._update_run_states(db, job.run_id)

    def _complete_job(self, db: Session, job: RoiJob) -> None:
        job.status = "complete"
        job.leased_by = None
        job.leased_until = None
        job.last_error_code = ""
        job.last_error_message = ""
        self._update_run_states(db, job.run_id)

    # ----- per-job dispatch -----
    def _process_job(self, db: Session, job: RoiJob) -> None:
        if job.task_type == "starling_batch_tm":
            self._process_starling_batch(db, job)
        elif job.task_type == "roi_archive":
            self._process_archive(db, job)
        else:
            self._mark_terminal(db, job, "unknown_job_type", f"Unknown task_type {job.task_type}")

    # ----- starling batch A/C -----
    def _process_starling_batch(self, db: Session, job: RoiJob) -> None:
        payload = job.payload_json
        stage = payload["stage"]
        target_locale = payload["target_locale"]
        project_ids = list(payload["project_ids"])
        source_locale = payload["source_locale"]
        item_ids: list[str] = list(payload["item_ids"])
        run = db.get(RoiRun, job.run_id)
        if run is None:
            self._mark_terminal(db, job, "run_missing", "Run was deleted before job executed")
            return
        rate = self.policy.get(source_locale, target_locale)
        if rate is None:
            self._mark_terminal(db, job, "rate_missing", f"No rate for {source_locale}->{target_locale}")
            return

        items: dict[str, RoiItem] = {
            it.item_id: it
            for it in db.execute(select(RoiItem).where(RoiItem.run_id == run.run_id, RoiItem.item_id.in_(item_ids))).scalars()
        }
        # For stage=C, only confirmed items have final text; missing items mean the batch
        # snapshot is outdated and we supersede it (terminal failure) so coalesced batches take over.
        sources: list[str] = []
        ordered_ids: list[str] = []
        for iid in item_ids:
            it = items.get(iid)
            if it is None:
                self._mark_terminal(db, job, "item_missing", f"Item {iid} not found")
                return
            if stage == "A":
                text = self._decrypt(it.source_text_cipher)
            else:
                if it.review_status != "confirmed" or not it.final_text_cipher:
                    continue  # unconfirmed items in sealed run will be accounted as incomplete
                text = self._decrypt(it.final_text_cipher)
            if not text:
                self._mark_terminal(db, job, "text_missing", f"Item {iid} missing text for stage {stage}")
                return
            ordered_ids.append(iid)
            sources.append(text)
        if not sources:
            self._complete_job(db, job)
            return
        self._renew(db, job)
        # TODO: inject AK/SK from Starling service identity in production.
        ak = os.environ.get("L10N_STARLING_ACCESS_KEY", "")
        sk = os.environ.get("L10N_STARLING_SECRET_KEY", "")
        if not (ak and sk and self.settings.starling_base_url):
            # In dev/test we rely on the fake gateway; production fails closed.
            if not isinstance(self.starling, InMemoryStarlingGateway):
                self._mark_retryable(db, job, "starling_credentials_missing", "Starling credentials not configured")
                return
        try:
            results = self.starling.batch_tm(
                access_key=ak,
                secret_key=sk,
                project_ids=project_ids,
                source_locale=source_locale,
                target_locale=target_locale,
                source_contents=sources,
            )
        except Exception as exc:  # noqa: BLE001
            raise StarlingBatchError("starling_batch_error", str(exc)[:200], retryable=True) from exc
        if len(results) != len(sources):
            raise StarlingBatchError("starling_batch_shape_error", "Starling returned wrong number of results", retryable=False)
        for iid, text, tm in zip(ordered_ids, sources, results, strict=True):
            it = items[iid]
            score = tm.get("score")
            category = tm.get("match_category")
            if score is None or not (0 <= float(score) <= 100):
                self._upsert_scope_result(
                    db,
                    run=run,
                    item=it,
                    target_locale=target_locale,
                    stage=stage,
                    text_hash=it.source_hash if stage == "A" else it.final_hash,
                    status="failed",
                    failure_code="tm_score_invalid",
                    failure_reason="Starling returned an invalid score",
                )
                continue
            if stage == "A":
                # Use A-only pricing helper inline
                from ..domain.pricing import compute_tm_cost
                a = compute_tm_cost(
                    text=text,
                    score=float(score),
                    match_category=category,
                    aipe_usd_per_word=rate.aipe_usd_per_word,
                    t_only_usd_per_word=rate.t_only_usd_per_word,
                    prefix="original_tm",
                )
                if not a.get("ok"):
                    self._upsert_scope_result(
                        db, run=run, item=it, target_locale=target_locale, stage="A",
                        text_hash=it.source_hash, status="failed", failure_code=a.get("reason", "cost_error"),
                        failure_reason="Could not price stage A",
                    )
                    continue
                self._upsert_scope_result(
                    db, run=run, item=it, target_locale=target_locale, stage="A",
                    text_hash=it.source_hash, status="complete", score=float(score),
                    match_category=str(a.get("match_category") or category or ""),
                    cost_usd=a["cost"], word_count=int(a["actual_word_count"]),
                )
            else:
                # stage C — load matching A for source text, compute C costs using C text.
                from ..domain.pricing import compute_tm_cost
                a_row = db.execute(
                    select(RoiScopeResult).where(
                        RoiScopeResult.run_id == run.run_id,
                        RoiScopeResult.item_id == it.item_id,
                        RoiScopeResult.locale == target_locale,
                        RoiScopeResult.stage == "A",
                    )
                ).scalar_one_or_none()
                if a_row is None or a_row.status != "complete":
                    self._upsert_scope_result(
                        db, run=run, item=it, target_locale=target_locale, stage="C",
                        text_hash=it.final_hash, status="failed",
                        failure_code="a_missing_for_c", failure_reason="Stage A result is missing",
                    )
                    continue
                c = compute_tm_cost(
                    text=text,
                    score=float(score),
                    match_category=category,
                    aipe_usd_per_word=rate.aipe_usd_per_word,
                    t_only_usd_per_word=rate.t_only_usd_per_word,
                    prefix="final_tm",
                )
                if not c.get("ok"):
                    self._upsert_scope_result(
                        db, run=run, item=it, target_locale=target_locale, stage="C",
                        text_hash=it.final_hash, status="failed", failure_code=c.get("reason", "cost_error"),
                        failure_reason="Could not price stage C",
                    )
                    continue
                self._upsert_scope_result(
                    db, run=run, item=it, target_locale=target_locale, stage="C",
                    text_hash=it.final_hash, status="complete", score=float(score),
                    match_category=str(c.get("match_category") or category or ""),
                    cost_usd=c["cost"], word_count=int(c["actual_word_count"]),
                )
        self._renew(db, job)
        self._complete_job(db, job)

    def _upsert_scope_result(
        self,
        db: Session,
        *,
        run: RoiRun,
        item: RoiItem,
        target_locale: str,
        stage: str,
        text_hash: str,
        status: str,
        score: float | None = None,
        match_category: str = "",
        cost_usd: Decimal | None = None,
        word_count: int = 0,
        failure_code: str = "",
        failure_reason: str = "",
    ) -> None:
        row = db.execute(
            select(RoiScopeResult).where(
                RoiScopeResult.run_id == run.run_id,
                RoiScopeResult.item_id == item.item_id,
                RoiScopeResult.locale == target_locale,
                RoiScopeResult.stage == stage,
                RoiScopeResult.text_hash == text_hash,
                RoiScopeResult.policy_version == run.policy_version,
            )
        ).scalar_one_or_none()
        if row is None:
            row = RoiScopeResult(
                run_id=run.run_id,
                item_id=item.item_id,
                locale=target_locale,
                stage=stage,
                text_hash=text_hash,
                policy_version=run.policy_version,
            )
            db.add(row)
        row.status = status
        row.score = score
        row.match_category = match_category or None
        row.cost_usd = cost_usd
        row.word_count = word_count
        row.failure_code = failure_code
        row.failure_reason = failure_reason[:500]
        row.computed_at = _utcnow() if status == "complete" else None

    def _mark_scope_results_failed(self, db: Session, job: RoiJob, code: str, message: str) -> None:
        # For batch jobs we don't know partial per-item failures when the batch
        # itself failed; mark unresolved pending/running results for this run/locale/stage batch as failed.
        item_ids = job.payload_json.get("item_ids") or []
        stage = job.payload_json.get("stage")
        locale = job.payload_json.get("target_locale")
        for iid in item_ids:
            item = db.execute(
                select(RoiItem).where(RoiItem.run_id == job.run_id, RoiItem.item_id == iid)
            ).scalar_one_or_none()
            if item is None:
                continue
            text_hash = item.source_hash if stage == "A" else item.final_hash
            self._upsert_scope_result(
                db,
                run=db.get(RoiRun, job.run_id),
                item=item,
                target_locale=locale,
                stage=stage,
                text_hash=text_hash,
                status="failed",
                failure_code=code,
                failure_reason=message,
            )

    def _update_run_states(self, db: Session, run_id: str) -> None:
        run = db.get(RoiRun, run_id)
        if run is None:
            return
        # a_state
        a_total = db.scalar(
            select(func.count(RoiScopeResult.id)).where(
                RoiScopeResult.run_id == run_id, RoiScopeResult.stage == "A"
            )
        ) or 0
        a_failed = db.scalar(
            select(func.count(RoiScopeResult.id)).where(
                RoiScopeResult.run_id == run_id, RoiScopeResult.stage == "A", RoiScopeResult.status == "failed"
            )
        ) or 0
        # We consider A "running" when A jobs are still present
        a_jobs_pending = db.scalar(
            select(func.count(RoiJob.job_id)).where(
                RoiJob.run_id == run_id, RoiJob.stage == "A", RoiJob.status.in_(["queued", "running"])
            )
        ) or 0
        expected_a = run.accepted_item_count * run.selected_scope_count
        if expected_a and a_total >= expected_a:
            run.a_state = "partial" if a_failed > 0 else "complete"
        else:
            run.a_state = "running" if a_total or a_jobs_pending else "queued"
        # c_state
        confirmed_items = db.execute(
            select(RoiItem).where(RoiItem.run_id == run_id, RoiItem.review_status == "confirmed")
        ).scalars().all()
        current_final_hashes = {item.item_id: item.final_hash for item in confirmed_items if item.final_hash}
        current_c_rows = db.execute(
            select(RoiScopeResult.item_id, RoiScopeResult.text_hash, RoiScopeResult.status).where(
                RoiScopeResult.run_id == run_id,
                RoiScopeResult.stage == "C",
            )
        ).all()
        current_c_statuses = [
            status for item_id, text_hash, status in current_c_rows
            if current_final_hashes.get(item_id) == text_hash
        ]
        confirmed_count = len(current_final_hashes)
        c_total = len(current_c_statuses)
        c_failed = sum(status == "failed" for status in current_c_statuses)
        c_jobs_pending = db.scalar(
            select(func.count(RoiJob.job_id)).where(
                RoiJob.run_id == run_id, RoiJob.stage == "C", RoiJob.status.in_(["queued", "running"])
            )
        ) or 0
        expected_c = confirmed_count * run.selected_scope_count
        if confirmed_count == 0:
            run.c_state = "idle"
        elif expected_c and c_total >= expected_c:
            run.c_state = "partial" if c_failed > 0 else "complete"
        else:
            run.c_state = "running" if c_total or c_jobs_pending else "queued"
        # Archive state transitions happen in _process_archive.

    # ----- archive -----
    def _process_archive(self, db: Session, job: RoiJob) -> None:
        run = db.get(RoiRun, job.run_id)
        if run is None:
            self._mark_terminal(db, job, "run_missing", "Run missing during archive")
            return
        snap = db.get(RoiArchiveSnapshot, run.archive_snapshot_id) if run.archive_snapshot_id else None
        if snap is None:
            self._mark_terminal(db, job, "archive_snapshot_missing", "Snapshot missing")
            return
        if not self.settings.roi_archive_write_enabled:
            # Shadow compute path: do everything except writing to ROI_Test; when
            # all A/C jobs are terminal, mark archive complete/incomplete locally.
            self._transition_archive_when_ready(db, run, write=False)
            self._complete_job(db, job)
            return
        # Wait for all A/C jobs to reach terminal state first.
        pending = db.scalar(
            select(func.count(RoiJob.job_id)).where(
                RoiJob.run_id == run.run_id,
                RoiJob.task_type == "starling_batch_tm",
                RoiJob.status.in_(["queued", "running"]),
            )
        ) or 0
        if pending > 0:
            self._mark_retryable(db, job, "archive_waiting_jobs", f"{pending} A/C jobs still pending")
            return
        run.archive_state = "writing"
        self._transition_archive_when_ready(db, run, write=True)
        self._complete_job(db, job)

    def _transition_archive_when_ready(self, db: Session, run: RoiRun, *, write: bool) -> None:
        # Compute totals: only complete item-locale pairs count toward subtotal.
        confirmed_items = db.execute(
            select(RoiItem).where(RoiItem.run_id == run.run_id, RoiItem.review_status == "confirmed")
        ).scalars().all()
        all_items = db.execute(select(RoiItem).where(RoiItem.run_id == run.run_id)).scalars().all()
        locales = [
            lp.target_locale
            for lp in self.policy.locales.values()
            if lp.source_locale == run.source_locale
        ]
        complete_scopes = 0
        total_saving: Decimal | None = None
        for locale in locales:
            scope_ok = True
            for item in all_items:
                if item.review_status != "confirmed":
                    scope_ok = False
                    break
                a = db.execute(
                    select(RoiScopeResult).where(
                        RoiScopeResult.run_id == run.run_id,
                        RoiScopeResult.item_id == item.item_id,
                        RoiScopeResult.locale == locale,
                        RoiScopeResult.stage == "A",
                    )
                ).scalar_one_or_none()
                if not a or a.status != "complete":
                    scope_ok = False
                    break
                c = db.execute(
                    select(RoiScopeResult).where(
                        RoiScopeResult.run_id == run.run_id,
                        RoiScopeResult.item_id == item.item_id,
                        RoiScopeResult.locale == locale,
                        RoiScopeResult.stage == "C",
                        RoiScopeResult.text_hash == item.final_hash,
                    )
                ).scalar_one_or_none()
                if not c or c.status != "complete":
                    scope_ok = False
                    break
                if a.cost_usd is not None and c.cost_usd is not None:
                    val = Decimal(a.cost_usd) - Decimal(c.cost_usd)
                    total_saving = val if total_saving is None else total_saving + val
            if scope_ok:
                complete_scopes += 1
        run.complete_scope_count = complete_scopes
        run.total_saving_usd = round_money(total_saving) if total_saving is not None else None
        run.archive_state = "complete" if complete_scopes == run.selected_scope_count else "incomplete"
        run.archive_completed_at = _utcnow()
        if write:
            self._write_archive_records(db, run, confirmed_items=confirmed_items, all_items=all_items, locales=locales)
        # Scrub content after retention window via a separate reaper; here we
        # just ensure the run state is finalized.

    def _write_archive_records(self, db: Session, run: RoiRun, *, confirmed_items, all_items, locales: list[str]) -> None:
        """Write ROI_Test following Run(writing) → Scopes → Items → Run(...) order.

        In production this calls Feishu Bitable using the tenant token; in this
        skeleton we write bookkeeping rows to `roi_archive_records` so the
        idempotency/fencing contracts are exercised by tests. The real Bitable
        adapter must be wired by the deployer before enabling ROI_ARCHIVE_WRITE.
        """
        # Per spec, query existing Runs by Run ID: 0 → create, 1 → resume by record_id, >1 → fail.
        runs = db.execute(
            select(RoiArchiveRecord).where(
                RoiArchiveRecord.run_id == run.run_id,
                RoiArchiveRecord.table_name == "Runs",
                RoiArchiveRecord.logical_key == run.run_id,
            )
        ).scalars().all()
        if len(runs) > 1:
            run.archive_state = "write_failed"
            run.archive_duplicate_run_records = True
            return
        # Writing phases are recorded; real impl should map fields 1:1 to lib/roi-bitable-archive.js.
        phases = ["Run(writing)", "Scopes", "Items", "Run(complete)"]
        for phase in phases:
            rec = db.execute(
                select(RoiArchiveRecord).where(
                    RoiArchiveRecord.run_id == run.run_id,
                    RoiArchiveRecord.table_name == "Runs" if phase.startswith("Run") else ("Scopes" if phase == "Scopes" else "Items"),
                    RoiArchiveRecord.logical_key == (run.run_id if phase.startswith("Run") else f"{run.run_id}:{phase}"),
                )
            ).scalar_one_or_none()
            if rec is None:
                rec = RoiArchiveRecord(
                    run_id=run.run_id,
                    table_name=("Runs" if phase.startswith("Run") else ("Scopes" if phase == "Scopes" else "Items")),
                    logical_key=(run.run_id if phase.startswith("Run") else f"{run.run_id}:{phase}"),
                    phase=phase,
                    fencing_token=1,
                )
                db.add(rec)
            # Replace this block with actual Bitable create/update when wiring tenant token.
            rec.record_id = rec.record_id or f"stub-{phase}-{run.run_id}"
        run.archive_record_id = f"stub-{run.run_id}"

    # ----- helpers -----
    def _decrypt(self, blob: dict[str, Any] | None) -> str:
        if not blob:
            return ""
        return self.crypto.decrypt(EnvelopeCiphertext(**blob))
