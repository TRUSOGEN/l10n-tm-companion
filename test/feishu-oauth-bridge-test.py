"""验证 Native Host 对飞书用户 OAuth 的公开消息接口。"""

from __future__ import annotations

import importlib.util
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


# This test exercises the legacy local-secret path; opt in via the dev-only flag.
os.environ["L10N_LOCAL_SECRET_DEV_ONLY"] = "1"


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BRIDGE_PATH = PROJECT_ROOT / "native-host" / "starling-bridge.py"
sys.path.insert(0, str(BRIDGE_PATH.parent))
SPEC = importlib.util.spec_from_file_location("starling_bridge", BRIDGE_PATH)
assert SPEC and SPEC.loader
bridge = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bridge)


class FeishuOAuthBridgeTest(unittest.TestCase):
    """覆盖 Popup 经 Native Messaging 进入本机 OAuth 模块的参数契约。"""

    def test_info_exposes_the_fixed_callback_without_credentials(self) -> None:
        """Settings 能取得回调地址，不会读取或回显 App Secret。"""
        self.assertEqual(
            bridge.feishu_oauth_info({}),
            {
                "ok": True,
                "app_id": "cli_aab1ca4137badbc4",
                "redirect_uri": "http://localhost:39641/l10n-tm-companion/oauth/callback",
                "scope": bridge.feishu_oauth.FEISHU_USER_SCOPE,
            },
        )

    def test_user_oauth_uses_fixed_app_id_and_keychain_backed_pkce(self) -> None:
        """Native Host 以内置 App ID 发起 PKCE，Secret 只由 OAuth 模块从 Keychain 读取。"""
        with patch.object(bridge.feishu_oauth, "authorize_user", return_value={"ok": True}) as authorize:
            result = bridge.feishu_user_oauth({
                "return_url": "https://bytedance.larkoffice.com/sheets/original",
            })
        self.assertEqual(result, {"ok": True})
        authorize.assert_called_once_with(
            app_id=bridge.feishu_oauth.FEISHU_APP_ID,
            redirect_uri="http://localhost:39641/l10n-tm-companion/oauth/callback",
            scope=bridge.feishu_oauth.FEISHU_USER_SCOPE,
            return_url="https://bytedance.larkoffice.com/sheets/original",
        )

    def test_owner_setup_is_native_only_and_returns_status(self) -> None:
        """Owner setup 由 Native Host 完成，浏览器只能得到是否配置成功。"""
        with patch.object(
            bridge.feishu_oauth,
            "configure_app_secret",
            return_value={"ok": True, "configured": True},
        ) as configure:
            result = bridge.feishu_configure_app_secret({})
        self.assertEqual(result, {"ok": True, "configured": True})
        configure.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
