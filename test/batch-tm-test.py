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
import threading
import time


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
                'matchCategory': 'fuzzy',
                'id': 'tm-low',
            }, {
                'score': 61,
                'source': 'Privacy settings',
                'target': '隐私设置',
                'sourceLang': 'en',
                'targetLang': 'zh',
                'updater': 'reviewer',
                'matchCategory': 'fuzzy',
                'id': 'tm-high',
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
    passed += assert_equal('第二条候选按 source target 去重', len(results[1]['tm_candidates']), 2)
    total += 1
    passed += assert_equal('重复候选保留最高分', results[1]['tm_candidates'][0]['score'], 61.0)
    total += 1
    passed += assert_equal('去重后保持首次出现顺序', results[1]['tm_candidates'][1]['source'], 'Privacy settings saved')
    total += 1
    passed += assert_equal('候选保留审计字段', results[1]['tm_candidates'][0]['tm_id'], 'tm-high')
    total += 1
    passed += assert_equal('兼容候选计数使用去重后数量', results[1]['candidate_count'], 2)
    total += 1
    passed += assert_equal('空候选保持真实无命中', results[2]['origin'], 'No TM match')
    total += 1
    passed += assert_equal('空候选返回空 Top-3', results[2]['tm_candidates'], [])
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
    total += 1
    passed += assert_raises(
        '候选非数值 score 明确失败',
        ValueError,
        lambda: bridge.parse_batch_tm_response(
            {'data': [[{'source': 'Done', 'target': '完成', 'score': 'bad'}]]},
            ['Done'],
            'en',
            'zh',
        ),
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
    passed += assert_equal(
        '十一条输入按 10+1 分批',
        sorted(len(call[1]['sourceContents']) for call in request_calls),
        [1, 10],
    )
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

    print('\n=== batch TM: approved source limit capability ===')
    source_limit_env = 'L10N_STARLING_TM_SOURCE_LIMIT'
    original_source_limit = os.environ.get(source_limit_env)
    try:
        os.environ.pop(source_limit_env, None)
        total += 1
        passed += assert_equal(
            '未配置额度时继续使用 PPE 已验证的 10 条',
            bridge.get_batch_tm_source_limit(),
            10,
        )

        os.environ[source_limit_env] = '40'
        forty_calls = []

        def forty_request(cli, body, use_ppe, message=None):
            """记录显式启用 40 条能力后的单批请求。"""
            forty_calls.append(body)
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

        bridge.request_batch_tm = forty_request
        forty = bridge.search_tm_batch({
            'texts': [f'Forty {index}' for index in range(40)],
            'project_ids': [385],
            'source_lang': 'en',
            'target_lang': 'zh',
            'cli_path': '/tmp/starling-cli',
        })
        total += 1
        passed += assert_equal('显式批准 40 条后一次请求发送全部文案', len(forty_calls), 1)
        total += 1
        passed += assert_equal('40 条请求体保持完整', len(forty_calls[0]['sourceContents']), 40)
        total += 1
        passed += assert_equal(
            '40 条响应保持输入顺序',
            [item['source_text'] for item in forty['results']],
            [f'Forty {index}' for index in range(40)],
        )
        total += 1
        passed += assert_raises(
            '超过已批准 40 条上限正确失败',
            ValueError,
            lambda: bridge.search_tm_batch({
                'texts': [f'Text {index}' for index in range(41)],
                'project_ids': [385],
                'source_lang': 'en',
                'target_lang': 'zh',
                'batch_size': 41,
            }),
        )
        total += 1
        passed += assert_raises(
            '提高 source 上限不会放宽十个 project ID 上限',
            ValueError,
            lambda: bridge.build_batch_tm_body(
                ['One'], list(range(1, 12)), 'en', 'zh'
            ),
        )
        total += 1
        passed += assert_raises(
            '请求体构造器不能绕过客户端 40 条支持上限',
            ValueError,
            lambda: bridge.build_batch_tm_body(
                ['One'], [385], 'en', 'zh', source_limit=41
            ),
        )

        os.environ[source_limit_env] = '41'
        total += 1
        passed += assert_raises(
            '超过客户端支持范围的额度配置正确失败',
            ValueError,
            bridge.get_batch_tm_source_limit,
        )
    finally:
        bridge.request_batch_tm = original_request
        if original_source_limit is None:
            os.environ.pop(source_limit_env, None)
        else:
            os.environ[source_limit_env] = original_source_limit

    print('\n=== batch TM: bounded parallel dispatch ===')
    active_requests = 0
    max_active_requests = 0
    activity_lock = threading.Lock()

    def concurrent_request(cli, body, use_ppe, message=None):
        """模拟慢请求并记录同时在途的批次数。"""
        nonlocal active_requests, max_active_requests
        with activity_lock:
            active_requests += 1
            max_active_requests = max(max_active_requests, active_requests)
        time.sleep(0.02)
        with activity_lock:
            active_requests -= 1
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

    bridge.request_batch_tm = concurrent_request
    try:
        parallel = bridge.search_tm_batch({
            'texts': [f'Parallel {index}' for index in range(50)],
            'project_ids': [385],
            'source_lang': 'en',
            'target_lang': 'zh',
            'batch_concurrency': 5,
            'cli_path': '/tmp/starling-cli',
        })
        serial = bridge.search_tm_batch({
            'texts': [f'Serial {index}' for index in range(50)],
            'project_ids': [385],
            'source_lang': 'en',
            'target_lang': 'zh',
            'batch_concurrency': 1,
            'cli_path': '/tmp/starling-cli',
        })
    finally:
        bridge.request_batch_tm = original_request

    total += 1
    passed += assert_equal('五个批次同时在途', max_active_requests, 5)
    total += 1
    passed += assert_equal(
        '并行合并仍保持五十条输入顺序',
        [item['source_text'] for item in parallel['results']],
        [f'Parallel {index}' for index in range(50)],
    )
    total += 1
    passed += assert_equal(
        '单并发仍处理全部五十条并保持顺序',
        [item['source_text'] for item in serial['results']],
        [f'Serial {index}' for index in range(50)],
    )

    total += 1
    passed += assert_raises(
        '超过安全批大小上限明确失败',
        ValueError,
        lambda: bridge.search_tm_batch({
            'texts': [f'Text {index}' for index in range(11)],
            'project_ids': [385],
            'source_lang': 'en',
            'target_lang': 'zh',
            'batch_size': 11,
        }),
    )

    total += 1
    passed += assert_raises(
        '超过安全并发上限明确失败',
        ValueError,
        lambda: bridge.search_tm_batch({
            'texts': ['Too much concurrency'],
            'project_ids': [385],
            'source_lang': 'en',
            'target_lang': 'zh',
            'batch_concurrency': 6,
        }),
    )

    total += 1
    passed += assert_raises(
        '零并发配置明确失败',
        ValueError,
        lambda: bridge.search_tm_batch({
            'texts': ['Zero concurrency'],
            'project_ids': [385],
            'source_lang': 'en',
            'target_lang': 'zh',
            'batch_concurrency': 0,
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
