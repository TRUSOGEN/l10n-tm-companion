"""验证 Native Host 对飞书用户 OAuth 的公开消息接口。"""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


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
                "scope": "sheets:spreadsheet wiki:wiki:readonly base:table:read base:table:create base:field:read base:record:create base:record:update base:block:read base:block:update",
            },
        )

    def test_user_oauth_uses_bundled_public_app_id_and_pkce(self) -> None:
        """Native Host 不接收 App Secret，只以内置公开 App ID 发起 PKCE OAuth。"""
        with patch.object(bridge.feishu_oauth, "authorize_user", return_value={"ok": True}) as authorize:
            result = bridge.feishu_user_oauth({})
        self.assertEqual(result, {"ok": True})
        authorize.assert_called_once_with(
            app_id=bridge.feishu_oauth.FEISHU_APP_ID,
            redirect_uri="http://localhost:39641/l10n-tm-companion/oauth/callback",
            scope=bridge.feishu_oauth.FEISHU_USER_SCOPE,
        )


if __name__ == "__main__":
    unittest.main()
