"""Safe logging helpers.

Logs are deliberately redacted so tokens, authorization codes, PKCE verifiers,
full source text, final C and Feishu upstream error bodies never appear in
diagnostic output.
"""

from __future__ import annotations

import logging
import re
from typing import Any

import structlog

_SENSITIVE_KEYS = {
    "authorization",
    "cookie",
    "set-cookie",
    "x-feishu-app-secret",
    "x-l10n-device-token",
    "access_token",
    "refresh_token",
    "device_session_token",
    "code",
    "code_verifier",
    "client_secret",
    "app_secret",
    "tenant_access_token",
    "source_text",
    "final_text",
    "final_text_hash",
    "source_hash",
}
_SENSITIVE_STRING_PATTERNS = [
    re.compile(r"Bearer\s+[A-Za-z0-9._\-]+", re.IGNORECASE),
]
_REDACTED = "***REDACTED***"


def _redact_value(key: str, value: Any) -> Any:
    if key.lower() in _SENSITIVE_KEYS:
        return _REDACTED
    if isinstance(value, str):
        for pattern in _SENSITIVE_STRING_PATTERNS:
            value = pattern.sub(f"Bearer {_REDACTED}", value)
        return value
    if isinstance(value, dict):
        return {k: _redact_value(str(k), v) for k, v in value.items()}
    if isinstance(value, list):
        return [_redact_value(key, item) for item in value]
    return value


def redact_event(logger: Any, method_name: str, event_dict: dict[str, Any]) -> dict[str, Any]:
    """structlog processor that redacts sensitive keys from every event."""

    return _redact_value("event", event_dict)


def configure_logging(level: str = "INFO") -> None:
    """Configure structured logging with safe redaction."""

    logging.basicConfig(format="%(message)s", level=level)
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            redact_event,
            structlog.dev.ConsoleRenderer() if __debug__ else structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, level.upper(), logging.INFO)
        ),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str) -> structlog.stdlib.BoundLogger:
    """Return a namespaced structured logger."""

    return structlog.get_logger(name)
