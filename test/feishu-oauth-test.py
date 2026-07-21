"""验证本机飞书 OAuth 授权模块的 URL、回调状态与令牌交换契约。"""

from __future__ import annotations

import importlib.util
import json
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlparse


PROJECT_ROOT = Path(__file__).resolve().parents[1]
OAUTH_MODULE_PATH = PROJECT_ROOT / "native-host" / "feishu_oauth.py"
SPEC = importlib.util.spec_from_file_location("feishu_oauth", OAUTH_MODULE_PATH)
assert SPEC and SPEC.loader
feishu_oauth = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(feishu_oauth)


class _FakeResponse:
    """承载 OAuth 成功响应的最小 urllib 上下文管理器。"""

    def __init__(self, payload: dict[str, object]) -> None:
        """保存将要返回的 JSON 数据。"""
        self.payload = payload

    def __enter__(self) -> "_FakeResponse":
        """返回自身以满足 urllib 的上下文协议。"""
        return self

    def __exit__(self, exc_type, exc_value, traceback) -> bool:
        """不吞掉上下文中的异常。"""
        return False

    def read(self) -> bytes:
        """返回 JSON 编码后的模拟响应体。"""
        return json.dumps(self.payload).encode("utf-8")


class FeishuOAuthTest(unittest.TestCase):
    """覆盖 OAuth 的公开模块接口，不启动真实浏览器或网络请求。"""

    def test_authorize_url_preserves_pkce_callback_scope_and_state(self) -> None:
        """授权地址必须携带 PKCE 挑战码、最小 scope、回调地址与不可替换的 state。"""
        url = urlparse(feishu_oauth.build_authorize_url(
            app_id="cli_test",
            redirect_uri="http://localhost:39641/l10n-tm-companion/oauth/callback",
            scope="base:table:read base:table:create base:field:read base:record:create base:record:update base:block:read base:block:update",
            state="state-expected",
            code_challenge="pkce-challenge",
        ))
        query = parse_qs(url.query)
        self.assertEqual(url.scheme, "https")
        self.assertEqual(url.netloc, "accounts.feishu.cn")
        self.assertEqual(url.path, "/open-apis/authen/v1/authorize")
        self.assertEqual(query["client_id"], ["cli_test"])
        self.assertEqual(query["response_type"], ["code"])
        self.assertEqual(query["redirect_uri"], [
            "http://localhost:39641/l10n-tm-companion/oauth/callback",
        ])
        self.assertEqual(
            query["scope"],
            ["base:table:read base:table:create base:field:read base:record:create base:record:update base:block:read base:block:update"],
        )
        self.assertEqual(query["state"], ["state-expected"])
        self.assertEqual(query["prompt"], ["consent"])
        self.assertEqual(query["code_challenge"], ["pkce-challenge"])
        self.assertEqual(query["code_challenge_method"], ["S256"])

    def test_exchange_uses_pkce_without_app_secret(self) -> None:
        """令牌交换必须使用 PKCE verifier，且请求体绝不能包含 App Secret。"""
        calls: list[tuple[object, float]] = []

        def opener(request, timeout):
            calls.append((request, timeout))
            return _FakeResponse({
                "access_token": "u-test-token",
                "expires_in": 7200,
                "scope": "base:table:read",
            })

        token = feishu_oauth.exchange_authorization_code(
            app_id="cli_test",
            code="authorization-code",
            redirect_uri="http://localhost:39641/l10n-tm-companion/oauth/callback",
            code_verifier="pkce-verifier",
            opener=opener,
        )

        self.assertEqual(token["access_token"], "u-test-token")
        self.assertEqual(len(calls), 1)
        request, timeout = calls[0]
        self.assertEqual(request.full_url, "https://accounts.feishu.cn/oauth/v3/token")
        self.assertEqual(timeout, 20)
        self.assertEqual(request.get_header("Content-type"), "application/json; charset=utf-8")
        self.assertEqual(json.loads(request.data), {
            "grant_type": "authorization_code",
            "client_id": "cli_test",
            "code": "authorization-code",
            "redirect_uri": "http://localhost:39641/l10n-tm-companion/oauth/callback",
            "code_verifier": "pkce-verifier",
        })

    def test_pkce_challenge_is_stable_and_url_safe(self) -> None:
        """挑战码必须由 verifier 确定性派生，且符合 URL-safe base64 形式。"""
        challenge = feishu_oauth.build_code_challenge("A" * 64)
        self.assertEqual(challenge, feishu_oauth.build_code_challenge("A" * 64))
        self.assertNotIn("=", challenge)
        self.assertRegex(challenge, r"^[A-Za-z0-9_-]+$")

    def test_callback_rejects_mismatched_state_before_token_exchange(self) -> None:
        """回调 state 不匹配时必须停止，避免错误会话或 CSRF 写入用户令牌。"""
        with self.assertRaisesRegex(feishu_oauth.OAuthError, "state mismatch"):
            feishu_oauth.validate_callback(
                {"code": ["authorization-code"], "state": ["other-state"]},
                expected_state="expected-state",
            )

    def test_callback_reports_user_denial_without_code(self) -> None:
        """用户拒绝授权时，模块返回可解释的失败而非把空 code 发送到 token 接口。"""
        with self.assertRaisesRegex(feishu_oauth.OAuthError, "access_denied"):
            feishu_oauth.validate_callback(
                {"error": ["access_denied"], "state": ["expected-state"]},
                expected_state="expected-state",
            )


if __name__ == "__main__":
    unittest.main()
