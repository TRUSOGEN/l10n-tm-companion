"""Python port of ``lib/roi-calculation.js``.

The service-side pricing MUST match the browser module exactly. Only the
fields actually required by the async server (A and C scoring) are exposed
here; B (post-rewrite) is intentionally not needed by the production backend
since B is display-scope only and never feeds official ROI.
"""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP, getcontext
from typing import Any, Literal
import unicodedata

getcontext().prec = 28

AIPE_MAX_SCORE = Decimal("75")
EXACT_MATCH_DISCOUNTS: dict[str, Decimal] = {
    "ice": Decimal("0"),
    "repetition": Decimal("0.2"),
    "exact_no_review": Decimal("0"),
    "exact_review": Decimal("0.1"),
}
UNCLASSIFIED_EXACT_MATCH_DISCOUNT = Decimal("0.2")
SIDE_PANEL_MONEY_QUANT = Decimal("0.0000000001")  # 10 decimals
ZERO = Decimal("0")


class PricingResult:
    __slots__ = ("rate_type", "discount", "match_category", "reason")

    def __init__(
        self,
        rate_type: Literal["aipe", "t_only"] | None = None,
        discount: Decimal | None = None,
        match_category: str | None = None,
        reason: str = "",
    ) -> None:
        self.rate_type = rate_type
        self.discount = discount
        self.match_category = match_category
        self.reason = reason

    @property
    def ok(self) -> bool:
        return not self.reason


def normalize_match_category(value: Any) -> str:
    category = str(value or "").strip().lower()
    return category if category in EXACT_MATCH_DISCOUNTS else ""


def count_english_words(text: str) -> int | None:
    """Return the count of English word-like segments.

    We use a deterministic regex-based approximation that is calibrated to
    match Intl.Segmenter('en') for ASCII/Latin business copy used in the
    product. The service MUST validate this against golden fixtures generated
    from the JS module before enabling the async path (see tests).
    """

    import re

    if not isinstance(text, str):
        return None
    source = text.strip()
    if not source:
        return None
    # Unicode NFC already applied by caller; treat word runs as sequences of
    # letter/digit characters that contain at least one letter (matching
    # isWordLike semantics closer than pure \w) and skip pure punctuation or
    # digit-only groups.
    tokens = re.findall(r"[^\s\u3000]+", source)
    word_like = 0
    for tok in tokens:
        if any(ch.isalpha() for ch in tok):
            word_like += 1
    return word_like if word_like > 0 else None


def canonical_text_for_counting(text: str) -> str:
    return unicodedata.normalize("NFC", text.replace("\r\n", "\n").replace("\r", "\n"))


def resolve_tm_pricing(score: float | int | Decimal | None, match_category: Any) -> PricingResult:
    if score is None:
        return PricingResult(reason="tm_score_invalid")
    try:
        s = Decimal(str(score))
    except Exception:
        return PricingResult(reason="tm_score_invalid")
    if s < 0 or s > 100:
        return PricingResult(reason="tm_score_invalid")
    if s == 100:
        category = normalize_match_category(match_category)
        if not category:
            return PricingResult(
                rate_type="t_only",
                discount=UNCLASSIFIED_EXACT_MATCH_DISCOUNT,
                match_category="exact_unclassified_conservative",
            )
        return PricingResult(
            rate_type="t_only",
            discount=EXACT_MATCH_DISCOUNTS[category],
            match_category=category,
        )
    if s > 95:
        return PricingResult(rate_type="t_only", discount=Decimal("0.2"), match_category="95_99")
    if s > 85:
        return PricingResult(rate_type="t_only", discount=Decimal("0.4"), match_category="85_95")
    if s > AIPE_MAX_SCORE:
        return PricingResult(rate_type="t_only", discount=Decimal("0.6"), match_category="75_85")
    return PricingResult(rate_type="aipe", discount=Decimal("1"), match_category="0_75")


def round_money(value: Decimal) -> Decimal:
    return value.quantize(SIDE_PANEL_MONEY_QUANT, rounding=ROUND_HALF_UP)


def sum_money(values: list[Decimal | None]) -> Decimal | None:
    """Sum complete-line money, returning None when no complete lines exist."""

    clean = [v for v in values if v is not None]
    if not clean:
        return None
    total = sum(clean, ZERO)
    return round_money(total)


def compute_tm_cost(
    *,
    text: str,
    score: float | Decimal,
    match_category: Any,
    aipe_usd_per_word: Decimal,
    t_only_usd_per_word: Decimal,
    prefix: str,
) -> dict[str, Any]:
    pricing = resolve_tm_pricing(score, match_category)
    if not pricing.ok:
        return {"reason": f"{prefix}_{pricing.reason}"}
    word_count = count_english_words(canonical_text_for_counting(text))
    if word_count is None:
        return {"reason": f"{prefix}_local_word_count_missing"}
    wc_dec = Decimal(word_count)
    if pricing.rate_type == "aipe":
        cost = wc_dec * aipe_usd_per_word
        weighted = wc_dec
    else:
        weighted = wc_dec * (pricing.discount or ZERO)
        cost = weighted * t_only_usd_per_word
    return {
        "ok": True,
        "cost": round_money(cost),
        "actual_word_count": word_count,
        "weighted_word_count": weighted,
        "discount_percent": int((pricing.discount or ZERO) * 100),
        "pricing_method": "aipe_actual_words" if pricing.rate_type == "aipe" else "t_only_discounted_words",
        "match_category": pricing.match_category,
    }


def compute_full_translation_baseline(text: str, aipe_usd_per_word: Decimal) -> dict[str, Any]:
    word_count = count_english_words(canonical_text_for_counting(text))
    if word_count is None:
        return {"reason": "baseline_local_word_count_missing"}
    wc_dec = Decimal(word_count)
    return {
        "ok": True,
        "cost": round_money(wc_dec * aipe_usd_per_word),
        "actual_word_count": word_count,
        "weighted_word_count": wc_dec,
        "discount_percent": 100,
        "pricing_method": "aipe_full_translation_baseline",
        "match_category": "full_translation_baseline",
    }


def compute_ac_costs(
    *,
    source_a_text: str,
    score_a: float | Decimal,
    match_category_a: Any,
    final_c_text: str,
    score_c: float | Decimal,
    match_category_c: Any,
    aipe_usd_per_word: Decimal,
    t_only_usd_per_word: Decimal,
) -> dict[str, Any]:
    """Compute Cost(A), Cost(C) and official saving (A−C) for one line.

    The server uses this per-(item, locale) for both A-job completion and
    C-job completion. The caller is responsible for passing already-validated
    rates and TM scores. Any invalid input returns an incomplete payload so
    the worker can mark that line terminal failure rather than forging 0.
    """

    rate = {"aipe": aipe_usd_per_word, "t_only": t_only_usd_per_word}
    a = compute_tm_cost(
        text=source_a_text,
        score=score_a,
        match_category=match_category_a,
        aipe_usd_per_word=rate["aipe"],
        t_only_usd_per_word=rate["t_only"],
        prefix="original_tm",
    )
    if not a.get("ok"):
        return {"status": "incomplete", "reason": a.get("reason"), "a": None, "c": None, "saving": None}
    c = compute_tm_cost(
        text=final_c_text,
        score=score_c,
        match_category=match_category_c,
        aipe_usd_per_word=rate["aipe"],
        t_only_usd_per_word=rate["t_only"],
        prefix="final_tm",
    )
    if not c.get("ok"):
        return {"status": "incomplete", "reason": c.get("reason"), "a": a, "c": None, "saving": None}
    saving = a["cost"] - c["cost"]
    return {
        "status": "complete",
        "reason": "",
        "a": a,
        "c": c,
        "saving": round_money(saving),
    }
