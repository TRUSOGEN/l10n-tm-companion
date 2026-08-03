"""Tests for the Phase D adapter factory production gating."""

from __future__ import annotations

import pytest

from l10n_backend.adapters.factory import RuntimeAdapters, build_runtime_adapters
from l10n_backend.adapters.feishu import HttpFeishuGateway as ProdFeishu
from l10n_backend.adapters.kms import CompanyKmsAdapter
from l10n_backend.adapters.secret_manager import EnvVarSecretProvider, SecretManagerAdapter
from l10n_backend.adapters.starling import HttpStarlingGateway as ProdStarling
from l10n_backend.api.feishu_client import HttpFeishuGateway as DevFeishu
from l10n_backend.config import Settings
from l10n_backend.crypto import InsecureDevEnvelopeCrypto, KmsEnvelopeCrypto
from l10n_backend.workers.roi_worker import InMemoryStarlingGateway


def test_dev_defaults_build_insecure_adapters():
    s = Settings(env_name="dev")
    adapters = build_runtime_adapters(s)
    assert isinstance(adapters, RuntimeAdapters)
    assert isinstance(adapters.crypto, InsecureDevEnvelopeCrypto)
    assert isinstance(adapters.feishu_gateway, DevFeishu)
    assert isinstance(adapters.starling_gateway, InMemoryStarlingGateway)
    assert isinstance(adapters.secret_provider, EnvVarSecretProvider)


def test_prod_without_real_config_raises():
    s = Settings(env_name="prod")
    with pytest.raises(RuntimeError) as excinfo:
        build_runtime_adapters(s)
    msg = str(excinfo.value)
    assert "Production adapters are not configured" in msg


def test_prod_kms_set_but_env_secret_provider_raises():
    s = Settings(
        env_name="prod",
        kms_key_id="alias/l10n-tm",
        kms_region="cn-north-1",
        secret_provider="env",
    )
    with pytest.raises(RuntimeError) as excinfo:
        build_runtime_adapters(s)
    assert "secret_manager" in str(excinfo.value)


def test_prod_with_full_stub_config_builds_stubs():
    s = Settings(
        env_name="prod",
        kms_key_id="alias/l10n-tm",
        kms_region="cn-north-1",
        secret_provider="secret_manager",
        starling_base_url="https://starling.example.internal",
        feishu_app_id="cli_prod_app",
    )
    adapters = build_runtime_adapters(s)
    assert isinstance(adapters.crypto, KmsEnvelopeCrypto)
    assert not isinstance(adapters.crypto, InsecureDevEnvelopeCrypto)
    assert isinstance(adapters.feishu_gateway, ProdFeishu)
    assert not isinstance(adapters.feishu_gateway, DevFeishu)
    assert isinstance(adapters.starling_gateway, ProdStarling)
    assert not isinstance(adapters.starling_gateway, InMemoryStarlingGateway)
    assert isinstance(adapters.secret_provider, SecretManagerAdapter)
    # Sanity: underlying KMS is wired but not functional.
    assert isinstance(adapters.crypto.kms, CompanyKmsAdapter)


def test_prod_stubs_loudly_fail():
    s = Settings(
        env_name="prod",
        kms_key_id="alias/l10n-tm",
        kms_region="cn-north-1",
        secret_provider="secret_manager",
        starling_base_url="https://starling.example.internal",
    )
    adapters = build_runtime_adapters(s)
    with pytest.raises(RuntimeError, match="not wired yet"):
        adapters.crypto.encrypt("hello")
    with pytest.raises(RuntimeError, match="not wired yet"):
        adapters.secret_provider.get_secret("any")
    with pytest.raises(RuntimeError, match="not wired yet"):
        adapters.starling_gateway.batch_tm(
            access_key="",
            secret_key="",
            project_ids=[],
            source_locale="en",
            target_locale="zh",
            source_contents=["hi"],
        )
    with pytest.raises(RuntimeError, match="Secret Manager wiring"):
        adapters.feishu_gateway.user_info("token")
