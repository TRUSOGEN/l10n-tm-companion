#!/usr/bin/env python3
"""Starling 批量 TM 响应解析与请求体构造回归测试。

该测试固定 PPE 已验证的 `/corpus/tm/match/batch` 响应结构：
`data[i]` 对应第 i 条输入文案，数组内元素按相似度从高到低排列。
测试只覆盖纯数据转换，不发起网络请求，也不读取任何凭证。
"""

import importlib.util
import json
import os
import sys


def load_bridge():
    """按文件路径加载 Native Messaging bridge 模块。"""
    bridge_path = os.path.join(
        os.path.dirname(__file__), '..', 'native-host', 'starling-bridge.py'
    )
    spec = importlib.util.spec_from_file_location('starling_bridge', bridge_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def assert_equal(name, actual, expected):
    """断言两个值相等，并累计测试结果。"""
    if actual == expected:
        print(f'  PASS {name}')
        return True
    print(f'  FAIL {name}: actual={actual!r}, expected={expected!r}')
    return False


def assert_raises(name, exc_type, callback):
    """断言 callback 抛出指定异常类型。"""
    try:
        callback()
    except exc_type:
        print(f'  PASS {name}')
        return True
    except Exception as exc:  # noqa: BLE001
        print(f'  FAIL {name}: actual exception={type(exc).__name__}: {exc}')
        return False
    print(f'  FAIL {name}: no exception raised')
    return False


def main():
    """执行批量 TM 响应解析与请求体验证。"""
    bridge = load_bridge()
    passed = 0
    total = 0

    print('\n=== batch TM: verified PPE response mapping ===')
    texts = ['Done', 'Settings', 'Cancel']
    payload = {
        'data': [
            [{
                'score': 100,
                'source': 'Done',
                'target': '完成',
                'sourceLang': 'en',
                'targetLang': 'zh',
                'updater': 'isabella.ai',
            }],
            [{
                'score': 58.333333333333336,
                'source': 'Privacy settings',
                'target': '隐私设置',
                'sourceLang': 'en',
                'targetLang': 'zh',
                'updater': 'isabella.ai',
            }, {
                'score': 46.666666666666664,
                'source': 'Privacy settings saved',
                'target': '隐私设置已保存',
                'sourceLang': 'en',
                'targetLang': 'zh',
                'updater': 'isabella.ai',
            }],
            [],
        ],
        'total': 3,
        'pagination': {'offset': 0, 'limit': 3},
    }
    results = bridge.parse_batch_tm_response(json.dumps(payload), texts, 'en', 'zh')

    total += 1
    passed += assert_equal('结果数量保持输入数量', len(results), 3)
    total += 1
    passed += assert_equal('第一条取最高分译文', results[0]['tm_match'], '完成')
    total += 1
    passed += assert_equal('第二条取最高分匹配', results[1]['tm_source'], 'Privacy settings')
    total += 1
    passed += assert_equal('第二条保留全部候选计数', results[1]['candidate_count'], 2)
    total += 1
    passed += assert_equal('空候选保持真实无命中', results[2]['origin'], 'No TM match')
    total += 1
    passed += assert_equal('批量方法标记', results[0]['method'], 'starling-batch')

    print('\n=== batch TM: request body validation ===')
    body = bridge.build_batch_tm_body(
        texts=['Done', 'Settings'],
        project_ids=[385, 278],
        source_lang='en',
        target_lang='zh',
        limit=3,
        least_score=0,
    )
    total += 1
    passed += assert_equal('请求传入多项目 ID', body['projectIds'], [385, 278])
    total += 1
    passed += assert_equal('请求传入全部文案', body['sourceContents'], ['Done', 'Settings'])
    total += 1
    passed += assert_raises(
        '超过十个项目明确失败',
        ValueError,
        lambda: bridge.build_batch_tm_body(['Done'], list(range(11)), 'en', 'zh', 3, 0),
    )
    total += 1
    passed += assert_raises(
        '超过十条文案明确失败',
        ValueError,
        lambda: bridge.build_batch_tm_body(
            [f'Text {index}' for index in range(11)], [385], 'en', 'zh', 3, 0
        ),
    )
    total += 1
    passed += assert_raises(
        '响应与输入数量不一致明确失败',
        ValueError,
        lambda: bridge.parse_batch_tm_response(json.dumps({'data': [[]]}), texts, 'en', 'zh'),
    )

    print('\n=== batch TM: transient PPE error retry policy ===')
    total += 1
    passed += assert_equal(
        '1204 远端超时可重试',
        bridge.is_retryable_batch_error(
            400,
            'remote or network error[remote]: error_code=1204 request timeout',
        ),
        True,
    )
    total += 1
    passed += assert_equal(
        '普通 400 不重试',
        bridge.is_retryable_batch_error(400, 'invalid projectIds'),
        False,
    )

    print('\n=== batch TM: safe chunk dispatch ===')
    request_calls = []
    original_request = bridge.request_batch_tm

    def fake_request(cli, body, use_ppe, message=None):
        """模拟已签名的批量请求，避免回归测试访问真实 Starling。"""
        request_calls.append((cli, body, use_ppe))
        return {
            'data': [[{
                'score': 100,
                'source': text,
                'target': f'{text}-target',
                'sourceLang': 'en',
                'targetLang': 'zh',
                'updater': 'test',
            }] for text in body['sourceContents']]
        }

    bridge.request_batch_tm = fake_request
    try:
        chunked = bridge.search_tm_batch({
            'texts': [f'Text {index}' for index in range(11)],
            'project_ids': [385, 278],
            'source_lang': 'en',
            'target_lang': 'zh',
            'limit': 3,
            'least_score': 0,
            'use_ppe': True,
            'cli_path': '/tmp/starling-cli',
        })
    finally:
        bridge.request_batch_tm = original_request

    total += 1
    passed += assert_equal('十一条输入按 10+1 分批', [len(call[1]['sourceContents']) for call in request_calls], [10, 1])
    total += 1
    passed += assert_equal('每批保留全部项目 ID', request_calls[0][1]['projectIds'], [385, 278])
    total += 1
    passed += assert_equal('每批传 PPE 标记', all(call[2] is True for call in request_calls), True)
    total += 1
    passed += assert_equal(
        '合并结果保持输入顺序',
        [item['source_text'] for item in chunked['results']],
        [f'Text {index}' for index in range(11)],
    )

    total += 1
    passed += assert_raises(
        '超过安全批次上限明确失败',
        ValueError,
        lambda: bridge.search_tm_batch({
            'texts': [f'Text {index}' for index in range(11)],
            'project_ids': [385],
            'source_lang': 'en',
            'target_lang': 'zh',
            'batch_size': 11,
        }),
    )

    def failing_request(cli, body, use_ppe, message=None):
        """模拟可见的 Starling 请求失败。"""
        raise RuntimeError('API error 503: test failure')

    bridge.request_batch_tm = failing_request
    try:
        total += 1
        passed += assert_raises(
            '批量请求失败直接暴露',
            RuntimeError,
            lambda: bridge.search_tm_batch({
                'texts': ['One'],
                'project_ids': [385],
                'source_lang': 'en',
                'target_lang': 'zh',
            }),
        )
    finally:
        bridge.request_batch_tm = original_request

    print(f'\nbatch TM 测试: {passed} 通过 / {total - passed} 失败')
    return 0 if passed == total else 1


if __name__ == '__main__':
    sys.exit(main())
