#!/usr/bin/env python3
"""
starling-bridge.py
==================
Chrome Native Messaging ↔ Starling CLI / LLM 桥接脚本。

协议：
  - stdin 读入 4 字节小端长度前缀 + UTF-8 JSON 消息
  - stdout 写出 4 字节小端长度前缀 + UTF-8 JSON 响应

支持动作：
  action: search_tm
    {
      "action": "search_tm",
      "texts": ["...", ...],
      "source_lang": "en",
      "target_lang": "zh",
      "project_id": 385,          # 可选，覆盖 DEFAULT_PROJECT_ID
      "least_score": 0,           # 可选，最小相似度 0-100，默认 0（全返回）
      "limit": 3,                 # 可选，Batch 默认 3；Legacy 默认 1
      "cli_path": "/optional/path/to/starling-cli"  # 可选覆盖
    }
  -> { "results": [ { source_text, tm_match, similarity, tm_candidates, ... }, ... ] }

  action: llm_call   （2026-06-25 新增：绕过浏览器 CORS，由 Python 直连 LLM 网关）
    {
      "action": "llm_call",
      "endpoint": "https://llmbox-global.byteintl.net/v1/messages",
      "api_key": "at-...",
      "model": "glm-5.2",
      "prompt": "...",
      "provider": "claude" | "openai"   # 可选，默认按 endpoint 猜
    }
  -> { "ok": true, "text": "<LLM 返回文本>" }
     失败 -> { "ok": false, "error": "...", "status": 500 }

  action: feishu_oauth_info
    -> { "ok": true, "redirect_uri": "http://localhost:39641/...", "scope": "..." }

  action: feishu_user_oauth
    -> 以应用内置 App ID 和 Keychain 中的 Secret 启动 PKCE OAuth，返回短期 user_access_token

  action: feishu_configure_app_secret
    -> 在 Native Host 的系统隐藏输入框中完成 Owner 配置，只返回配置状态

实现说明（2026-06-24 真机实测）：
  - CLI = `starling-cli`（@byted/starling-agent-cli，npm 内部源安装），不是 `starling`
  - TM 查询走 API Runner：`starling-cli api GET /corpus/tm/match`
  - 参数走 --params（JSON query string）：projectId / sourceLocale / targetLocale /
    sourceText / leastScore / limit
  - 返回 { ok, data: { data: [ {source, target, score, updater, ...} ], total } }
    取 data.data[0]（已按相似度降序），target=译文, score=相似度0-100, updater=来源
  - AK/SK 配置见 ~/.starling-cli/.starlingrc.json（starling-cli login 落盘，
    非交互 TTY 下 SK 需手动补，见 SESSION-HANDOFF.md）
  - LLM 调用：Python urllib 直连 LLMBox，无浏览器 CORS 限制。
  - ROI Bitable：Wiki 节点继续走应用身份；表和记录写入通过本机 OAuth 取得用户身份。
    Claude 格式：x-api-key + anthropic-version，POST {model,max_tokens,messages}
    OpenAI 格式：Authorization Bearer，POST {model,messages,temperature}
"""

import sys
import os
import json
import importlib.util
import math
import shutil
import subprocess
import struct
import time
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor


OAUTH_MODULE_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), 'feishu_oauth.py'
)
_oauth_spec = importlib.util.spec_from_file_location('l10n_feishu_oauth', OAUTH_MODULE_PATH)
if not _oauth_spec or not _oauth_spec.loader:
    raise RuntimeError('Feishu OAuth module is unavailable')
feishu_oauth = importlib.util.module_from_spec(_oauth_spec)
_oauth_spec.loader.exec_module(feishu_oauth)

DEFAULT_CLI = 'starling-cli'
CLI_TIMEOUT = 30  # 秒
PROJECT_LIST_PAGE_SIZE = 25
BATCH_TM_METHOD = 'starling-batch'
BATCH_TM_METHOD_VERSION = 'starling-openapi-batch-ppe-v1'
# 李明东于 2026-07-13 确认：sourceContents、projectIds 各最多 10 条。
BATCH_TM_SAFE_SIZE = 10
BATCH_TM_MAX_CONCURRENCY = 5
BATCH_TRANSIENT_MAX_ATTEMPTS = 3
BATCH_CLIENT_SCRIPT = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), 'starling-batch-client.js'
)
KEY_SEARCH_CLIENT_SCRIPT = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), 'starling-key-batch-client.js'
)
KEY_SEARCH_MAX_CONCURRENCY = 8
KEY_SEARCH_TIMEOUT = 90
CREDENTIALS_CLIENT_SCRIPT = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), 'starling-credentials-client.js'
)

# starling-cli / node 候选绝对路径。Chrome 启动 native host 子进程时 PATH 极简
# （通常只有 /usr/bin:/bin:/usr/sbin:/sbin），which starling-cli 返回 None。
# 这里主动探测常见安装位置，让 bridge 不依赖终端 PATH。
NODE_BIN_DIRS = [
    os.path.expanduser('~/.local/bin/node/bin'),  # ttadk 装的 node + starling-cli
    '/opt/homebrew/bin',                          # Homebrew (Apple Silicon)
    '/usr/local/bin',                             # Homebrew (Intel) / 手动
]
STARLING_CLI_CANDIDATES = [
    os.path.expanduser('~/.local/bin/node/bin/starling-cli'),
    '/usr/local/bin/starling-cli',
    '/opt/homebrew/bin/starling-cli',
]

# 诊断日志：Chrome 启动 bridge 子进程时环境与终端不同，崩溃信息无处可看。
# 写到 /tmp，便于排查 "Error when communicating with the native messaging host"。
import traceback as _tb
DEBUG_LOG = '/tmp/l10n-bridge-debug.log'


def _log(msg):
    try:
        with open(DEBUG_LOG, 'a') as f:
            f.write(str(msg) + '\n')
    except Exception:  # noqa: BLE001
        pass


def _augment_path():
    """把 node/starling-cli 所在目录补进 PATH，让 #!/usr/bin/env node 能找到 node。"""
    parts = os.environ.get('PATH', '').split(os.pathsep)
    for d in NODE_BIN_DIRS:
        if d not in parts and os.path.isdir(d):
            parts.append(d)
    os.environ['PATH'] = os.pathsep.join(parts)


_augment_path()
_log('=== bridge start ===')
_log('PATH=' + os.environ.get('PATH', ''))
_log('which starling-cli=' + str(shutil.which('starling-cli')))
_log('python=' + sys.executable)



# ---------------------------------------------------------------------------
# Native Messaging I/O
# ---------------------------------------------------------------------------
def read_message():
    """从 stdin 读取一条 Native Messaging 消息（4 字节长度前缀）。"""
    raw_length = sys.stdin.buffer.read(4)
    if len(raw_length) < 4:
        sys.exit(0)
    message_length = struct.unpack('=I', raw_length)[0]
    if message_length == 0:
        return {}
    raw = sys.stdin.buffer.read(message_length)
    if len(raw) < message_length:
        sys.exit(0)
    return json.loads(raw.decode('utf-8'))


def send_message(message):
    """向 stdout 写出一条 Native Messaging 消息。"""
    encoded = json.dumps(message, ensure_ascii=False).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('=I', len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


# ---------------------------------------------------------------------------
# Starling CLI 调用
# ---------------------------------------------------------------------------
def resolve_cli(cli_path):
    if cli_path and os.path.exists(cli_path):
        return cli_path
    # 1) PATH 能找到（终端环境）
    found = shutil.which(DEFAULT_CLI)
    if found:
        return found
    # 2) Chrome 极简 PATH 找不到 → 探测候选绝对路径
    for cand in STARLING_CLI_CANDIDATES:
        if os.path.exists(cand):
            _log('resolve_cli 命中候选: ' + cand)
            return cand
    _log('resolve_cli 全部候选都不存在，回退默认名')
    return DEFAULT_CLI  # 返回默认名，让 subprocess 报错路径


def build_search_cmd(cli, text, source_lang, target_lang, project_id,
                     least_score=0, limit=1):
    """
    构造 Starling CLI TM 查询命令（API Runner）。

    真实命令（2026-06-24 实测通过）：
      starling-cli api GET /corpus/tm/match \
        --params '{"projectId":385,"sourceLocale":"en","targetLocale":"zh",
                   "sourceText":"Done","leastScore":0,"limit":1}'
    返回 JSON：{ ok, data: { data:[{source,target,score,updater,...}], total } }
    data.data 已按相似度降序，取 [0] 即最相似匹配。
    """
    params = {
        'projectId': project_id,
        'sourceLocale': source_lang,
        'targetLocale': target_lang,
        'sourceText': text,
        'leastScore': least_score,
        'limit': limit,
    }
    return [cli, 'api', 'GET', '/corpus/tm/match',
            '--params', json.dumps(params, ensure_ascii=False)]


def credential_env(message):
    """为单次 Starling 子进程注入完整请求凭证，不修改全局环境。"""
    env = os.environ.copy()
    access_key = message.get('access_key')
    secret_key = message.get('secret_key')
    if access_key and secret_key:
        env['STARLING_ACCESS_KEY'] = access_key
        env['STARLING_SECRET_KEY'] = secret_key
    return env


def _run_credentials_client(message, action):
    """调用官方 Core 凭证 helper，且不把请求 payload 写入错误或日志。"""
    if not os.path.isfile(CREDENTIALS_CLIENT_SCRIPT):
        raise RuntimeError('Starling credentials client is missing')
    cli = resolve_cli(message.get('cli_path'))
    env = credential_env({})
    env['STARLING_AGENT_CLI_ROOT'] = _resolve_starling_cli_root(cli)
    payload = {'action': action}
    if action == 'save':
        payload['access_key'] = message.get('access_key')
        payload['secret_key'] = message.get('secret_key')
    proc = subprocess.run(
        [_resolve_node(), CREDENTIALS_CLIENT_SCRIPT],
        input=json.dumps(payload, ensure_ascii=False),
        capture_output=True,
        text=True,
        timeout=CLI_TIMEOUT,
        env=env,
    )
    try:
        result = json.loads((proc.stdout or '').strip())
    except json.JSONDecodeError as exc:
        raise RuntimeError('Starling credentials client returned invalid JSON') from exc
    if proc.returncode != 0 or not result.get('ok'):
        raise RuntimeError('Starling credentials operation failed')
    return result


def save_starling_credentials(message):
    """通过官方 Starling Core 保存完整 AK/SK，成功响应不回显凭证。"""
    if not message.get('access_key') or not message.get('secret_key'):
        raise ValueError('access_key and secret_key are required')
    return _run_credentials_client(message, 'save')


def get_starling_credentials(message):
    """通过官方 Starling Core 读取完整 AK/SK，供 Settings 回填。"""
    return _run_credentials_client(message, 'get')


def search_single(cli, text, source_lang, target_lang, project_id,
                  least_score=0, limit=1, env=None):
    """对单条文本调用 CLI 并解析结果。失败时返回带 origin 的空结果。"""
    cmd = build_search_cmd(cli, text, source_lang, target_lang, project_id,
                           least_score, limit)
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=CLI_TIMEOUT,
            env=env,
        )
    except subprocess.TimeoutExpired:
        return _err(text, source_lang, target_lang, 'CLI Timeout')
    except FileNotFoundError:
        return _err(text, source_lang, target_lang,
                    f'CLI not found: {cli}')
    except Exception as e:  # noqa: BLE001
        return _err(text, source_lang, target_lang,
                    f'Error: {str(e)[:200]}')

    if proc.returncode != 0:
        return _err(text, source_lang, target_lang,
                    f'CLI Error: {(proc.stderr or proc.stdout or "")[:200]}')

    tm_result = _parse_cli_output(proc.stdout)
    if tm_result is None:
        # 无匹配（total:0）→ 正常空结果，不算错误
        return _err(text, source_lang, target_lang, 'No TM match')
    if isinstance(tm_result, str):
        # CLI 报错（ok:false）或解析失败
        return _err(text, source_lang, target_lang, tm_result)
    # 回填原文：_parse_cli_output 不知道输入文本，在此补上，popup 侧按 source_text 映射
    tm_result['source_text'] = text
    return tm_result


def build_search_key_cmd(cli, text, project_id):
    """
    构造 Starling CLI 源文案搜索命令（按原文查 key）。

    真实命令（2026-06-30 实测通过）：
      starling-cli api GET /project/search \
        --params '{"projectId":385,"searchScope":0,"searchKey":"Official Videos"}'
    返回 JSON：{ ok, data: { data:[{keyText,sourceContent,targetContent,score,...}], total } }
    取 sourceContent 与输入精确相等（trim）且 score 最高的第一条的 keyText。

    ⚠️ 这是源文案搜索接口（带 key），与 /corpus/tm/match（TM 库匹配，无 key）不同。
    用户反馈「TM 查不到 key」根因：之前用 TM match 接口，TM 条目本身不存 key；
    key 在源文案层，必须用 /project/search 按 searchScope=0(源文案) 查。
    """
    params = {
        'projectId': project_id,
        'searchScope': 0,        # 0 = 按源文案搜索
        'searchKey': text,
    }
    return [cli, 'api', 'GET', '/project/search',
            '--params', json.dumps(params, ensure_ascii=False)]


def search_key_single(cli, text, project_id, project_name=None):
    """对单条原文调用 CLI 查 key（单个项目）。返回 {key, score, exact, project_id, project_name, ...}。

    ⚠️ /project/search 接口偶发返回 total:0（实测 5 次约 1 次空，服务端不稳定/限流）。
    命中空结果时重试最多 3 次（共 4 次调用），仍空才降级 _key_err。
    """
    cmd = build_search_key_cmd(cli, text, project_id)
    last_err = None
    for attempt in range(4):
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=CLI_TIMEOUT)
        except subprocess.TimeoutExpired:
            return _key_err(text, 'CLI Timeout', project_id, project_name)
        except FileNotFoundError:
            return _key_err(text, f'CLI not found: {cli}', project_id, project_name)
        except Exception as e:  # noqa: BLE001
            return _key_err(text, f'Error: {str(e)[:200]}', project_id, project_name)

        if proc.returncode != 0:
            return _key_err(text, f'CLI Error: {(proc.stderr or proc.stdout or "")[:200]}', project_id, project_name)

        result = _parse_search_output(proc.stdout, text, project_id, project_name)
        if isinstance(result, dict):
            return result  # 成功拿到结果（含 exact / 模糊命中）
        if result is None:
            # 接口偶发返回空 → 重试（不立即降级）
            last_err = 'No source match (retrying)'
            continue
        # result 是错误字符串（解析失败 / API 报错）
        last_err = result
        # 解析失败重试意义不大，但 API 偶发错误可重试 → 继续
    return _key_err(text, last_err or 'No source match', project_id, project_name)


def _normalize_ws(s):
    """归一化空白：把所有连续空白符（空格/换行/制表符等）折叠成单个空格，并 trim。

    用于 sourceContent 与 query 的精确命中比较——starling 返回的 sourceContent
    可能用 \\n\\n 分隔段落，而用户原文用单个空格（实测 KTP 文案第 138 字符处
    'system. Selfie' vs 'system.\\n\\nSelfie'）。字符串严格相等会误判为不精确，
    归一化后才是真正的「同一条文案」。
    """
    if not s:
        return ''
    return ' '.join(s.split())


def _normalize_loose(s):
    """宽松归一化：用于模糊命中判断，容忍大小写/标点/符号差异。

    流程：lowercase → 去掉所有非字母数字（标点、符号、空白都去掉）。
    用于「拼写/符号差异」容错：例如 'gold-medal!' 与 'Gold Medal' 会归一化成
    'goldmedal'，相等即视为匹配。仅用于判断是否命中，不改变原文展示。
    """
    if not s:
        return ''
    return ''.join(ch.lower() for ch in str(s) if ch.isalnum())


def _parse_search_output(stdout, query_text, project_id=None, project_name=None):
    """解析 /project/search 输出，取最匹配的 keyText。返回 dict / None / 错误字符串。

    匹配策略（层层放宽，容忍大小写/拼写/符号/空白差异）：
    1. 严格精确：_normalize_ws(sourceContent) == _normalize_ws(query)  → exact=True
    2. 宽松精确：_normalize_loose(sourceContent) == _normalize_loose(query)
       （去标点符号、大小写不敏感后相等，如 'gold-medal!' vs 'Gold Medal'）→ exact=True
    3. 否则取 score 最高的第一条 → exact=False（模糊命中）
    """
    if not stdout:
        return 'No source match (empty output)'
    text = stdout.strip()
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        start = text.find('{'); end = text.rfind('}')
        if start != -1 and end != -1 and end > start:
            try:
                payload = json.loads(text[start:end + 1])
            except json.JSONDecodeError:
                return f'Parse error: {text[:200]}'
        else:
            return f'Parse error: {text[:200]}'

    if not payload.get('ok'):
        msg = (payload.get('error') or {}).get('message', '') or str(payload)[:200]
        return f'Starling API error: {msg}'

    matches = (payload.get('data') or {}).get('data') or []
    if not matches:
        return None  # 无匹配 → 降级空结果

    q_ws = _normalize_ws(query_text)
    q_loose = _normalize_loose(query_text)
    # 1. 严格精确（空白归一化后相等）
    exact = [m for m in matches
             if isinstance(m, dict) and _normalize_ws(m.get('sourceContent') or '') == q_ws]
    # 2. 宽松精确（去标点符号 + 大小写不敏感后相等，仅在严格未命中时启用）
    if not exact and q_loose:
        exact = [m for m in matches
                 if isinstance(m, dict) and _normalize_loose(m.get('sourceContent') or '') == q_loose]
    best = exact[0] if exact else matches[0]
    is_exact = bool(exact)
    return {
        'key': best.get('keyText') or '',                 # 源文案 key（如 music_video_official）
        'score': float(best.get('score') or 0.0),          # 匹配分（精确匹配明显更高）
        'exact': is_exact,                                 # 是否精确命中（含宽松精确）
        'source_content': best.get('sourceContent') or '',
        'target_content': best.get('targetContent') or '',
        'namespace': best.get('namespace') or '',
        'source_text': query_text,                         # 回填输入原文，供 popup 映射
        'project_id': project_id,                          # 命中来自哪个项目（2026-07-03 多项目支持）
        'project_name': project_name,
        'method': 'starling-search',
        'candidate_count': len(matches),
    }


def _key_err(text, origin, project_id=None, project_name=None):
    return {
        'source_text': text,
        'key': '',
        'score': 0.0,
        'exact': False,
        'source_content': '',
        'target_content': '',
        'origin': origin,
        'project_id': project_id,
        'project_name': project_name,
        'method': 'starling-search',
        'candidate_count': 0,
    }


def _resolve_project_name(cli, project_id):
    """通过 /projects 接口反查项目名。失败返回 None（不阻塞，仅展示用）。"""
    try:
        proc = subprocess.run([cli, 'api', 'GET', '/projects'],
                              capture_output=True, text=True, timeout=CLI_TIMEOUT)
        if proc.returncode != 0:
            return None
        payload = json.loads(proc.stdout.strip())
        if not payload.get('ok'):
            return None
        lst = (payload.get('data') or {}).get('list') or []
        for p in lst:
            if str(p.get('id')) == str(project_id):
                return p.get('name') or ''
    except Exception:  # noqa: BLE001
        pass
    return None


def _pick_best(results):
    """从多条目（来自不同项目）里选最优 key。

    优先级：1. exact=True 优先（且 score 高）→ 2. score 高优先 → 3. 第一个非空 key。
    原始结果里有 error 条目（key 为空）也保留，但不会被选中。
    """
    valid = [r for r in results if r and r.get('key')]
    if not valid:
        return results[0] if results else None
    exact_hits = [r for r in valid if r.get('exact')]
    if exact_hits:
        return sorted(exact_hits, key=lambda r: r.get('score', 0), reverse=True)[0]
    return sorted(valid, key=lambda r: r.get('score', 0), reverse=True)[0]


def request_key_search_batch(cli, texts, project_ids,
                             max_concurrency=KEY_SEARCH_MAX_CONCURRENCY,
                             message=None):
    """在一个官方签名客户端进程内批量查询 Source String Key。

    `/project/search` 协议自身仍是一条原文对应一个项目的查询，因此请求数是
    `len(texts) * len(project_ids)`。该函数复用单个 Node 进程和官方 StarlingClient，
    限制并发，避免旧实现为每个组合反复启动 `starling-cli`。
    """
    if not os.path.isfile(KEY_SEARCH_CLIENT_SCRIPT):
        raise RuntimeError(f'key search client script missing: {KEY_SEARCH_CLIENT_SCRIPT}')
    cli_root = _resolve_starling_cli_root(cli)
    env = credential_env(message or {})
    env['STARLING_AGENT_CLI_ROOT'] = cli_root
    proc = subprocess.run(
        [_resolve_node(), KEY_SEARCH_CLIENT_SCRIPT],
        input=json.dumps({
            'texts': texts,
            'project_ids': project_ids,
            'max_concurrency': max_concurrency,
        }, ensure_ascii=False),
        capture_output=True,
        text=True,
        timeout=KEY_SEARCH_TIMEOUT,
        env=env,
    )
    raw = (proc.stdout or '').strip()
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        detail = (proc.stderr or raw or 'empty output')[:300]
        raise RuntimeError(f'key search client returned invalid JSON: {detail}') from exc
    if not payload.get('ok'):
        message = (payload.get('error') or {}).get('message') or 'key search failed'
        raise RuntimeError(f'Starling key search: {message}')
    results = payload.get('results')
    if not isinstance(results, list):
        raise RuntimeError('key search client response results must be a list')
    return {'results': results}


def search_key(message):
    """按原文批量查 key（支持多项目）。message: { texts, project_ids, project_id, cli_path }。

    project_ids: 项目 ID 数组（2026-07-03 多项目支持）。若提供则在每个项目里查，
    每条原文取最优一个 key（exact 优先 → score 优先），结果带 project_id/project_name。
    project_id: 旧字段（单项目），向后兼容；project_ids 优先。
    """
    texts = message.get('texts', []) or []
    cli = resolve_cli(message.get('cli_path'))

    # 解析项目列表：project_ids 优先，否则用旧 project_id
    project_ids = message.get('project_ids')
    if not project_ids:
        single = message.get('project_id')
        project_ids = [single] if single else []
    # 去重保序 + 规范成 int
    seen = set()
    norm_ids = []
    for pid in project_ids:
        try:
            ipid = int(pid)
        except (TypeError, ValueError):
            continue
        if ipid not in seen:
            seen.add(ipid)
            norm_ids.append(ipid)
    if not norm_ids:
        raise ValueError('project_required')

    if not texts:
        return {'results': []}

    max_concurrency = max(1, min(
        int(message.get('max_workers') or KEY_SEARCH_MAX_CONCURRENCY),
        KEY_SEARCH_MAX_CONCURRENCY,
    ))
    payload = request_key_search_batch(
        cli, texts, norm_ids, max_concurrency, message=message
    )
    batch_results = payload.get('results') or []
    if len(batch_results) != len(texts):
        raise RuntimeError(
            f'key search response count mismatch: got {len(batch_results)}, expected {len(texts)}'
        )

    results = []
    for text, batch_result in zip(texts, batch_results):
        if not isinstance(batch_result, dict) or batch_result.get('source_text') != text:
            raise RuntimeError('key search response order does not match source texts')
        per_project = []
        for candidate in batch_result.get('candidates') or []:
            if not isinstance(candidate, dict):
                continue
            project_id = candidate.get('project_id')
            if isinstance(candidate.get('response'), dict):
                parsed = _parse_search_output(
                    json.dumps({'ok': True, 'data': candidate['response']}),
                    text,
                    project_id,
                    None,
                )
                if isinstance(parsed, dict):
                    per_project.append(parsed)
                elif isinstance(parsed, str):
                    per_project.append(_key_err(text, parsed, project_id, None))
                else:
                    per_project.append(_key_err(text, 'No source match', project_id, None))
            else:
                per_project.append(_key_err(
                    text,
                    candidate.get('error') or 'No source match',
                    project_id,
                    None,
                ))
        best = _pick_best(per_project)
        results.append(best or _key_err(text, 'No source match', None, None))
    return {'results': results}


def list_projects(message):
    """分页拉取当前 AK/SK 有权访问的全部 Starling 项目。

    Starling `/projects` 默认只返回 25 条。本函数显式传入 `limit` 与 `offset`，
    直到收集数量达到响应中的 `total`；任何中间页失败或分页不完整都整体失败，
    禁止把部分项目列表伪装成完整权限结果。
    """
    cli = resolve_cli(message.get('cli_path'))
    projects = []
    offset = 0
    expected_total = None
    while expected_total is None or len(projects) < expected_total:
        params = json.dumps({
            'limit': PROJECT_LIST_PAGE_SIZE,
            'offset': offset,
        })
        cmd = [
            cli, 'api', 'GET', '/projects',
            '--params', params,
        ]
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=CLI_TIMEOUT,
                env=credential_env(message),
            )
        except subprocess.TimeoutExpired:
            return {
                'ok': False,
                'error': f'Project list CLI timeout at offset {offset}',
            }
        except FileNotFoundError:
            return {'ok': False, 'error': f'CLI not found: {cli}'}
        except Exception as e:  # noqa: BLE001
            return {'ok': False, 'error': f'Error: {str(e)[:200]}'}

        if proc.returncode != 0:
            detail = (proc.stderr or proc.stdout or '')[:300]
            return {
                'ok': False,
                'error': f'Project list CLI error at offset {offset}: {detail}',
            }

        try:
            raw = json.loads(proc.stdout.strip())
        except Exception as e:  # noqa: BLE001
            return {
                'ok': False,
                'error': (
                    f'解析项目列表失败 at offset {offset}: '
                    f'{str(e)[:150]}'
                ),
            }

        payload = raw.get('data', raw)
        if isinstance(payload, dict):
            data = payload.get('data', payload.get('projects'))
            raw_total = payload.get('total')
            pagination = payload.get('pagination')
        else:
            data = payload
            raw_total = None
            pagination = None
        if not isinstance(data, list):
            return {
                'ok': False,
                'error': f'项目列表协议错误 at offset {offset}: data must be a list',
            }
        if raw_total is None:
            return {
                'ok': False,
                'error': (
                    f'项目列表协议错误 at offset {offset}: '
                    'total is required to verify a complete project list'
                ),
            }
        if pagination is not None:
            if not isinstance(pagination, dict):
                return {
                    'ok': False,
                    'error': (
                        f'项目列表协议错误 at offset {offset}: '
                        'pagination must be an object'
                    ),
                }
            try:
                response_offset = int(pagination.get('offset'))
            except (TypeError, ValueError):
                return {
                    'ok': False,
                    'error': (
                        f'项目列表协议错误 at offset {offset}: '
                        'invalid pagination offset'
                    ),
                }
            if response_offset != offset:
                return {
                    'ok': False,
                    'error': (
                        'Project list pagination offset mismatch: '
                        f'requested {offset}, received {response_offset}'
                    ),
                }
        try:
            expected_total = int(raw_total)
        except (TypeError, ValueError):
            return {
                'ok': False,
                'error': f'项目列表协议错误 at offset {offset}: invalid total',
            }
        if expected_total < 0:
            return {
                'ok': False,
                'error': f'项目列表协议错误 at offset {offset}: invalid total',
            }

        for project_data in data:
            if not isinstance(project_data, dict):
                continue
            project_id = project_data.get('id') or project_data.get('projectId')
            if project_id is None:
                continue
            projects.append({
                'id': project_id,
                'name': (
                    project_data.get('name')
                    or project_data.get('projectName')
                    or f'项目 {project_id}'
                ),
                'sourceLocale': (
                    project_data.get('sourceLocale')
                    or project_data.get('source_locale')
                    or project_data.get('sourceLanguage')
                    or ''
                ),
                'targetLocales': (
                    project_data.get('targetLocales')
                    or project_data.get('target_locales')
                    or project_data.get('targetLanguages')
                    or []
                ),
            })

        if expected_total is not None and len(projects) >= expected_total:
            break
        if len(data) < PROJECT_LIST_PAGE_SIZE:
            if expected_total is not None and len(projects) < expected_total:
                return {
                    'ok': False,
                    'error': (
                        'Project list pagination incomplete: '
                        f'expected {expected_total}, received {len(projects)}'
                    ),
                }
            break
        offset += len(data)
    return {'ok': True, 'projects': projects}


def _parse_cli_output(stdout):
    """
    解析 starling-cli 的 JSON 输出，取最相似的 1 条 TM 匹配。

    返回标准化的 dict（成功）或错误字符串（失败）。
    """
    if not stdout:
        return 'No TM match (empty output)'
    text = stdout.strip()
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        # CLI 可能混入日志，尝试截取首个 JSON 对象
        start = text.find('{')
        end = text.rfind('}')
        if start != -1 and end != -1 and end > start:
            try:
                payload = json.loads(text[start:end + 1])
            except json.JSONDecodeError:
                return f'Parse error: {text[:200]}'
        else:
            return f'Parse error: {text[:200]}'

    if not payload.get('ok'):
        msg = (payload.get('error') or {}).get('message', '') or str(payload)[:200]
        return f'Starling API error: {msg}'

    matches = (payload.get('data') or {}).get('data') or []
    if not matches:
        return None  # 无匹配 → 调用方降级为空结果

    best = matches[0]  # 已按相似度降序
    tm_source = best.get('source') or ''
    return {
        'tm_match': best.get('target') or '',           # TM 目标语言译文（供复用译文时使用）
        'tm_source': tm_source,                         # TM 库里的英文原文（展示与 source rewrite 用）
        'similarity': float(best.get('score') or 0.0),   # Orig Match % (0-100)
        'origin': best.get('updater') or 'Unknown',
        'tm_source_lang': best.get('sourceLang') or '',
        'tm_target_lang': best.get('targetLang') or '',
        # LOOP_SPEC §4.3 method/version 元数据（可解释性）
        'method': 'starling',
        'method_version': 'starling-cli-1.1.16',
        'candidate_count': len(matches),
    }


def build_batch_tm_body(texts, project_ids, source_lang, target_lang,
                        limit=3, least_score=0):
    """构造已在 PPE 验证过的批量 TM Match 请求体。

    Starling 已确认 `projectIds` 与 `sourceContents` 的平台上限均为 10 个；
    `search_tm_batch()` 负责把较长输入按 10 条分批，本函数负责拒绝非法单批请求。
    """
    if not isinstance(texts, list) or not texts:
        raise ValueError('sourceContents must be a non-empty list')
    if any(not isinstance(text, str) or not text for text in texts):
        raise ValueError('sourceContents must contain non-empty strings')
    if not isinstance(project_ids, list) or not project_ids:
        raise ValueError('projectIds must be a non-empty list')
    if len(project_ids) > 10:
        raise ValueError('projectIds supports at most 10 items')
    if len(texts) > BATCH_TM_SAFE_SIZE:
        raise ValueError(
            f'sourceContents supports at most {BATCH_TM_SAFE_SIZE} items per request'
        )

    normalized_project_ids = []
    for project_id in project_ids:
        try:
            value = int(project_id)
        except (TypeError, ValueError) as exc:
            raise ValueError(f'invalid projectId: {project_id!r}') from exc
        if value <= 0:
            raise ValueError(f'invalid projectId: {project_id!r}')
        normalized_project_ids.append(value)

    return {
        'projectIds': normalized_project_ids,
        'sourceContents': texts,
        'sourceLang': source_lang,
        'targetLang': target_lang,
        'limit': int(limit),
        'leastScore': least_score,
    }


def parse_batch_tm_response(stdout, texts, source_lang, target_lang):
    """将批量 TM OpenAPI 响应映射为插件既有的一条文案一条结果结构。

    PPE 实测响应为 `{data: Array<Array<TMMatch>>}`，外层数组严格对应请求中的
    `sourceContents` 顺序；每个内层数组按相似度降序，首项是当前 UI 所需的
    Best TM Match。协议异常必须直接暴露，不能伪装成无 TM 命中。
    """
    try:
        payload = json.loads(stdout) if isinstance(stdout, str) else stdout
    except json.JSONDecodeError as exc:
        raise ValueError(f'batch TM response is not valid JSON: {exc}') from exc

    if not isinstance(payload, dict):
        raise ValueError('batch TM response must be a JSON object')
    match_groups = payload.get('data')
    if not isinstance(match_groups, list):
        raise ValueError('batch TM response data must be a list')
    if len(match_groups) != len(texts):
        raise ValueError(
            f'batch TM response count mismatch: got {len(match_groups)}, '
            f'expected {len(texts)}'
        )

    results = []
    for index, matches in enumerate(match_groups):
        text = texts[index]
        if not isinstance(matches, list):
            raise ValueError(f'batch TM response data[{index}] must be a list')
        if not matches:
            result = _err(text, source_lang, target_lang, 'No TM match')
            result['method'] = BATCH_TM_METHOD
            result['method_version'] = BATCH_TM_METHOD_VERSION
            result['tm_candidates'] = []
            results.append(result)
            continue

        candidates = normalize_batch_tm_candidates(
            matches, source_lang, target_lang, index
        )
        best = candidates[0]
        results.append({
            'source_text': text,
            'tm_match': best['target'],
            'tm_source': best['source'],
            'similarity': best['score'],
            'origin': best['origin'],
            'tm_source_lang': best['source_lang'],
            'tm_target_lang': best['target_lang'],
            'method': BATCH_TM_METHOD,
            'method_version': BATCH_TM_METHOD_VERSION,
            'candidate_count': len(candidates),
            'tm_candidates': candidates,
        })
    return results


def normalize_batch_tm_candidates(matches, source_lang, target_lang, group_index):
    """规范化并去重一条 source 对应的 Starling TM 候选数组。

    候选位置沿用服务端首次出现顺序；相同 source 与 target 再次出现时，仅在
    分数更高的情况下替换该位置的内容。任何非对象或非数值 score 都属于协议
    错误，必须停止当前批次。
    """
    candidates = []
    positions = {}
    for candidate_index, match in enumerate(matches):
        if not isinstance(match, dict):
            raise ValueError(
                f'batch TM response data[{group_index}]'
                f'[{candidate_index}] must be an object'
            )
        raw_score = match.get('score')
        try:
            score = float(raw_score)
        except (TypeError, ValueError) as exc:
            raise ValueError(
                f'batch TM response data[{group_index}]'
                f'[{candidate_index}].score must be numeric'
            ) from exc
        if not math.isfinite(score):
            raise ValueError(
                f'batch TM response data[{group_index}]'
                f'[{candidate_index}].score must be finite'
            )
        normalized = {
            'source': str(match.get('source') or ''),
            'target': str(match.get('target') or ''),
            'score': score,
            'origin': str(match.get('updater') or match.get('origin') or 'Unknown'),
            'source_lang': str(match.get('sourceLang') or source_lang),
            'target_lang': str(match.get('targetLang') or target_lang),
            'match_category': (
                match.get('matchCategory')
                if match.get('matchCategory') is not None
                else match.get('match_category')
            ),
            'tm_id': str(
                match.get('id') or match.get('tmId') or match.get('tm_id') or ''
            ),
        }
        key = (normalized['source'], normalized['target'])
        if key not in positions:
            positions[key] = len(candidates)
            candidates.append(normalized)
            continue
        position = positions[key]
        if normalized['score'] > candidates[position]['score']:
            candidates[position] = normalized
    return candidates


def _resolve_starling_cli_root(cli):
    """定位包含官方 Starling Core 的 CLI 包根目录。"""
    resolved = os.path.realpath(cli)
    runtime_root = os.path.dirname(os.path.dirname(resolved))
    bundled_root = os.path.join(
        runtime_root,
        'starling',
        'node_modules',
        '@byted',
        'starling-agent-cli',
    )
    bundled_core = os.path.join(
        bundled_root, 'node_modules', '@byted', 'starling-agent-core'
    )
    if os.path.isdir(bundled_core):
        return bundled_root

    current = os.path.dirname(resolved)
    while current and current != os.path.dirname(current):
        core_dir = os.path.join(
            current, 'node_modules', '@byted', 'starling-agent-core'
        )
        if os.path.isdir(core_dir):
            return current
        current = os.path.dirname(current)
    raise RuntimeError(
        '无法定位 starling-agent-cli 的官方签名客户端；请重新安装 starling-cli'
    )


def _resolve_node():
    """定位可执行 Node.js，Chrome 极简 PATH 场景也可工作。"""
    node = shutil.which('node')
    if node:
        return node
    for directory in NODE_BIN_DIRS:
        candidate = os.path.join(directory, 'node')
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    raise RuntimeError('Node.js not found; starling-cli runtime is incomplete')


def is_retryable_batch_error(status, message):
    """判断是否为 PPE 已观测到的短暂远端连接超时。"""
    normalized_message = str(message or '').lower()
    return (
        status == 400
        and 'error_code=1204' in normalized_message
        and 'remote or network error' in normalized_message
    )


def request_batch_tm(cli, body, use_ppe, message=None):
    """通过 Starling 官方 core 的 AK/SK signer 调用批量 TM Match 接口。

    API Runner 会拒绝未登记路径，因此这里不能复用 `starling-cli api`；改为
    复用同一 CLI 安装包的 StarlingClient 和 agw-auth 签名逻辑，不自行实现签名。
    """
    if not os.path.isfile(BATCH_CLIENT_SCRIPT):
        raise RuntimeError(f'batch client script missing: {BATCH_CLIENT_SCRIPT}')
    cli_root = _resolve_starling_cli_root(cli)
    env = credential_env(message or {})
    env['STARLING_AGENT_CLI_ROOT'] = cli_root
    for attempt in range(BATCH_TRANSIENT_MAX_ATTEMPTS):
        proc = subprocess.run(
            [_resolve_node(), BATCH_CLIENT_SCRIPT],
            input=json.dumps({'body': body, 'use_ppe': bool(use_ppe)}, ensure_ascii=False),
            capture_output=True,
            text=True,
            timeout=CLI_TIMEOUT,
            env=env,
        )
        raw = (proc.stdout or '').strip()
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as exc:
            detail = (proc.stderr or raw or 'empty output')[:300]
            raise RuntimeError(f'batch client returned invalid JSON: {detail}') from exc

        if payload.get('ok'):
            response = payload.get('response')
            if not isinstance(response, dict):
                raise RuntimeError('batch client response must be a JSON object')
            return response

        error = payload.get('error') or {}
        message = error.get('message') or 'batch TM request failed'
        status = error.get('status') or 0
        if (
            is_retryable_batch_error(status, message)
            and attempt < BATCH_TRANSIENT_MAX_ATTEMPTS - 1
        ):
            time.sleep(0.25 * (attempt + 1))
            continue
        logid = error.get('logid')
        suffix = f' (logid: {logid})' if logid else ''
        raise RuntimeError(f'Starling batch TM HTTP {status}: {message}{suffix}')

    raise RuntimeError('batch TM request exhausted without a response')


def search_tm_batch(message):
    """以每批最多 10 条、最多 5 个并发批次查询 TM，并保留输入顺序。

    Starling 已确认 `sourceContents` 与 `projectIds` 各最多 10 条。调用方可以
    降低文案批次大小和并发度，不能绕过上限；项目数由请求体构造函数独立校验。
    """
    texts = message.get('texts', []) or []
    if not texts:
        return {'results': []}
    source_lang = message.get('source_lang', 'en')
    target_lang = message.get('target_lang', 'zh')
    project_ids = message.get('project_ids')
    if not project_ids:
        single = message.get('project_id')
        project_ids = [single] if single else []
    if not project_ids:
        raise ValueError('project_required')
    least_score = message.get('least_score', 0)
    limit = message.get('limit', 3)
    use_ppe = message.get('use_ppe', False) is True
    batch_size = int(message.get('batch_size') or BATCH_TM_SAFE_SIZE)
    if batch_size <= 0:
        raise ValueError('batch_size must be positive')
    if batch_size > BATCH_TM_SAFE_SIZE:
        raise ValueError(
            f'batch_size must not exceed verified safe limit {BATCH_TM_SAFE_SIZE}'
        )
    batch_concurrency = int(
        message.get('batch_concurrency', BATCH_TM_MAX_CONCURRENCY)
    )
    if batch_concurrency <= 0:
        raise ValueError('batch_concurrency must be positive')
    if batch_concurrency > BATCH_TM_MAX_CONCURRENCY:
        raise ValueError(
            'batch_concurrency must not exceed client limit '
            f'{BATCH_TM_MAX_CONCURRENCY}'
        )
    cli = resolve_cli(message.get('cli_path'))

    batches = [
        texts[start:start + batch_size]
        for start in range(0, len(texts), batch_size)
    ]

    def query_batch(batch):
        """查询单个安全批次并返回与批次输入同序的结果。"""
        body = build_batch_tm_body(
            batch, project_ids, source_lang, target_lang, limit, least_score
        )
        payload = request_batch_tm(cli, body, use_ppe, message=message)
        return parse_batch_tm_response(
            payload, batch, source_lang, target_lang
        )

    worker_count = min(batch_concurrency, len(batches))
    if worker_count == 1:
        grouped_results = [query_batch(batch) for batch in batches]
    else:
        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            grouped_results = list(executor.map(query_batch, batches))
    results = [item for group in grouped_results for item in group]
    return {'results': results}


def _err(text, source_lang, target_lang, origin):
    return {
        'source_text': text,
        'tm_match': '',
        'similarity': 0.0,
        'origin': origin,
        'tm_source_lang': source_lang,
        'tm_target_lang': target_lang,
        # 失败时也带 method，便于区分是 starling 失败还是本地兜底
        'method': 'starling',
        'method_version': 'starling-cli-1.1.16',
        'candidate_count': 0,
    }


def search_tm(message):
    if message.get('tm_mode') == 'batch':
        return search_tm_batch(message)

    texts = message.get('texts', []) or []
    source_lang = message.get('source_lang', 'en')
    target_lang = message.get('target_lang', 'zh')
    project_id = message.get('project_id')
    if not project_id:
        raise ValueError('project_required')
    least_score = message.get('least_score', 0)
    limit = message.get('limit', 1)
    cli = resolve_cli(message.get('cli_path'))

    def _do(t):
        res = search_single(cli, t, source_lang, target_lang, project_id,
                            least_score, limit, env=credential_env(message))
        # search_single 在无匹配/解析失败时可能返回字符串 → 降级为空结果
        if not isinstance(res, dict):
            res = _err(t, source_lang, target_lang,
                       res if isinstance(res, str) else 'No TM match')
        return res

    # 并发查询：starling-cli 每次 spawn 一个新进程（含 node 启动+鉴权），
    # 串行 1.4s/条；并发 N 进程墙钟 ~1.5×（实测 8 并发 4.75× 提速）。
    # ThreadPoolExecutor 保留输入顺序（按 texts 索引映射），subprocess.run 释放 GIL。
    max_workers = max(1, min(int(message.get('max_workers') or 8), 32))
    if not texts:
        return {'results': []}
    if len(texts) == 1:
        return {'results': [_do(texts[0])]}
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        results = list(ex.map(_do, texts))
    return {'results': results}


# ---------------------------------------------------------------------------
# LLM 调用（绕过浏览器 CORS，由 Python 直连网关）
# 火山方舟 reasoning 模型偶发慢请求（排队/冷启动），60s 偏紧提到 120s。
# ---------------------------------------------------------------------------
LLM_TIMEOUT = 120  # 秒


def llm_call(message):
    """
    用 urllib 直连 LLM 网关（无浏览器 CORS 限制），返回 LLM 文本。

    支持 Claude (Anthropic) 与 OpenAI 兼容两种格式：
      provider == 'claude' 或 endpoint 含 'anthropic' → Claude 格式
      否则 → OpenAI 格式

    成功：{ "ok": True, "text": "<LLM 文本>" }
    失败：{ "ok": False, "error": "...", "status": <http 状态码或 0> }
    """
    endpoint = message.get('endpoint') or ''
    api_key = message.get('api_key') or ''
    model = message.get('model') or ''
    prompt = message.get('prompt') or ''
    provider = message.get('provider') or ''

    if not endpoint or not api_key or not model:
        return {'ok': False, 'error': 'missing endpoint/api_key/model', 'status': 0}

    use_claude = provider == 'claude' or (
        not provider and 'anthropic' in endpoint
    )

    if use_claude:
        headers = {
            'Content-Type': 'application/json',
            'x-api-key': api_key,
            'anthropic-version': '2023-06-01',
        }
        body = json.dumps({
            'model': model,
            'max_tokens': 1024,
            'messages': [{'role': 'user', 'content': prompt}],
        }).encode('utf-8')
    else:
        headers = {
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {api_key}',
        }
        body = json.dumps({
            'model': model,
            'messages': [{'role': 'user', 'content': prompt}],
            'temperature': 0.3,
        }).encode('utf-8')

    req = urllib.request.Request(endpoint, data=body, headers=headers, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=LLM_TIMEOUT) as resp:
            raw = resp.read().decode('utf-8', errors='replace')
    except urllib.error.HTTPError as e:
        err_body = ''
        try:
            err_body = e.read().decode('utf-8', errors='replace')[:200]
        except Exception:  # noqa: BLE001
            pass
        return {'ok': False,
                'error': f'HTTP {e.code}: {err_body}',
                'status': e.code}
    except Exception as e:  # noqa: BLE001  超时/连接失败等
        return {'ok': False, 'error': f'LLM request error: {str(e)[:200]}',
                'status': 0}

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {'ok': False, 'error': f'non-JSON response: {raw[:200]}',
                'status': 200}

    # Claude: data.content 是数组，glm-5.2 等模型会先返回 thinking 块，
    # 真正文本在 type=='text' 的块里。遍历取第一个 text 块。
    if use_claude:
        text = ''
        content = data.get('content') or []
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and block.get('type') == 'text':
                    text = block.get('text', '') or ''
                    if text:
                        break
            # 回退：没有 text 块时取第一个块的 text/thinking 字段
            if not text and content and isinstance(content[0], dict):
                text = content[0].get('text', '') or content[0].get('thinking', '') or ''
    else:
        choices = data.get('choices') or []
        text = choices[0].get('message', {}).get('content', '') if choices else ''

    return {'ok': True, 'text': text}


# ---------------------------------------------------------------------------
# 飞书 ROI 归档用户授权（本机 OAuth 回调）
# ---------------------------------------------------------------------------
def feishu_oauth_info(_message):
    """返回 Settings 展示所需的公开 App ID、回调地址与最小授权 scope。"""
    return {
        'ok': True,
        'app_id': feishu_oauth.FEISHU_APP_ID,
        'redirect_uri': feishu_oauth.REDIRECT_URI,
        'scope': feishu_oauth.FEISHU_USER_SCOPE,
    }


def feishu_user_oauth(message):
    """以内置 App ID 和 Keychain Secret 启动 PKCE OAuth，并返回短期用户令牌。"""
    return feishu_oauth.authorize_user(
        app_id=feishu_oauth.FEISHU_APP_ID,
        redirect_uri=message.get('redirect_uri') or feishu_oauth.REDIRECT_URI,
        scope=message.get('scope') or feishu_oauth.FEISHU_USER_SCOPE,
        return_url=message.get('return_url') or '',
    )


def feishu_configure_app_secret(_message):
    """通过 Native Host 系统隐藏输入框完成 Owner Secret 的验证与保存。"""
    return feishu_oauth.configure_app_secret()


def feishu_secret_status(_message):
    """只返回 Keychain 是否已有 Secret，不读取到浏览器。"""
    return {'ok': True, 'configured': bool(feishu_oauth.load_app_secret())}


def feishu_save_secret(message):
    """先验证 Secret，成功后保存到 Keychain，并返回短期 token。"""
    secret = message.get('app_secret') or ''
    token = feishu_oauth.get_tenant_access_token(secret)
    feishu_oauth.save_app_secret(secret)
    return {'ok': True, **token}


def feishu_get_access_token(_message):
    """从 Keychain 读取 Secret 并换取短期 token；响应不包含 Secret。"""
    secret = feishu_oauth.load_app_secret()
    token = feishu_oauth.get_tenant_access_token(secret)
    return {'ok': True, **token}


# ---------------------------------------------------------------------------
# 主循环
# ---------------------------------------------------------------------------
def main():
    while True:
        try:
            message = read_message()
        except Exception:  # noqa: BLE001
            break

        action = message.get('action', '')
        _log('recv action=' + action + ' keys=' + ','.join(message.keys()))
        try:
            if action == 'search_tm':
                send_message(search_tm(message))
            elif action == 'search_key':
                send_message(search_key(message))
            elif action == 'llm_call':
                send_message(llm_call(message))
            elif action == 'list_projects':
                send_message(list_projects(message))
            elif action == 'save_starling_credentials':
                send_message(save_starling_credentials(message))
            elif action == 'get_starling_credentials':
                send_message(get_starling_credentials(message))
            elif action == 'ping':
                send_message({'pong': True, 'cli': resolve_cli(message.get('cli_path'))})
            elif action == 'feishu_oauth_info':
                send_message(feishu_oauth_info(message))
            elif action == 'feishu_user_oauth':
                send_message(feishu_user_oauth(message))
            elif action == 'feishu_configure_app_secret':
                send_message(feishu_configure_app_secret(message))
            elif action == 'feishu_secret_status':
                send_message(feishu_secret_status(message))
            elif action == 'feishu_save_secret':
                send_message(feishu_save_secret(message))
            elif action == 'feishu_get_access_token':
                send_message(feishu_get_access_token(message))
            else:
                send_message({'error': f'Unknown action: {action}'})
        except Exception as e:  # noqa: BLE001  处理中崩溃也要回响应，否则 Chrome 报通信断
            _log('HANDLER CRASH: ' + repr(e) + '\n' + _tb.format_exc())
            try:
                send_message({'error': f'bridge internal error: {repr(e)[:200]}'})
            except Exception:  # noqa: BLE001
                pass


if __name__ == '__main__':
    main()
