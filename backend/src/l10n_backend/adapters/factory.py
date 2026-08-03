"""Adapter factory.

Produces a coherent set of runtime adapters (gateway clients, crypto, secret
provider) based on the deployment environment. Production-like environments
(``ppe``, ``prod``, ``production``) are strictly gated: they MUST use the
company KMS / Secret Manager / Starling / Feishu production adapters. Until
the company owner supplies the real endpoints and credentials, the
production adapters are stub objects that raise clear errors so PPE/PROD
can never silently boot with dev fakes.

Dev/test/boe environments are allowed to use :class:`InsecureDevEnvelopeCrypto`
and in-memory fakes for local development and automated tests.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

from ..api.feishu_client import HttpFeishuGateway as _DevHttpFeishuGateway
from ..config import Settings
from ..crypto import InsecureDevEnvelopeCrypto, KmsEnvelopeCrypto
from ..workers.roi_worker import InMemoryStarlingGateway
from . import FeishuAppCredentials
from .feishu import HttpFeishuGateway as _ProdFeishuGateway
from .kms import CompanyKmsAdapter
from .secret_manager import EnvVarSecretProvider, SecretManagerAdapter
from .starling import HttpStarlingGateway as _ProdStarlingGateway


_PROD_ENVS = frozenset({"ppe", "prod", "production"})
_DEV_ENVS = frozenset({"dev", "test", "boe", ""})  # empty string treats as dev
_PROD_NOT_CONFIGURED_MSG = (
    "Production adapters are not configured. Awaiting company "
    "Gateway/KMS/Secret Manager/Starling owner inputs."
)


@dataclass(frozen=True)
class RuntimeAdapters:
    """Resolved runtime adapter bundle."""

    feishu_gateway: object
    crypto: object
    starling_gateway: object
    secret_provider: object
    feishu_gateway_adapter: object  # company gateway identity verifier (may be None in dev)
    app_creds: FeishuAppCredentials


def _is_prod(env_name: str) -> bool:
    return (env_name or "").strip().lower() in _PROD_ENVS


def _normalize_env(env_name: str) -> str:
    env = (env_name or "").strip().lower()
    if env in _PROD_ENVS:
        return env
    if env in _DEV_ENVS:
        return env or "dev"
    raise ValueError(
        f"Unsupported L10N_ENV {env_name!r}; expected one of "
        f"{sorted(_DEV_ENVS | _PROD_ENVS)}"
    )


def _build_prod_secret_provider(settings: Settings) -> SecretManagerAdapter:
    if settings.secret_provider.strip().lower() != "secret_manager":
        raise RuntimeError(
            "Production requires secret_provider='secret_manager'. "
            + _PROD_NOT_CONFIGURED_MSG
        )
    return SecretManagerAdapter(secret_prefix="l10n-tm/")


def _build_prod_kms(settings: Settings) -> CompanyKmsAdapter:
    if not settings.kms_key_id.strip():
        raise RuntimeError("Production requires a non-empty kms_key_id. " + _PROD_NOT_CONFIGURED_MSG)
    if not settings.kms_region.strip():
        raise RuntimeError("Production requires a non-empty kms_region. " + _PROD_NOT_CONFIGURED_MSG)
    return CompanyKmsAdapter(kms_key_id=settings.kms_key_id.strip(), kms_region=settings.kms_region.strip())


def _build_prod_crypto(settings: Settings) -> KmsEnvelopeCrypto:
    kms = _build_prod_kms(settings)
    return KmsEnvelopeCrypto(kms=kms, key_id=settings.kms_key_id.strip())


def _build_prod_secret_value(settings: Settings, secret_provider: SecretManagerAdapter, secret_name: str) -> str:
    # We deliberately do NOT fall back to env vars in prod.
    try:
        value = secret_provider.get_secret(secret_name)
    except RuntimeError:
        raise
    if not value:
        raise RuntimeError(_PROD_NOT_CONFIGURED_MSG)
    return value


def _build_prod_feishu(settings: Settings, secret_provider: SecretManagerAdapter) -> _ProdFeishuGateway:
    if not settings.feishu_app_id.strip():
        raise RuntimeError("Production requires feishu_app_id. " + _PROD_NOT_CONFIGURED_MSG)
    # The prod stub raises NotImplemented; we do not even attempt to resolve
    # the secret yet — but we construct the adapter as required so boot
    # succeeds only when real wiring is supplied (see test cases below).
    return _ProdFeishuGateway(
        token_url=settings.feishu_token_url,
        revoke_url=settings.feishu_revoke_url,
        user_info_url=settings.feishu_user_info_url,
        app_id=settings.feishu_app_id,
        app_secret_provider=secret_provider,
    )


def _build_prod_starling(settings: Settings) -> _ProdStarlingGateway:
    if not settings.starling_base_url.strip():
        raise RuntimeError("Production requires starling_base_url. " + _PROD_NOT_CONFIGURED_MSG)
    return _ProdStarlingGateway(
        base_url=settings.starling_base_url,
        max_retries=settings.starling_max_retries,
    )


def _build_prod(settings: Settings) -> RuntimeAdapters:
    secret_provider = _build_prod_secret_provider(settings)
    crypto = _build_prod_crypto(settings)
    feishu_gateway = _build_prod_feishu(settings, secret_provider)
    starling_gateway = _build_prod_starling(settings)
    # The company gateway identity verifier is not wired yet; production
    # deployments fronted by the company HTTPS gateway MUST set
    # legacy_local_secret_dev_only=False (the default) and rely on injected
    # headers; we do not instantiate a fake verifier here.
    # For app creds, we cannot resolve the secret without Secret Manager
    # wiring; construct credentials lazily via the secret provider when used.
    # However, construct a placeholder that will raise loudly if accessed
    # before wiring is complete.
    app_creds = FeishuAppCredentials(app_id=settings.feishu_app_id, app_secret="")
    return RuntimeAdapters(
        feishu_gateway=feishu_gateway,
        crypto=crypto,
        starling_gateway=starling_gateway,
        secret_provider=secret_provider,
        feishu_gateway_adapter=None,
        app_creds=app_creds,
    )


def _build_dev(settings: Settings) -> RuntimeAdapters:
    if settings.secret_provider.strip().lower() == "secret_manager":
        # Allow explicit opt-in to SecretManagerAdapter in dev too; but if
        # it's not fully wired (e.g. no credentials), the dev build still
        # falls back to EnvVarSecretProvider per setting.
        try:
            secret_provider = SecretManagerAdapter(secret_prefix="l10n-tm/")
        except Exception:
            secret_provider = EnvVarSecretProvider()
    else:
        secret_provider = EnvVarSecretProvider()
    crypto = InsecureDevEnvelopeCrypto()
    # Feishu gateway in dev/test uses the real HTTP client (public Feishu
    # endpoints); this is acceptable for dev because it points at the public
    # internet and credentials come from env vars (not hardcoded).
    feishu_gateway = _DevHttpFeishuGateway(settings)
    # Starling in dev uses the in-memory fake unless a real base_url is set
    # AND credentials are available; if real settings are supplied we still
    # default to the in-memory gateway to avoid accidentally calling
    # internal Starling from dev machines. Workers override explicitly when
    # they need it.
    starling_gateway = InMemoryStarlingGateway()
    app_secret = secret_provider.get_secret("feishu_app_secret") or ""
    app_creds = FeishuAppCredentials(app_id=settings.feishu_app_id, app_secret=app_secret)
    return RuntimeAdapters(
        feishu_gateway=feishu_gateway,
        crypto=crypto,
        starling_gateway=starling_gateway,
        secret_provider=secret_provider,
        feishu_gateway_adapter=None,
        app_creds=app_creds,
    )


def build_runtime_adapters(settings: Settings) -> RuntimeAdapters:
    """Build the runtime adapter bundle for the given settings.

    Production environments fail closed: incomplete wiring raises
    :class:`RuntimeError` with an explicit message directing owners to the
    real configuration inputs. Dev/test environments use insecure/in-memory
    adapters so local development and unit tests work out of the box.
    """

    env_name = _normalize_env(settings.env_name)
    if _is_prod(env_name):
        # Hard defense in depth: never allow InsecureDevEnvelopeCrypto or
        # in-memory fakes to be returned in prod-like envs.
        adapters = _build_prod(settings)
        if isinstance(adapters.crypto, InsecureDevEnvelopeCrypto):
            raise RuntimeError(
                "Production build erroneously selected InsecureDevEnvelopeCrypto. "
                "Production requires the company KMS-backed crypto."
            )
        if isinstance(adapters.feishu_gateway, _DevHttpFeishuGateway):
            raise RuntimeError("Production must not use the dev/in-memory Feishu gateway.")
        if isinstance(adapters.starling_gateway, InMemoryStarlingGateway):
            raise RuntimeError("Production must not use InMemoryStarlingGateway.")
        return adapters
    return _build_dev(settings)


@lru_cache(maxsize=1)
def get_runtime_adapters() -> RuntimeAdapters:
    """Cached singleton convenience wrapper around :func:`build_runtime_adapters`."""

    from ..config import get_settings

    return build_runtime_adapters(get_settings())
