"""ROI locale policy loading and validation.

The production policy will be signed off by Localization/Finance. Until then,
service startup requires an explicit JSON policy file and refuses to enable
ASYNC_ROI_ENABLED without a complete, unambiguous policy.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class LocalePolicy:
    source_locale: str
    target_locale: str
    vendor: str
    rate_catalog_key: str
    currency: str
    aipe_usd_per_word: Decimal
    t_only_usd_per_word: Decimal
    effective_from: dt.datetime

    def rate_pair(self) -> tuple[Decimal, Decimal]:
        return self.aipe_usd_per_word, self.t_only_usd_per_word


@dataclass(frozen=True)
class PolicyBundle:
    version: str
    effective_from: dt.datetime
    rate_catalog_hash: str
    locales: dict[tuple[str, str], LocalePolicy]

    def supported_target_locales(
        self, source_locale: str, project_locales: set[str]
    ) -> list[LocalePolicy]:
        return [
            lp
            for (src, tgt), lp in self.locales.items()
            if src == source_locale and tgt in project_locales
        ]

    def get(self, source_locale: str, target_locale: str) -> LocalePolicy | None:
        return self.locales.get((source_locale, target_locale))


def _parse_dt(value: Any) -> dt.datetime:
    if isinstance(value, dt.datetime):
        return value.astimezone(dt.timezone.utc)
    s = str(value).strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    parsed = dt.datetime.fromisoformat(s)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc)


def load_policy_from_path(path: str | Path) -> PolicyBundle:
    p = Path(path)
    raw = p.read_text(encoding="utf-8")
    data = json.loads(raw)
    return load_policy_from_dict(data, source_hash=hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16])


def load_policy_from_dict(data: dict[str, Any], source_hash: str = "") -> PolicyBundle:
    version = str(data.get("policy_version") or "").strip()
    if not version:
        raise ValueError("policy.policy_version is required")
    effective_from = _parse_dt(data.get("effective_from"))
    locales_raw = data.get("locales")
    if not isinstance(locales_raw, list) or not locales_raw:
        raise ValueError("policy.locales must be a non-empty list")
    rates = data.get("rates") if isinstance(data.get("rates"), dict) else {}
    locales: dict[tuple[str, str], LocalePolicy] = {}
    seen_keys: set[tuple[str, str, str]] = set()
    for item in locales_raw:
        src = str(item["source_locale"]).strip()
        tgt = str(item["target_locale"]).strip()
        vendor = str(item["vendor"]).strip()
        rate_key = str(item.get("rate_catalog_key") or "").strip()
        currency = str(item.get("currency") or "USD").strip()
        if not (src and tgt and vendor and rate_key):
            raise ValueError(f"policy locale entry missing fields: {item!r}")
        if currency != "USD":
            raise ValueError(f"only USD currency is currently supported; got {currency}")
        rate_entry = rates.get(rate_key) if rate_key in rates else item
        aipe = Decimal(str(rate_entry.get("aipe_usd_per_word")))
        t_only = Decimal(str(rate_entry.get("t_only_usd_per_word")))
        if aipe <= 0 or t_only <= 0:
            raise ValueError(f"rate_catalog_key {rate_key} must have positive per-word rates")
        if t_only > aipe:
            raise ValueError(f"t_only rate cannot exceed aipe rate for {rate_key}")
        entry_effective = _parse_dt(item.get("effective_from") or effective_from)
        key = (src, tgt, vendor)
        if key in seen_keys:
            raise ValueError(f"duplicate locale/vendor policy for {src}->{tgt} vendor={vendor}")
        seen_keys.add(key)
        locales[(src, tgt)] = LocalePolicy(
            source_locale=src,
            target_locale=tgt,
            vendor=vendor,
            rate_catalog_key=rate_key,
            currency=currency,
            aipe_usd_per_word=aipe,
            t_only_usd_per_word=t_only,
            effective_from=entry_effective,
        )
    # Duplicate locale across vendors is an error for production.
    locale_keys = [(src, tgt) for (src, tgt, _v) in seen_keys]
    if len(set(locale_keys)) != len(locale_keys):
        raise ValueError("each source->target locale must map to exactly one vendor")
    return PolicyBundle(
        version=version,
        effective_from=effective_from,
        rate_catalog_hash=source_hash,
        locales=locales,
    )
