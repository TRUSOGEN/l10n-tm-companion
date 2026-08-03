#!/usr/bin/env python3
"""A4: native host legacy-secret action gating.

When L10N_LOCAL_SECRET_DEV_ONLY is unset / '0', the four mutable / secret-bearing
legacy actions reject unqualified requests. They are allowed only when the trusted
extension explicitly marks a broker-off legacy choice, or when the developer-only
environment flag is set to '1'.

Read-only informational actions (feishu_oauth_info, feishu_secret_status) remain
available so the Settings UI can display configuration hints without touching
secret material or exchanging tokens.
"""

from __future__ import annotations

import importlib.util
import os
import sys
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'native-host'))


def _load_module(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'native-host' / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


class _FakeFeishuOauth(types.ModuleType):
    """Captures calls into the legacy feishu_oauth helper without doing I/O."""

    FEISHU_APP_ID = 'cli_test_app'
    REDIRECT_URI = 'http://localhost:39641/callback'
    FEISHU_USER_SCOPE = 'sheets:spreadsheet'

    def __init__(self, name):
        super().__init__(name)
        self.calls = []
        self._secret = ''

    def authorize_user(self, **kwargs):
        self.calls.append(('authorize_user', kwargs))
        return {'ok': True, 'access_token': 'u-token', 'scope': self.FEISHU_USER_SCOPE, 'expires_in': 7200}

    def configure_app_secret(self, **kwargs):
        self.calls.append(('configure_app_secret', kwargs))
        return {'ok': True, 'configured': True}

    def load_app_secret(self, **kwargs):
        self.calls.append(('load_app_secret', kwargs))
        return self._secret

    def save_app_secret(self, secret, **kwargs):
        self.calls.append(('save_app_secret', {'secret': secret, **kwargs}))
        self._secret = secret
        return True

    def get_tenant_access_token(self, secret, **kwargs):
        self.calls.append(('get_tenant_access_token', {'secret': secret, **kwargs}))
        return {'access_token': 't-token', 'expires_in': 7200, 'token_type': 'tenant'}


class NativeLegacySecretGatingTests(unittest.TestCase):
    LEGACY_ACTIONS = (
        'feishu_user_oauth',
        'feishu_configure_app_secret',
        'feishu_save_secret',
        'feishu_get_access_token',
    )

    def setUp(self):
        for key in ('L10N_LOCAL_SECRET_DEV_ONLY',):
            os.environ.pop(key, None)

    def _reload_bridge(self):
        if 'l10n_starling_bridge' in sys.modules:
            del sys.modules['l10n_starling_bridge']
        # Stub the broker modules — these tests focus on top-level legacy routing.
        fake_broker_oauth = types.ModuleType('fake_feishu_broker')
        fake_broker_oauth.authorize_via_broker = lambda **kw: {'ok': True}
        fake_broker_oauth.broker_authorization_status = lambda **kw: {'ok': True}
        fake_broker_oauth.revoke_broker_authorization = lambda **kw: {'ok': True}
        fake_broker_oauth.get_broker_access_token = lambda **kw: {'ok': True}
        sys.modules['l10n_feishu_oauth_broker'] = fake_broker_oauth

        fake_roi_broker = types.ModuleType('fake_roi_broker')
        fake_roi_broker.create_run = lambda payload: {'ok': True}
        fake_roi_broker.submit_final = lambda *a, **kw: {'ok': True}
        fake_roi_broker.get_run_status = lambda rid: {'ok': True, 'run_id': rid, 'revision': 1}
        fake_roi_broker.request_archive = lambda rid, payload: {'ok': True, 'run_id': rid}
        sys.modules['l10n_roi_broker_client'] = fake_roi_broker

        self.fake_oauth = _FakeFeishuOauth('fake_feishu_oauth')
        sys.modules['l10n_feishu_oauth'] = self.fake_oauth
        # Force starling-bridge to import our stub.
        import importlib
        self.bridge = _load_module('l10n_starling_bridge', 'starling-bridge.py')
        self.bridge.feishu_oauth = self.fake_oauth
        self.bridge.feishu_oauth_broker = fake_broker_oauth
        self.bridge.roi_broker_client = fake_roi_broker

    def _dispatch(self, action, **payload):
        # Bypass stdin/stdout by calling the handler helper directly.
        handlers = {
            'feishu_oauth_info': self.bridge.feishu_oauth_info,
            'feishu_user_oauth': self.bridge.feishu_user_oauth,
            'feishu_configure_app_secret': self.bridge.feishu_configure_app_secret,
            'feishu_secret_status': self.bridge.feishu_secret_status,
            'feishu_save_secret': self.bridge.feishu_save_secret,
            'feishu_get_access_token': self.bridge.feishu_get_access_token,
        }
        return handlers[action]({'action': action, **payload})

    def test_legacy_secret_actions_rejected_when_dev_only_off(self):
        os.environ['L10N_LOCAL_SECRET_DEV_ONLY'] = '0'
        self._reload_bridge()

        for action in self.LEGACY_ACTIONS:
            with self.subTest(action=action):
                self.fake_oauth.calls.clear()
                result = self._dispatch(action, app_secret='x-secret', return_url='https://example.com')
                self.assertFalse(result.get('ok'), f'{action} should be rejected when dev-only off: {result}')
                self.assertEqual(result.get('error_code'), 'legacy_secret_disabled')
                self.assertIn('L10N_LOCAL_SECRET_DEV_ONLY=1', str(result.get('error')))
                self.assertEqual(self.fake_oauth.calls, [], f'{action} must not reach feishu_oauth helper')

        # read-only status actions remain available without touching secret mutators
        self.fake_oauth.calls.clear()
        info = self._dispatch('feishu_oauth_info')
        self.assertTrue(info.get('ok'))
        self.assertIn('app_id', info)
        # feishu_secret_status reads load_app_secret (read-only); should still work.
        status = self._dispatch('feishu_secret_status')
        self.assertTrue(status.get('ok'))
        self.assertIn('configured', status)
        # No mutating helper should be invoked by the two read-only actions.
        mutating = [name for name, _ in self.fake_oauth.calls if name in ('authorize_user', 'configure_app_secret', 'save_app_secret', 'get_tenant_access_token')]
        self.assertEqual(mutating, [], f'mutating helpers must not be reached: {self.fake_oauth.calls}')

    def test_legacy_secret_actions_allowed_when_dev_only_on(self):
        os.environ['L10N_LOCAL_SECRET_DEV_ONLY'] = '1'
        self._reload_bridge()

        self.fake_oauth.calls.clear()
        result = self._dispatch('feishu_user_oauth', return_url='https://example.com')
        self.assertTrue(result.get('ok'), result)
        self.assertIn(('authorize_user',), [(name,) for name, _ in self.fake_oauth.calls])

        self.fake_oauth.calls.clear()
        result = self._dispatch('feishu_configure_app_secret')
        self.assertTrue(result.get('ok'), result)
        self.assertIn(('configure_app_secret',), [(name,) for name, _ in self.fake_oauth.calls])

        self.fake_oauth.calls.clear()
        result = self._dispatch('feishu_save_secret', app_secret='x-dev-secret')
        self.assertTrue(result.get('ok'), result)
        self.assertIn(('save_app_secret',), [(name,) for name, _ in self.fake_oauth.calls])

        self.fake_oauth.calls.clear()
        result = self._dispatch('feishu_get_access_token')
        self.assertTrue(result.get('ok'), result)
        # get_access_token loads secret and exchanges it — both helpers should be reached.
        names = [name for name, _ in self.fake_oauth.calls]
        self.assertIn('load_app_secret', names)
        self.assertIn('get_tenant_access_token', names)

    def test_browser_authorized_legacy_actions_allowed_when_env_off(self):
        """Broker 关闭时，受信扩展可显式授权现有本地 Secret 路径。"""
        os.environ['L10N_LOCAL_SECRET_DEV_ONLY'] = '0'
        self._reload_bridge()

        result = self._dispatch(
            'feishu_user_oauth',
            return_url='https://example.com',
            allow_legacy_local_secret=True,
        )
        self.assertTrue(result.get('ok'), result)
        self.assertIn('authorize_user', [name for name, _ in self.fake_oauth.calls])


if __name__ == '__main__':
    out_dir = ROOT / 'temp' / 'broker-rollout'
    out_dir.mkdir(parents=True, exist_ok=True)
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(unittest.defaultTestLoader.loadTestsFromTestCase(NativeLegacySecretGatingTests))
    if not result.wasSuccessful():
        sys.exit(1)
    print('PASS A4 Python legacy-secret gating: broker-on blocks fallback; broker-off and dev opt-in work.')
