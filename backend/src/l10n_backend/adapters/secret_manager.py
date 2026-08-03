"""Company Secret Manager adapter stub.

Production secrets (Feishu app secret, Starling AK/SK, KMS-wrapped DEK) must
be resolved through the company Secret Manager. Until the company owner wires
the real SDK/endpoint, this adapter fails loudly rather than falling back to
environment variables.
"""

from __future__ import annotations


_PRODUCTION_WIRING_MSG = "Secret Manager adapter is not wired yet. Awaiting company Secret Manager owner inputs."


class SecretManagerAdapter:
    """Stub of the company Secret Manager client."""

    def __init__(self, *, secret_prefix: str = "") -> None:
        self.secret_prefix = secret_prefix

    def get_secret(self, name: str) -> str:
        raise RuntimeError(_PRODUCTION_WIRING_MSG)


class EnvVarSecretProvider:
    """Development-only secret resolver that reads from ``L10N_*`` env vars.

    The secret name is upper-cased, non-alphanumeric characters are replaced
    with underscores, and the ``L10N_`` prefix is prepended. This is strictly
    for local dev / tests; production MUST use SecretManagerAdapter.
    """

    _SANITIZE = str.maketrans({c: "_" for c in " -/.:"})

    def __init__(self, env: dict[str, str] | None = None) -> None:
        import os

        self._env = env if env is not None else os.environ

    def get_secret(self, name: str) -> str:
        if not name:
            return ""
        key = "L10N_" + str(name).translate(self._SANITIZE).strip("_").upper()
        value = self._env.get(key, "")
        # Convenience: for secret names that already end in a known suffix,
        # also try a direct lookup to avoid surprises with special characters.
        if not value:
            value = self._env.get(f"L10N_{name}", "")
        return value
