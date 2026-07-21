#!/usr/bin/env python3
"""Starling Native Host 凭证注入与运行门禁回归测试。"""

import importlib.util
import os
import unittest


def load_bridge():
    """按文件路径加载 Native Messaging bridge。"""
    bridge_path = os.path.join(
        os.path.dirname(__file__), '..', 'native-host', 'starling-bridge.py'
    )
    spec = importlib.util.spec_from_file_location('starling_bridge_credentials', bridge_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class StarlingCredentialsTest(unittest.TestCase):
    """验证请求级 AK/SK 注入以及项目必填约束。"""

    @classmethod
    def setUpClass(cls):
        """加载一次 bridge 供所有用例使用。"""
        cls.bridge = load_bridge()

    def test_credential_env_uses_request_values(self):
        """请求中的完整 AK/SK 应只注入当前子进程环境。"""
        env = self.bridge.credential_env({
            'access_key': 'test-ak',
            'secret_key': 'test-sk',
        })
        self.assertEqual(env['STARLING_ACCESS_KEY'], 'test-ak')
        self.assertEqual(env['STARLING_SECRET_KEY'], 'test-sk')

    def test_credential_env_requires_complete_pair(self):
        """只提供一个字段时不得覆盖已有的官方配置来源。"""
        env = self.bridge.credential_env({'access_key': 'test-ak'})
        self.assertNotEqual(env.get('STARLING_ACCESS_KEY'), 'test-ak')

    def test_batch_search_requires_project(self):
        """批量查询缺少项目时必须明确失败。"""
        with self.assertRaisesRegex(ValueError, 'project_required'):
            self.bridge.search_tm_batch({
                'texts': ['Done'],
                'source_lang': 'en',
                'target_lang': 'zh-Hans',
            })

    def test_key_search_requires_project(self):
        """Key 查询缺少项目时也必须明确失败。"""
        with self.assertRaisesRegex(ValueError, 'project_required'):
            self.bridge.search_key({'texts': ['Done']})


if __name__ == '__main__':
    unittest.main()
