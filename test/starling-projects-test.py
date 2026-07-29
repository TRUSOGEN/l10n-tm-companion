#!/usr/bin/env python3
"""Starling 权限项目发现与分页回归测试。

该测试使用受控的 CLI 响应验证 Native Host 会完整读取 `/projects` 的所有分页，
并保持项目 ID、名称、source locale 与 target locales 的既有输出契约。
"""

import importlib.util
import json
import os
import subprocess
import unittest
from unittest import mock


def load_bridge():
    """按文件路径加载 Native Messaging bridge。"""
    bridge_path = os.path.join(
        os.path.dirname(__file__), '..', 'native-host', 'starling-bridge.py'
    )
    spec = importlib.util.spec_from_file_location(
        'starling_bridge_project_pagination',
        bridge_path,
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def project(project_id):
    """生成最小 Starling 项目响应对象。"""
    return {
        'id': project_id,
        'name': f'Project {project_id}',
        'sourceLocale': 'en',
        'targetLocales': ['de-DE', 'fr'],
    }


class StarlingProjectsTest(unittest.TestCase):
    """验证权限项目列表使用显式分页并完整聚合。"""

    @classmethod
    def setUpClass(cls):
        """加载一次 bridge 供所有测试使用。"""
        cls.bridge = load_bridge()

    def test_list_projects_fetches_every_page(self):
        """项目总数超过单页时必须继续请求，不能只返回第一页。"""
        calls = []

        def fake_run(command, **_kwargs):
            """按命令中的 offset 返回两页确定性测试数据。"""
            params = json.loads(command[command.index('--params') + 1])
            calls.append(params)
            offset = int(params['offset'])
            items = (
                [project(project_id) for project_id in range(1, 26)]
                if offset == 0
                else [project(project_id) for project_id in range(26, 31)]
            )
            payload = {
                'ok': True,
                'data': {
                    'data': items,
                    'pagination': {'offset': offset, 'limit': 25},
                    'total': 30,
                },
            }
            return subprocess.CompletedProcess(
                command,
                returncode=0,
                stdout=json.dumps(payload),
                stderr='',
            )

        with mock.patch.object(self.bridge.subprocess, 'run', side_effect=fake_run):
            result = self.bridge.list_projects({
                'cli_path': '/test/starling-cli',
                'access_key': 'test-ak',
                'secret_key': 'test-sk',
            })

        self.assertTrue(result['ok'])
        self.assertEqual(len(result['projects']), 30)
        self.assertEqual(
            [call['offset'] for call in calls],
            [0, 25],
        )
        self.assertTrue(all(call['limit'] == 25 for call in calls))

    def test_list_projects_rejects_mismatched_response_offset(self):
        """响应页 offset 与请求不一致时必须失败，禁止接受错页数据。"""
        def fake_run(command, **_kwargs):
            """第二次请求故意返回错误的分页 offset。"""
            params = json.loads(command[command.index('--params') + 1])
            requested_offset = int(params['offset'])
            items = (
                [project(project_id) for project_id in range(1, 26)]
                if requested_offset == 0
                else [project(project_id) for project_id in range(26, 31)]
            )
            payload = {
                'ok': True,
                'data': {
                    'data': items,
                    'pagination': {
                        'offset': 0,
                        'limit': 25,
                    },
                    'total': 30,
                },
            }
            return subprocess.CompletedProcess(
                command,
                returncode=0,
                stdout=json.dumps(payload),
                stderr='',
            )

        with mock.patch.object(self.bridge.subprocess, 'run', side_effect=fake_run):
            result = self.bridge.list_projects({
                'cli_path': '/test/starling-cli',
                'access_key': 'test-ak',
                'secret_key': 'test-sk',
            })

        self.assertFalse(result['ok'])
        self.assertIn('offset mismatch', result['error'])


if __name__ == '__main__':
    unittest.main()
