"""验证本机飞书 OAuth 授权模块的 URL、回调状态与令牌交换契约。"""

from __future__ import annotations

import importlib.util
import json
import subprocess
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

    def test_default_scope_includes_user_identity_permissions(self) -> None:
        """默认 OAuth 必须请求姓名头像和稳定用户 ID，用于 ROI Operator 审计。"""
        scopes = set(feishu_oauth.FEISHU_USER_SCOPE.split())
        self.assertIn("contact:user.base:readonly", scopes)
        self.assertIn("contact:user.employee_id:readonly", scopes)
        self.assertNotIn("auth:user.id:read", scopes)

    def test_default_scope_matches_wiki_and_bitable_operations(self) -> None:
        """固定 Wiki 解析与首次补字段必须请求后台真实的细分权限。"""
        scopes = set(feishu_oauth.FEISHU_USER_SCOPE.split())
        self.assertIn("wiki:node:read", scopes)
        self.assertNotIn("wiki:wiki:readonly", scopes)
        self.assertIn("base:field:create", scopes)
        self.assertIn("base:record:read", scopes)
        self.assertIn("base:record:retrieve", scopes)
        self.assertIn("base:view:read", scopes)
        self.assertIn("base:view:write_only", scopes)

    def test_default_scope_uses_enabled_granular_spreadsheet_permissions(self) -> None:
        """OAuth 必须匹配应用已开通的细分 Sheet scope，不再请求旧总权限。"""
        scopes = set(feishu_oauth.FEISHU_USER_SCOPE.split())
        self.assertIn("sheets:spreadsheet.meta:read", scopes)
        self.assertIn("sheets:spreadsheet:read", scopes)
        self.assertIn("sheets:spreadsheet:write_only", scopes)
        self.assertNotIn("sheets:spreadsheet", scopes)

    def test_exchange_uses_official_v2_endpoint_with_pkce_and_app_secret(self) -> None:
        """令牌交换必须同时使用官方 v2 接口、PKCE verifier 与服务端应用凭证。"""
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
            app_secret="secret-test",
            code="authorization-code",
            redirect_uri="http://localhost:39641/l10n-tm-companion/oauth/callback",
            code_verifier="pkce-verifier",
            opener=opener,
        )

        self.assertEqual(token["access_token"], "u-test-token")
        self.assertEqual(len(calls), 1)
        request, timeout = calls[0]
        self.assertEqual(
            request.full_url,
            "https://open.feishu.cn/open-apis/authen/v2/oauth/token",
        )
        self.assertEqual(timeout, 20)
        self.assertEqual(request.get_header("Content-type"), "application/json; charset=utf-8")
        self.assertEqual(json.loads(request.data), {
            "grant_type": "authorization_code",
            "client_id": "cli_test",
            "client_secret": "secret-test",
            "code": "authorization-code",
            "redirect_uri": "http://localhost:39641/l10n-tm-companion/oauth/callback",
            "code_verifier": "pkce-verifier",
        })

    def test_authorization_result_keeps_only_actual_granted_scope(self) -> None:
        """Native Host 只能回传 token 响应中的实际 scope，禁止回填申请 scope。"""
        result = feishu_oauth.build_authorization_result(
            {
                "access_token": "u-test-token",
                "expires_in": 7200,
                "scope": "base:table:read base:view:read",
            },
            redirect_uri="http://localhost:39641/l10n-tm-companion/oauth/callback",
            requested_scope="base:table:read base:view:read",
        )
        self.assertEqual(result["scope"], "base:table:read base:view:read")

    def test_authorization_result_rejects_missing_granted_scope(self) -> None:
        """飞书未返回实际 scope 时必须正确失败，不能声称申请权限均已授予。"""
        with self.assertRaisesRegex(
            feishu_oauth.OAuthError,
            "did not include granted scope",
        ):
            feishu_oauth.build_authorization_result(
                {"access_token": "u-test-token", "expires_in": 7200},
                redirect_uri="http://localhost:39641/l10n-tm-companion/oauth/callback",
                requested_scope="base:table:read",
            )

    def test_authorization_result_rejects_ungranted_requested_scope(self) -> None:
        """实际 token 缺少新增权限时必须提示先发布新版本再重新授权。"""
        with self.assertRaisesRegex(
            feishu_oauth.OAuthError,
            "base:record:retrieve.*publish a new app version.*authorize again",
        ):
            feishu_oauth.build_authorization_result(
                {
                    "access_token": "u-test-token",
                    "expires_in": 7200,
                    "scope": "base:table:read",
                },
                redirect_uri="http://localhost:39641/l10n-tm-companion/oauth/callback",
                requested_scope="base:table:read base:record:retrieve",
            )

    def test_authorize_stops_before_browser_when_app_secret_is_missing(self) -> None:
        """缺少安全配置时必须在打开授权页前失败，避免再次显示假成功回调。"""
        opened: list[str] = []
        with self.assertRaisesRegex(
            feishu_oauth.OAuthError,
            "secure token exchange is not configured",
        ):
            feishu_oauth.authorize_user(
                app_id="cli_test",
                browser_open=lambda url: opened.append(url) or True,
                secret_loader=lambda: "",
            )
        self.assertEqual(opened, [])

    def test_callback_copy_only_confirms_code_receipt(self) -> None:
        """本地回调只能确认收到授权码，不能在 token 交换前宣称授权完成。"""
        self.assertIn("Authorization response received", feishu_oauth.CALLBACK_RECEIVED_MESSAGE)
        self.assertNotIn("Authorization complete", feishu_oauth.CALLBACK_RECEIVED_MESSAGE)

    def test_success_callback_closes_or_returns_to_original_page(self) -> None:
        """成功回调优先关闭标签页，关闭受限时必须回到发起授权的原页面。"""
        page = feishu_oauth.build_callback_page(
            feishu_oauth.CALLBACK_RECEIVED_MESSAGE,
            success=True,
            return_url="https://bytedance.larkoffice.com/wiki/original?page=1",
        )
        self.assertIn("window.close()", page)
        self.assertIn("window.location.replace(returnUrl)", page)
        self.assertIn("https://bytedance.larkoffice.com/wiki/original?page=1", page)
        self.assertIn("Return to the original page", page)

    def test_callback_rejects_non_http_return_url(self) -> None:
        """本机 callback 不得把 javascript URL 写入 HTML 或执行上下文。"""
        page = feishu_oauth.build_callback_page(
            feishu_oauth.CALLBACK_RECEIVED_MESSAGE,
            success=True,
            return_url="javascript:alert(1)",
        )
        self.assertNotIn("javascript:alert", page)

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

    def test_tenant_token_uses_fixed_app_id_and_never_returns_secret(self) -> None:
        """共享 Secret 只进入飞书请求体，返回给浏览器的对象不得包含 Secret。"""
        calls = []

        def opener(request, timeout):
            calls.append((request, timeout))
            return _FakeResponse({
                "code": 0,
                "tenant_access_token": "tenant-test",
                "expire": 7200,
            })

        result = feishu_oauth.get_tenant_access_token("shared-secret", opener=opener)
        self.assertEqual(result, {"access_token": "tenant-test", "expires_in": 7200})
        body = json.loads(calls[0][0].data)
        self.assertEqual(body["app_id"], feishu_oauth.FEISHU_APP_ID)
        self.assertEqual(body["app_secret"], "shared-secret")
        self.assertNotIn("app_secret", result)

    def test_keychain_save_and_load_use_scoped_service(self) -> None:
        """Secret 必须写入当前用户 Keychain 的固定 service/account，不进项目文件。"""
        calls = []

        def runner(args, **kwargs):
            calls.append((args, kwargs))
            if "find-generic-password" in args:
                return subprocess.CompletedProcess(args, 0, stdout="stored-secret\n", stderr="")
            return subprocess.CompletedProcess(args, 0, stdout="", stderr="")

        feishu_oauth.save_app_secret("stored-secret", runner=runner)
        self.assertEqual(feishu_oauth.load_app_secret(runner=runner), "stored-secret")
        self.assertIn(feishu_oauth.KEYCHAIN_SERVICE, calls[0][0])
        self.assertIn(feishu_oauth.FEISHU_APP_ID, calls[0][0])
        self.assertEqual(calls[0][1]["capture_output"], True)

    def test_native_secret_prompt_hides_input(self) -> None:
        """Owner 配置必须使用系统隐藏输入框，Secret 不得经过扩展页面。"""
        calls = []

        def runner(args, **kwargs):
            calls.append((args, kwargs))
            return subprocess.CompletedProcess(args, 0, stdout="owner-secret\n", stderr="")

        self.assertEqual(feishu_oauth.prompt_app_secret(runner=runner), "owner-secret")
        self.assertEqual(calls[0][0][0], "/usr/bin/osascript")
        self.assertIn("with hidden answer", calls[0][0][-1])

    def test_owner_setup_validates_and_saves_without_returning_secret(self) -> None:
        """Owner 本机配置只返回状态，不能把 Secret 或 tenant token 发给 Chrome。"""
        events = []
        result = feishu_oauth.configure_app_secret(
            secret_prompt=lambda: "owner-secret",
            validator=lambda secret: events.append(("validate", secret)) or {
                "access_token": "tenant-test",
                "expires_in": 7200,
            },
            saver=lambda secret: events.append(("save", secret)),
        )
        self.assertEqual(result, {"ok": True, "configured": True})
        self.assertEqual(events, [
            ("validate", "owner-secret"),
            ("save", "owner-secret"),
        ])
        self.assertNotIn("secret", result)
        self.assertNotIn("access_token", result)


if __name__ == "__main__":
    unittest.main()
