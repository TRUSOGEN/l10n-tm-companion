#!/usr/bin/env python3
"""A1 failing test: native-host envelope routing for broker requests.

This test imports starling-bridge.py helpers without launching the stdin loop,
then calls native_broker_request() to ensure subactions are dispatched to the
correct broker helper and that unknown subactions return an explicit error
instead of falling through to the top-level Unknown action path.
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


class _FakeBrokerOAuth(types.ModuleType):
    calls = []

    def authorize_via_broker(self, **kwargs):
        self.calls.append(("authorize_via_broker", kwargs))
        return {"ok": True, "action": "authorize_via_broker"}

    def broker_authorization_status(self, **kwargs):
        self.calls.append(("broker_authorization_status", kwargs))
        return {"ok": True, "action": "broker_authorization_status"}

    def revoke_broker_authorization(self, **kwargs):
        self.calls.append(("revoke_broker_authorization", kwargs))
        return {"ok": True, "action": "revoke_broker_authorization"}

    def get_broker_access_token(self, **kwargs):
        self.calls.append(("get_broker_access_token", kwargs))
        return {"ok": True, "action": "get_broker_access_token"}


class _FakeRoiBroker(types.ModuleType):
    calls = []

    def create_run(self, payload):
        self.calls.append(("create_run", payload))
        return {"ok": True, "action": "create_run"}

    def submit_final(self, run_id, item_id, payload):
        self.calls.append(("submit_final", run_id, item_id, payload))
        return {"ok": True, "action": "submit_final"}

    def get_run_status(self, run_id):
        self.calls.append(("get_run_status", run_id))
        return {"ok": True, "action": "get_run_status"}

    def request_archive(self, run_id, payload):
        self.calls.append(("request_archive", run_id, payload))
        return {"ok": True, "action": "request_archive"}


class NativeBrokerRoutingTests(unittest.TestCase):
    def setUp(self):
        self.feishu_oauth_broker = _FakeBrokerOAuth('fake_feishu_broker')
        self.feishu_oauth_broker.calls = []
        self.roi_broker_client = _FakeRoiBroker('fake_roi_broker')
        self.roi_broker_client.calls = []

        # Reload bridge module each time with patched broker modules.
        if 'l10n_starling_bridge' in sys.modules:
            del sys.modules['l10n_starling_bridge']
        self.bridge = _load_module('l10n_starling_bridge', 'starling-bridge.py')
        self.bridge.feishu_oauth_broker = self.feishu_oauth_broker
        self.bridge.roi_broker_client = self.roi_broker_client

    def _dispatch(self, subaction: str, **extra):
        return self.bridge.native_broker_request({
            'payload': {'action': subaction, 'plugin_version': '1.5.0', **extra},
        })

    def test_oauth_and_roi_subactions_route_to_correct_helpers(self):
        self._dispatch('feishu_broker_oauth_start', return_url='https://example.com')
        self._dispatch('feishu_broker_status')
        self._dispatch('feishu_broker_revoke')
        self._dispatch('feishu_broker_token', grant_id='g-1', known_token_version=1)
        self._dispatch('roi_broker_create_run', body={'client_run_id': 'r-1'})
        self._dispatch('roi_broker_submit_final', run_id='r-1', item_id='i-1', body={})
        self._dispatch('roi_broker_get_run', run_id='r-1')
        self._dispatch('roi_broker_archive', run_id='r-1', body={})

        oauth_calls = [name for name, _ in self.feishu_oauth_broker.calls]
        roi_calls = [name for name, *_ in self.roi_broker_client.calls]
        self.assertEqual(oauth_calls, [
            'authorize_via_broker',
            'broker_authorization_status',
            'revoke_broker_authorization',
            'get_broker_access_token',
        ])
        self.assertEqual(roi_calls, ['create_run', 'submit_final', 'get_run_status', 'request_archive'])

    def test_unknown_subaction_returns_explicit_error_from_broker_dispatcher(self):
        result = self._dispatch('unknown_broker_action')
        self.assertFalse(result.get('ok'))
        self.assertIn('Unknown broker action', str(result.get('error')))
        self.assertEqual(self.feishu_oauth_broker.calls, [])
        self.assertEqual(self.roi_broker_client.calls, [])


if __name__ == '__main__':
    # Mirror the contract: failing before fix must be reproducible, output stored under temp.
    out_dir = ROOT / 'temp' / 'broker-rollout'
    out_dir.mkdir(parents=True, exist_ok=True)
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(unittest.defaultTestLoader.loadTestsFromTestCase(NativeBrokerRoutingTests))
    if not result.wasSuccessful():
        sys.exit(1)
    print('PASS A1 Python routing: native_broker_request dispatches all seven helper actions and rejects unknown subactions.')
