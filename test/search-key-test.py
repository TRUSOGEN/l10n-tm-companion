#!/usr/bin/env python3
"""
search_key 解析逻辑单测（bridge `_parse_search_output`）。

验证：
1. 精确命中（sourceContent 完全相等）→ exact=True，返回对应 keyText
2. 仅模糊匹配（无精确相等）→ exact=False，取最高分
3. 无匹配（data.data 空）→ None
4. API 报错（ok:false）→ 错误字符串

注：TM 查 key 走 /project/search（源文案搜索，带 key），
非 /corpus/tm/match（TM 库匹配，无 key）。这是 2026-06-30 用户反馈「查不到 key」的根因修复。
"""
import sys, os, json
# bridge 文件名带横杠（starling-bridge.py），不能直接 import，用 importlib 按 path 加载
import importlib.util
_bridge_path = os.path.join(os.path.dirname(__file__), '..', 'native-host', 'starling-bridge.py')
_spec = importlib.util.spec_from_file_location('starling_bridge', _bridge_path)
bridge = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bridge)

pass_ = 0
fail_ = 0

def assert_eq(name, got, want):
    global pass_, fail_
    if got == want:
        pass_ += 1
        print(f'  ✅ {name}')
    else:
        fail_ += 1
        print(f'  ❌ {name}: got={got!r} want={want!r}')


print('\n=== search_key: _parse_search_output 解析逻辑 ===')

# 1. 精确命中：query 在返回列表里 sourceContent 完全相等
exact_payload = json.dumps({
    'ok': True,
    'data': {'data': [
        {'keyText': 'music_video_official', 'sourceContent': 'Official Videos', 'targetContent': '', 'score': 112.6},
        {'keyText': 'other_key', 'sourceContent': 'Official', 'targetContent': '', 'score': 80.0},
    ], 'total': 2}
})
r = bridge._parse_search_output(exact_payload, 'Official Videos')
assert_eq('精确命中取 key', r.get('key'), 'music_video_official')
assert_eq('精确命中 exact=True', r.get('exact'), True)
assert_eq('精确命中带 source_text', r.get('source_text'), 'Official Videos')
assert_eq('精确命中 method', r.get('method'), 'starling-search')

# 2. 仅模糊匹配：无完全相等，取最高分第一条
fuzzy_payload = json.dumps({
    'ok': True,
    'data': {'data': [
        {'keyText': 'copyright_key', 'sourceContent': 'Provide the URL to the original copyrighted material', 'score': 125.6},
    ], 'total': 1}
})
r2 = bridge._parse_search_output(fuzzy_payload, 'Provide the official KTP')
assert_eq('模糊匹配 exact=False', r2.get('exact'), False)
assert_eq('模糊匹配取最高分 key', r2.get('key'), 'copyright_key')

# 3. 无匹配 → None（调用方降级空结果）
empty_payload = json.dumps({'ok': True, 'data': {'data': [], 'total': 0}})
r3 = bridge._parse_search_output(empty_payload, 'nonexistent')
assert_eq('无匹配返回 None', r3, None)

# 4. API 报错 → 错误字符串
err_payload = json.dumps({'ok': False, 'error': {'message': 'permission denied'}})
r4 = bridge._parse_search_output(err_payload, 'x')
assert_eq('API 报错返回字符串', isinstance(r4, str) and 'permission denied' in r4, True)

# 5. trim 容错：原文带前后空格也算精确命中
ws_payload = json.dumps({
    'ok': True,
    'data': {'data': [
        {'keyText': 'k', 'sourceContent': 'Done', 'score': 100},
    ], 'total': 1}
})
r5 = bridge._parse_search_output(ws_payload, '  Done  ')
assert_eq('trim 容错 exact=True', r5.get('exact'), True)

# 5b. 空白归一化：query 用空格分段，sourceContent 用 \n\n 分段，归一化后判精确命中
# （2026-06-30 KTP 实测：'system. Selfie' vs 'system.\n\nSelfie'）
norm_payload = json.dumps({
    'ok': True,
    'data': {'data': [
        {'keyText': 'ttlsMerchant_ktp', 'sourceContent': 'KTP - Provide the official KTP.\n\nSelfie - Your photo.', 'score': 801.4},
    ], 'total': 1}
})
r5b = bridge._parse_search_output(norm_payload, 'KTP - Provide the official KTP. Selfie - Your photo.')
assert_eq('空白归一化 exact=True（\\n\\n vs 空格）', r5b.get('exact'), True)
assert_eq('空白归一化取 key', r5b.get('key'), 'ttlsMerchant_ktp')

# 6. 空输入
assert_eq('空输出返回错误字符串', isinstance(bridge._parse_search_output('', 'x'), str), True)

# 7. _key_err 字段完整
e = bridge._key_err('hello', 'No source match')
assert_eq('_key_err 带 key 空', e.get('key'), '')
assert_eq('_key_err 带 origin', e.get('origin'), 'No source match')
assert_eq('_key_err exact False', e.get('exact'), False)

# 8. 必填 Key 主流程必须在单个官方客户端进程中批量查询，不能对每个条目重新
# spawn starling-cli。用替身锁定 bridge 与批量客户端之间的协议，不访问网络。
batch_calls = []
legacy_calls = []
original_batch_request = getattr(bridge, 'request_key_search_batch', None)
original_key_single = bridge.search_key_single
original_project_name = bridge._resolve_project_name

def fake_key_batch(cli, texts, project_ids, max_concurrency=8, message=None):
    """模拟接收请求级凭证上下文的官方批量 Key 客户端。"""
    batch_calls.append((cli, texts, project_ids, max_concurrency))
    return {'results': [{
        'source_text': 'Done',
        'candidates': [{
            'project_id': 385,
            'response': {'data': [{
                'keyText': 'done_key', 'sourceContent': 'Done', 'score': 100,
            }]},
        }],
    }]}

bridge.request_key_search_batch = fake_key_batch
bridge.search_key_single = lambda *args, **kwargs: (
    legacy_calls.append(args) or {
        'key': 'legacy_key', 'exact': True, 'score': 100,
        'source_text': 'Done', 'project_id': 385,
    }
)
bridge._resolve_project_name = lambda *args, **kwargs: None
try:
    batched = bridge.search_key({
        'texts': ['Done'],
        'project_ids': [385],
        'cli_path': '/tmp/starling-cli',
    })
finally:
    if original_batch_request is None:
        del bridge.request_key_search_batch
    else:
        bridge.request_key_search_batch = original_batch_request
    bridge.search_key_single = original_key_single
    bridge._resolve_project_name = original_project_name

assert_eq('Key 查询只调用一次官方批量客户端', len(batch_calls), 1)
assert_eq('Key 查询不启动逐条 CLI', len(legacy_calls), 0)
assert_eq('Key 批量客户端接收完整原文', batch_calls[0][1] if batch_calls else None, ['Done'])
assert_eq('Key 批量客户端接收已选项目', batch_calls[0][2] if batch_calls else None, [385])
assert_eq('批量 Key 查询返回精确 key', batched['results'][0].get('key'), 'done_key')
assert_eq('批量 Key 查询保留精确标记', batched['results'][0].get('exact'), True)

print(f'\nsearch_key 单测: {pass_} 通过 / {fail_} 失败')
sys.exit(1 if fail_ else 0)
