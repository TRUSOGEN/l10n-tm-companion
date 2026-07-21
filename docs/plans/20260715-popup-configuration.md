# Popup Configuration and Starling Credentials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户在 Settings 直接保存并回填 AK/SK，在 Popup 自动发现权限项目并选择 vendor、项目和 target locale，同时压缩低频来源与工作表区域。

**Architecture:** Chrome storage 保存完整凭证备份，Native Host 通过官方 Starling Core `saveConfig` 保存运行副本；请求时 Chrome 凭证通过 Native Messaging 注入 Starling 子进程环境。Popup 使用纯函数 run-config 模块约束一至十个项目、source locale 和共同 target locale，再把结果传给现有 Batch TM 与 local rate resolver。

**Tech Stack:** Chrome Extension MV3、ES modules、Python Native Messaging、官方 `@byted/starling-agent-core`、Node/Python 脚本式测试。

## Global Constraints

- 完整 AK/SK 同时保存在 `chrome.storage.local` 与 `~/.starling-cli/.starlingrc.json`，Settings 完整回填且默认遮挡。
- 任何 console、debug log、错误、测试输出和飞书写回不得包含真实 AK/SK；测试只使用 `test-ak`、`test-sk`。
- 项目至少一个、最多十个；多选项目必须同 source locale 且存在共同 target locale。
- target locale 来自所有已选项目 `targetLocales` 的交集，不从项目名或 vendor 猜测。
- vendor 必须四选一；费率继续严格来自 `data/local-rates.json`，只增加明确 locale 规范化与可用 vendor 建议。
- 删除默认项目 385 的运行兜底；配置缺失必须正确停止并引导。
- `Other sources`、健康检查和可用的 `Working spreadsheet` 默认折叠；错误区域自动展开。
- 所有新增 Python 函数有 docstring，所有新增 JavaScript 导出函数有 JSDoc。
- 测试输出保存到 `temp/test_popup_configuration/` 并人工检查。
- 当前 `l10n-tm-companion/` 是父仓库未跟踪目录，不执行 commit、push 或分支操作。

---

### Task 1: Native Host 凭证保存、读取与请求注入

**Files:**
- Create: `native-host/starling-credentials-client.js`
- Modify: `native-host/starling-bridge.py`
- Create: `test/starling-credentials-client.test.js`
- Create: `test/starling-credentials-test.py`

**Interfaces:**
- Consumes: `{action:'save'|'get', access_key?, secret_key?}` 和 `STARLING_AGENT_CLI_ROOT`。
- Produces: `save_starling_credentials(message)`、`get_starling_credentials(message)`、`credential_env(message)`；响应不包含异常对象或请求 payload。

- [x] **Step 1: 写失败测试固定官方 saveConfig、完整读取、0600 路径和凭证环境注入**

```javascript
assert('save 成功', saveResult.ok === true);
assert('官方配置收到完整 AK', saved.accessKey === 'test-ak');
assert('官方配置收到完整 SK', saved.secretKey === 'test-sk');
assert('get 返回完整值', getResult.access_key === 'test-ak' && getResult.secret_key === 'test-sk');
```

```python
def test_credential_env_uses_request_values(self):
    env = bridge.credential_env({'access_key': 'test-ak', 'secret_key': 'test-sk'})
    self.assertEqual(env['STARLING_ACCESS_KEY'], 'test-ak')
    self.assertEqual(env['STARLING_SECRET_KEY'], 'test-sk')
```

- [x] **Step 2: 运行测试并确认 helper/action 尚不存在**

Run: `node test/starling-credentials-client.test.js && python3 -m unittest test/starling-credentials-test.py -v`

Expected: helper 文件或导出函数不存在，退出码非 0。

- [x] **Step 3: 实现官方 Core helper、bridge actions 和子进程 env**

```javascript
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const core = await loadStarlingCore();
if (input.action === 'save') {
  core.saveConfig({ accessKey: input.access_key, secretKey: input.secret_key });
  writeOutput({ ok: true });
} else {
  const config = await core.loadConfig();
  writeOutput({ ok: true, access_key: config.accessKey, secret_key: config.secretKey });
}
```

```python
def credential_env(message):
    """为单次 Starling 子进程注入请求凭证，不修改全局环境。"""
    env = os.environ.copy()
    if message.get('access_key') and message.get('secret_key'):
        env['STARLING_ACCESS_KEY'] = message['access_key']
        env['STARLING_SECRET_KEY'] = message['secret_key']
    return env
```

所有 `list_projects`、Batch TM、legacy TM 和 Key search 子进程改用该 env；`search_tm_batch` 不再补默认项目 385，空项目直接抛 `project_required`。

- [x] **Step 4: 运行两组凭证测试和 bridge 既有 Python 回归**

Run: `node test/starling-credentials-client.test.js && python3 -m unittest test/starling-credentials-test.py -v && python3 test/batch-tm-test.py`

Expected: 凭证测试通过，既有 Batch TM 测试无回归，输出不含 `test-sk` 之外的敏感值。

### Task 2: Settings 双份保存与完整回填

**Files:**
- Modify: `lib/starling-tm.js`
- Modify: `options.html`
- Modify: `options.js`
- Modify: `options.css`
- Modify: `test/starling-tm-batch.test.js`
- Create: `test/options-credentials.test.js`

**Interfaces:**
- Consumes: storage keys `starlingAccessKey`、`starlingSecretKey`、`starlingCredentialsUpdatedAt`、`starlingCredentialState`。
- Produces: `saveStarlingCredentials(opts)`、`getStarlingCredentials(opts)`、`credentialsFromStorage(data)`；Settings 的 `Save & Verify` 与两个 reveal button。

- [x] **Step 1: 写失败测试固定完整回填、password 默认、双显示按钮、保存顺序和 payload 转发**

```javascript
assert('AK 默认遮挡', html.includes('id="starlingAccessKey" type="password"'));
assert('SK 默认遮挡', html.includes('id="starlingSecretKey" type="password"'));
assert('两个显示按钮', (html.match(/data-reveal-target=/g) || []).length === 2);
assert('先调用 Native Host', source.indexOf('saveStarlingCredentials') < source.indexOf('chrome.storage.local.set'));
assert('凭证随 listProjects 转发', payload.access_key === 'test-ak' && payload.secret_key === 'test-sk');
```

- [x] **Step 2: 运行测试并确认 AK/SK UI 和 API 尚不存在**

Run: `node test/options-credentials.test.js && node test/starling-tm-batch.test.js`

Expected: 新断言失败，既有断言仍能执行。

- [x] **Step 3: 实现 Settings 凭证卡并移除 Settings 的 vendor/project 日常选择**

Settings 加载顺序为 Chrome 副本优先、Chrome 为空时从 Host 导入；保存时先写 Host 并调用 `listProjects` 验证，成功后写 Chrome，Host 不可用时写 Chrome 并标记 `saved_locally_not_activated`。General Save 不再要求 vendor，也不再修改 `starlingProjectIds`。

```javascript
export async function saveStarlingCredentials(opts) {
  return sendNative({
    action: 'save_starling_credentials',
    access_key: opts.accessKey,
    secret_key: opts.secretKey,
    cli_path: opts.cliPath,
  });
}
```

- [x] **Step 4: 运行 Settings/API 测试和敏感文本扫描**

Run: `node test/options-credentials.test.js && node test/starling-tm-batch.test.js && if rg -n "console\\.(log|error).*starling(AccessKey|SecretKey)|_log\\(.*secret" options.js lib/starling-tm.js native-host; then exit 1; fi`

Expected: 测试通过，扫描无命中。

### Task 3: 项目模型、target locale 与 local rate 建议

**Files:**
- Create: `lib/run-config.js`
- Create: `test/run-config.test.js`
- Modify: `native-host/starling-bridge.py`
- Modify: `scripts/export_local_rates.py`
- Modify: `data/local-rates.json`
- Modify: `lib/pricing-rules.js`
- Modify: `test/test_export_local_rates.py`
- Modify: `test/pricing-rules.test.js`

**Interfaces:**
- Consumes: Starling `{id,name,sourceLocale,targetLocales}`、当前 selected IDs、target locale 和 vendor。
- Produces: `normalizeProject()`、`targetLocaleIntersection()`、`toggleProjectSelection()`、`validateRunConfig()`、`availableWordRateVendors()`；rate JSON 每行增加 canonical `source_locale`/`target_locale`。

- [x] **Step 1: 写失败测试覆盖真实项目 schema、十项目上限、source/target 交集和 vendor 建议**

```javascript
const project = normalizeProject({ id: 513, name: 'live_client', sourceLocale: 'en', targetLocales: ['ja-JP', 'zh-Hans'] });
assert('保留真实 locale', project.sourceLocale === 'en' && project.targetLocales.length === 2);
assert('target 取交集', JSON.stringify(targetLocaleIntersection([a, b])) === JSON.stringify(['zh-Hans']));
assert('零项目不可运行', validateRunConfig({ vendor: 'Pactera', projectIds: [], targetLocale: '' }).reason === 'project_required');
assert('RWS en→zh-Hans 建议 Pactera', availableWordRateVendors(catalog, { sourceLang: 'en', targetLang: 'zh-Hans' }).includes('Pactera'));
```

- [x] **Step 2: 运行测试并确认 run-config 与 canonical locale 尚不存在**

Run: `node test/run-config.test.js && node test/pricing-rules.test.js && python3 -m unittest test/test_export_local_rates.py -v`

Expected: 新模块/字段断言失败。

- [x] **Step 3: 实现真实项目规范化与费率 locale 字段**

bridge 映射 `sourceLocale` 与 `targetLocales`；run-config 只接受相同 source 且 target 交集非空的多选。exporter 使用显式映射把工作簿语言名转换为 Starling locale，遇到未知语言名直接失败；resolver 改为 canonical locale 精确查找并能枚举其他可用 vendor。

- [x] **Step 4: 重新生成 local rate JSON 并运行模型/费率测试**

Run: `python3 scripts/export_local_rates.py --input '/Users/bytedance/Downloads/local rate 费用表.xlsx' --output data/local-rates.json && node test/run-config.test.js && node test/pricing-rules.test.js && python3 -m unittest test/test_export_local_rates.py -v`

Expected: 固定 SHA-256 不变，四 vendor 行数不变，项目与费率测试全部通过。

### Task 4: Popup 主 UI、配置门禁和折叠收纳

**Files:**
- Modify: `popup.html`
- Modify: `popup.css`
- Modify: `popup.js`
- Modify: `test/popup-fast-path.test.js`
- Create: `test/popup-run-config.test.js`
- Modify: `test/options-vendor-config.test.js`

**Interfaces:**
- Consumes: Chrome/Host 凭证、`listProjects()`、run-config 纯函数、rate catalog 和工作表自动检测。
- Produces: `initializeRunConfiguration()`、`loadAccessibleProjects()`、`selectProject()`、`renderRunConfiguration()`、`ensureWorkflowReady()` 与折叠 summary。

- [x] **Step 1: 写失败测试固定 Run configuration、Setup required、目标语言、项目卡和折叠结构**

```javascript
assert('主 UI 有 vendor', html.includes('id="run-vendor"'));
assert('主 UI 有 target locale', html.includes('id="run-target-locale"'));
assert('项目至少一个门禁', source.includes("reason === 'project_required'"));
assert('无凭证打开 Settings', source.includes('chrome.runtime.openOptionsPage'));
assert('doc title 位于 Other sources 内', otherSourcesBlock.includes('id="doc-title"'));
assert('Working spreadsheet 整块为 details', html.includes('<details id="working-sheet-details"'));
```

- [x] **Step 2: 运行测试并确认新 UI 尚不存在**

Run: `node test/popup-run-config.test.js && node test/options-vendor-config.test.js`

Expected: Popup 新结构断言失败，Settings 旧 vendor 断言提示需要迁移。

- [x] **Step 3: 实现自动项目加载、即时保存、门禁和明确费率状态**

Popup 启动时读取凭证并自动加载项目；vendor、项目、target 每次变化立即持久化。`ensureWorkflowReady()` 在 Sheet 读取和 DOM 抓取前运行：Host/凭证缺失打开 Setup required，vendor/project/target 缺失展开 Run configuration；不再用默认项目继续。

工作表 `<details>` 可用时默认关闭并显示 `✓ Sheet <short> ready`，无表或无权限时自动打开；`Other sources` 内含 doc title，主页面不再常驻 `No Feishu doc detected`。

- [x] **Step 4: 运行 Popup 测试与全量 JavaScript 回归**

Run: `node test/popup-run-config.test.js && for f in test/*.test.js; do node "$f"; done`

Expected: 新 UI 测试通过，所有既有 JS 测试退出码为 0。

### Task 5: 文档与端到端验证

**Files:**
- Modify: `README.md`
- Modify: `SETUP-GUIDE.md`
- Modify: `docs/popup-configuration.md`
- Create: `temp/test_popup_configuration/verification.txt`

**Interfaces:**
- Consumes: 完整实现、真实权限项目接口、local rate snapshot 和所有测试。
- Produces: 无 Terminal 的设置说明、明确的双存储安全边界和可审计验证记录。

- [x] **Step 1: 增量更新文档并删除“AK/SK 只能在 Terminal 配置”的当前说明**

README 快速参考必须包含 Settings `Save & Verify`、Popup vendor/project/target 选择和折叠区说明；Setup Guide 同时保留 Native Host/CLI 安装前置条件与 Settings 配置路径。

- [x] **Step 2: 运行全量测试、语法、快照和敏感值扫描**

Run: `for f in test/*.test.js; do node "$f"; done`

Run: `python3 -m unittest test/test_export_local_rates.py test/starling-credentials-test.py -v && python3 test/batch-tm-test.py`

Run: `PYTHONPYCACHEPREFIX=temp/test_popup_configuration/pycache python3 -m py_compile native-host/starling-bridge.py scripts/export_local_rates.py`

Run: `if rg -n "test-sk|starlingSecretKey.*console|secret_key.*_log" temp/test_popup_configuration /tmp/l10n-bridge-debug.log; then exit 1; else echo sensitive_scan=PASS; fi`

Expected: 所有测试、编译和快照审计通过；日志与验证输出不含凭证明文。

- [x] **Step 3: 人工检查 Settings/Popup 源码结构和验证输出**

检查完整回填、默认 password、两个 reveal button、Popup 自动项目列表、target 交集、至少一个项目门禁、明确费率建议、Other sources 折叠和 Working spreadsheet 折叠；验证文件不得只记录退出码，必须包含各套件通过摘要。
