# Vendor Local Rate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为插件增加四选一 vendor 配置，并从 `local rate 费用表.xlsx` 生成唯一、可审计、严格匹配的按字费率数据。

**Architecture:** 构建期 Python 脚本把工作簿转换为带 SHA-256 和单元格来源的静态 JSON；浏览器运行期的纯 JavaScript resolver 只按 vendor 和明确的语言键查找。Settings 负责保存 vendor 并展示当前语言对的费率状态，核心 TM 流程不因 ROI 尚未运行而改变。

**Tech Stack:** Chrome Extension Manifest V3、ES modules、Node.js 脚本式测试、Python 3 `openpyxl`、JSON。

## Global Constraints

- 费率唯一来源是 `/Users/bytedance/Downloads/local rate 费用表.xlsx`，不得使用结算单反推或派生单价。
- vendor 仅允许 `RWS`、`Pactera`、`Alconost`、`Skrivanek`，ROI 运行前必须选择。
- 只做精确语言对映射；禁止跨 vendor 借价、默认费率、模糊匹配和 TEP 比例推导。
- RWS 使用原表 `AI翻译+人工校准AIPE rate` 与 `人工翻译 Human Translation rate`；Pactera 使用 `AIPE rate` 与 `T rate`。
- Alconost、Skrivanek 缺少按字费率时返回 `incomplete: missing_word_rate`，不得返回 0。
- 本计划只接入费率基础设施；没有 Starling/Elasticsearch 真实字数输入时不得计算金额。
- 新增 Python 文件必须有模块、函数 docstring；新增 JavaScript 导出函数必须有 JSDoc。
- 测试输出存放在 `temp/test_vendor_local_rate/`，并人工检查内容与预期一致。

---

### Task 1: 确定性导出本地费率表

**Files:**
- Create: `scripts/export_local_rates.py`
- Create: `data/local-rates.json`
- Create: `test/test_export_local_rates.py`

**Interfaces:**
- Consumes: `export_catalog(input_path: Path) -> dict[str, object]`
- Produces: schema v1 JSON，顶层字段为 `schema_version`、`source`、`vendors`；每条记录保留 `source_language`、`target_language`、费率和 `provenance`。

- [x] **Step 1: 写失败测试，固定四个 sheet、字段映射、缺失费率和确定性输出**

```python
class ExportLocalRatesTest(unittest.TestCase):
    def test_exports_vendor_word_rates_without_derivation(self) -> None:
        catalog = export_catalog(self.fixture_path)
        self.assertEqual(set(catalog["vendors"]), {"RWS", "Pactera", "Alconost", "Skrivanek"})
        self.assertEqual(catalog["vendors"]["RWS"][0]["aipe_usd_per_1000_words"], 74)
        self.assertEqual(catalog["vendors"]["RWS"][0]["t_only_usd_per_1000_words"], 92)
        self.assertNotIn("t_only_usd_per_1000_words", catalog["vendors"]["Alconost"][0])
        self.assertEqual(catalog, export_catalog(self.fixture_path))
```

- [x] **Step 2: 运行单测并确认因导出模块不存在而失败**

Run: `python3 -m unittest test/test_export_local_rates.py -v`

Expected: `ModuleNotFoundError` 或 `ImportError`，且退出码非 0。

- [x] **Step 3: 实现严格表头校验、数值解析、SHA-256 和 provenance**

```python
WORD_RATE_COLUMNS = {
    "RWS": {"t_only": "人工翻译\nHuman Translation rate", "aipe": "AI翻译+人工校准AIPE rate"},
    "Pactera": {"t_only": "T rate", "aipe": "AIPE rate"},
}

def export_catalog(input_path: Path) -> dict[str, object]:
    """把已冻结的 local rate workbook 转换为无时间戳的确定性目录。"""
    workbook = load_workbook(input_path, data_only=True, read_only=False)
    return {
        "schema_version": 1,
        "source": {"filename": input_path.name, "sha256": sha256_file(input_path)},
        "vendors": {vendor: export_vendor_sheet(workbook[vendor], vendor) for vendor in VENDORS},
    }
```

- [x] **Step 4: 运行测试并生成正式 JSON**

Run: `python3 -m unittest test/test_export_local_rates.py -v`

Expected: 所有 exporter 测试 `OK`。

Run: `python3 scripts/export_local_rates.py --input '/Users/bytedance/Downloads/local rate 费用表.xlsx' --output data/local-rates.json`

Expected: 输出 SHA-256 `99c95ce39300b86d755e99838cd7348512f56c5f7857827d0df8673072b478ef`，vendor 数据行数依次为 35、23、56、56。

### Task 2: 实现严格费率 resolver

**Files:**
- Create: `lib/pricing-rules.js`
- Create: `test/pricing-rules.test.js`

**Interfaces:**
- Consumes: `resolveWordRate(catalog, { vendor, sourceLang, targetLang })`
- Produces: 成功时 `{status: 'ready', vendor, sourceLanguage, targetLanguage, aipeUsdPerWord, tOnlyUsdPerWord, provenance}`；失败时 `{status: 'incomplete', reason}`。

- [x] **Step 1: 写失败测试覆盖成功、四 vendor、精确语言映射及三类失败**

```javascript
assert('RWS 精确命中', resolveWordRate(catalog, {
  vendor: 'RWS', sourceLang: 'en', targetLang: 'ro',
}).status === 'ready');
assert('Pactera zh 映射到 Chinese S', resolveWordRate(catalog, {
  vendor: 'Pactera', sourceLang: 'en', targetLang: 'zh',
}).targetLanguage === 'Chinese S');
assert('Alconost 明确缺少按字费率', resolveWordRate(catalog, {
  vendor: 'Alconost', sourceLang: 'en', targetLang: 'zh',
}).reason === 'missing_word_rate');
assert('不跨 vendor 回退', resolveWordRate(catalog, {
  vendor: 'RWS', sourceLang: 'en', targetLang: 'zh',
}).reason === 'missing_language_pair');
```

- [x] **Step 2: 运行单测并确认 resolver 尚不存在**

Run: `node test/pricing-rules.test.js`

Expected: import 或导出函数失败，退出码非 0。

- [x] **Step 3: 实现 allowlist、vendor 专属语言键和结构化失败**

```javascript
export const VENDORS = Object.freeze(['RWS', 'Pactera', 'Alconost', 'Skrivanek']);

export function resolveWordRate(catalog, selection) {
  const vendorRows = catalog?.vendors?.[selection.vendor];
  if (!VENDORS.includes(selection.vendor)) return incomplete('invalid_vendor');
  const key = workbookLanguageKey(selection.vendor, selection.sourceLang, selection.targetLang);
  const row = vendorRows.find((item) => item.source_language === key.source
    && item.target_language === key.target);
  if (!row) return incomplete('missing_language_pair');
  if (!Number.isFinite(row.aipe_usd_per_1000_words)
      || !Number.isFinite(row.t_only_usd_per_1000_words)) return incomplete('missing_word_rate');
  return readyRate(row, selection.vendor);
}
```

- [x] **Step 4: 运行 resolver 测试并人工检查数值没有 TEP×75% 派生痕迹**

Run: `node test/pricing-rules.test.js`

Expected: 全部断言通过，RWS/Pactera 的 per-word 值严格等于原表 per-1000 值除以 1000。

### Task 3: Settings 增加必选 vendor 与费率状态

**Files:**
- Modify: `options.html`
- Modify: `options.js`
- Modify: `options.css`
- Modify: `popup.js`
- Create: `test/options-vendor-config.test.js`

**Interfaces:**
- Consumes: `chrome.storage.local.vendor`、`loadRateCatalog()`、`resolveWordRate()`。
- Produces: Settings 四选一下拉框和 `#pricing-status`；popup 配置可读取 vendor，暂不计算金额。

- [x] **Step 1: 写失败测试固定四个 option、storage key 和状态文案**

```javascript
assert('vendor 有空占位符', optionsHtml.includes('value=""'));
for (const vendor of ['RWS', 'Pactera', 'Alconost', 'Skrivanek']) {
  assert(`包含 ${vendor}`, optionsHtml.includes(`value="${vendor}"`));
}
assert('vendor 持久化', optionsJs.includes("'vendor'"));
assert('设置页使用严格 resolver', optionsJs.includes('resolveWordRate'));
assert('popup 读取 vendor', popupJs.includes("'vendor'"));
```

- [x] **Step 2: 运行测试并确认 UI 尚未包含 vendor**

Run: `node test/options-vendor-config.test.js`

Expected: 至少 vendor option 和 storage key 断言失败。

- [x] **Step 3: 实现 ROI Billing 设置卡片、目录加载、保存校验和状态刷新**

```html
<label>Vendor (required for ROI billing)
  <select id="vendor" required>
    <option value="">Select a vendor</option>
    <option value="RWS">RWS</option>
    <option value="Pactera">Pactera</option>
    <option value="Alconost">Alconost</option>
    <option value="Skrivanek">Skrivanek</option>
  </select>
</label>
<p id="pricing-status" class="test-result"></p>
```

```javascript
async function refreshPricingStatus() {
  const result = resolveWordRate(rateCatalog, {
    vendor: document.getElementById('vendor').value,
    sourceLang: document.getElementById('sourceLang').value,
    targetLang: document.getElementById('targetLang').value,
  });
  renderPricingStatus(result);
}
```

- [x] **Step 4: 运行 UI 测试和现有全量 JavaScript 回归**

Run: `node test/options-vendor-config.test.js`

Expected: 所有 vendor 配置断言通过。

Run: `for f in test/*.test.js; do node "$f"; done`

Expected: 所有脚本退出码为 0，现有 TM、飞书和 AI 流程无回归。

### Task 4: 文档、快照审计与 CLI 端到端验证

**Files:**
- Modify: `README.md`
- Modify: `handoff/HANDOFF-2026-07-13-roi-measurement.md`
- Create: `temp/test_vendor_local_rate/verification.txt`

**Interfaces:**
- Consumes: 已生成 JSON、resolver、Settings 源码和完整测试套件。
- Produces: 可复现导出命令、结构审计结果和第一阶段完成边界。

- [x] **Step 1: 在 README 快速 CLI 参考中加入费率刷新和验证命令**

```bash
python3 scripts/export_local_rates.py \
  --input '/Users/bytedance/Downloads/local rate 费用表.xlsx' \
  --output data/local-rates.json
python3 -m unittest test/test_export_local_rates.py -v
node test/pricing-rules.test.js
```

- [x] **Step 2: 执行真实工作簿到 resolver 的端到端验证并保存输出**

Run: `mkdir -p temp/test_vendor_local_rate && { python3 scripts/export_local_rates.py --input '/Users/bytedance/Downloads/local rate 费用表.xlsx' --output data/local-rates.json; python3 -m unittest test/test_export_local_rates.py -v; node test/pricing-rules.test.js; node test/options-vendor-config.test.js; } > temp/test_vendor_local_rate/verification.txt 2>&1`

Expected: 文件包含固定 SHA-256、RWS/Pactera `ready`、Alconost/Skrivanek `missing_word_rate` 和所有测试通过摘要。

- [x] **Step 3: 人工检查生成快照和验证输出**

Run: `sed -n '1,220p' temp/test_vendor_local_rate/verification.txt && python3 -m json.tool data/local-rates.json >/dev/null`

Expected: JSON 合法；四个 vendor 均存在；输出无 `FAIL`、Traceback、NaN、默认费率或派生费率提示。

- [x] **Step 4: 运行最终全量验证**

Run: `for f in test/*.test.js; do node "$f"; done && python3 -m unittest test/test_export_local_rates.py -v && PYTHONPYCACHEPREFIX=temp/test_vendor_local_rate/pycache python3 -m py_compile scripts/export_local_rates.py native-host/starling-bridge.py && git diff --check`

Expected: 所有命令退出码为 0；文档明确第一阶段尚未计算金额，后续仍依赖 Starling/Elasticsearch 真实字数契约。
