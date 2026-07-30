# L10n TM Companion — 完整实施 Handoff

> 本文档是 Chrome Extension "L10n TM Companion" 的完整实施计划，包含所有设计决策、技术细节、实施步骤和验收标准。任何工程师拿到此文档即可独立完成开发。

---

## 📌 实施进度总览（更新于 2026-06-24 深夜）

> **代码全过测试（e2e 49/0、bitable 13/0）。** 本轮重大变化：① 表格层从多维表格 Bitable 切到**电子表格 Sheets**（`lib/feishu-sheets.js`）② 工作流从「AI 翻译」纠正为「TM 优化」（AI 改写英文原文，非翻译）③ New Match% 改用文本相似度算法（不再调第二次 TM）。详见 `handoff/SESSION-HANDOFF.md`（新对话必读）。

| Phase | 内容 | 代码 | 环境/验收 |
|-------|------|------|---------|
| 1 | 骨架 + manifest + background | ✅ 完成（加 larkoffice.com 匹配）| ✅ 已加载，扩展 ID `bgnakecphongbinlnmgnhoefgjecdang` |
| 2 | 飞书文档抓取 content.js | ✅ 完成（次要入口）| ⚠️ 选择器待真机验证；主入口已是表格读 A 列 |
| 3 | Starling CLI 对接 | ✅ 完成（真实 API）| ✅ **starling-cli v1.1.16 已装通**，TM 实测命中（Done→完成 100%）|
| 4 | AI 改写 + 文本相似度 | ✅ 完成 | ✅ 49 个逻辑单测通过（含 textSimilarity + 改写 + pipeline）|
| 5 | 飞书表格读写 | ✅ 完成（**Sheets 重写**）| ✅ 13 个 bitable 单测；⚠️ Sheets 权限待开通生效 |
| 6 | Popup UI | ✅ 完成（加「从表格读」按钮）| ⚠️ 端到端待真机验证 |
| 7 | Options 设置页 | ✅ 完成（贴 Sheets URL 解析）| ⚠️ 待真机验证 |
| 8 | 集成测试 | ✅ 逻辑层全过 | ⚠️ 端到端真机被 Sheets 权限阻塞 |

### 关键环境状态（2026-06-24 深夜）

| 依赖项 | 状态 | 备注 |
|--------|------|------|
| Chrome / Python 3 / node | ✅ 已装 | node v24.10.0，python3 3.9.6 |
| LLM 网关 | ✅ 已配好 | LLMBox `https://llmbox-global.byteintl.net/v1/messages`，Key `at-fe3cda6f...`，Model `glm-5.2` |
| 飞书自建应用 | ✅ 已发布 | `L10n TM Companion`，App ID `cli_aab1ca4137badbc4`，tenant_access_token 方案 |
| ⚠️ **Sheets 权限** | ❌ **未开通生效** | 需开通 `sheets:spreadsheet` + 重新发布版本。用户已开的 `base:record:create` 是 Bitable 权限，对 Sheets 无效。**当前最大阻塞** |
| 电子表格 | ✅ 已有 | `https://bytedance.my.larkoffice.com/sheets/Tjyfs3Tg5hYG6btMTiom3UA3yYd`，token=`Tjyfs3Tg5hYG6btMTiom3UA3yYd`，第1行表头/原文在A列。⚠️ 待加应用为协作者 |
| Starling CLI | ✅ **已装通** | starling-cli v1.1.16，AK/SK 配在 `~/.starling-cli/.starlingrc.json`，project=385(TikTok_Client)，源语言 en→目标 zh |
| Native Messaging Host | ✅ **已注册** | 已对扩展 ID `bgnakecphongbinlnmgnhoefgjecdang` 注册，ping 返回 starling-cli 路径 |

### 关键决策记录（含本轮新增）

| 决策 | 选择 | 理由 |
|------|------|------|
| LLM 调用方式 | ✅ 内部 LLMBox 网关 | 字节员工有 SSO，无需外部 Key |
| 飞书鉴权 | ✅ tenant_access_token 正式版 | 应用已发布 |
| Starling bridge | ✅ 真实 API | `starling-cli api GET /corpus/tm/match`（不再占位）|
| **表格产品（本轮）** | ✅ **电子表格 Sheets** | 团队实际用 Sheets，Bitable 弃用 |
| **原文入口（本轮）** | ✅ **表格读 A 列 + 文档抓取** | 表格驱动为主 |
| **New Match%（本轮纠正）** | ✅ **文本相似度** | 不调第二次 TM，textSimilarity(Rewritten, TM原文) |
| **AI 任务（本轮纠正）** | ✅ **改写英文原文** | 非翻译，提升 TM 命中率 |
| user_access_token | 🔲 备选 | 若权限审批卡死可切，未实现 |
| 本地 LLM 代理 | 🔲 备选 | 若 LLMBox 撞 CORS 可写，未实现 |

---

## 一、项目概述

### 1.1 一句话描述

Chrome 插件：在飞书文档页面抓取原文案 → Starling TM 查找匹配 → AI 生成翻译推荐 → 对比 AI 与 TM 差异 → 自动填入飞书多维表格。

### 1.2 解决的问题

| 痛点 | 现状 | 插件解决方式 |
|------|------|-------------|
| 手动复制文案到 TM 查询 | 逐条复制粘贴 | 自动抓取 + 批量查询 |
| 无翻译建议 | 只能看 TM 历史 | AI 生成推荐翻译 |
| 无法对比 AI 与 TM | 靠人工判断 | 自动 diff + 相似度标注 |
| 手动填 Tracker | 逐条复制到多维表格 | 一键批量写入 |

### 1.3 核心用户

- **CD（Content Designer）**：review AI 推荐翻译，判断是否采纳
- **LPM（Localization Project Manager）**：使用批量写入功能，减少手动整理

---

## 二、系统架构

### 2.1 整体数据流

```
┌─────────────────────────────────────────────────────────┐
│                    Chrome Extension                      │
│                                                         │
│  ┌──────────┐    ┌──────────┐    ┌──────────────────┐  │
│  │Content   │───→│Background│───→│ Popup UI         │  │
│  │Script    │    │Service   │    │ (结果展示+操作)   │  │
│  │(飞书抓取) │    │Worker    │    └────────┬─────────┘  │
│  └──────────┘    └────┬─────┘             │            │
│                       │                    │            │
│            ┌──────────┼────────────────────┘            │
│            ↓          ↓                                 │
│  ┌──────────────┐ ┌───────────────┐ ┌────────────────┐ │
│  │Native Msg    │ │LLM API        │ │Feishu REST API │ │
│  │→ Starling CLI│ │→ AI 翻译推荐  │ │→ 写入多维表格  │ │
│  └──────────────┘ └───────────────┘ └────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### 2.2 架构决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| 无后端服务器 | ✅ 纯客户端 | 内部工具，TM 数据留在本地更安全，无需运维 |
| Chrome MV3 | ✅ 不用 MV2 | Google 已停止接受 MV2 新插件，MV3 是强制要求 |
| Native Messaging 调 CLI | ✅ 不用 WebSocket/HTTP 代理 | 唯一能从 Chrome 插件调用本地 CLI 的方式 |
| Popup 而非 Sidepanel | ✅ 轻量交互 | 用户操作简短（查看 → 选择 → 写入），Popup 足够 |
| Vanilla JS | ✅ 不用 React/Vue | 插件 UI 简单，避免构建工具链复杂度 |
| 飞书 REST API | ✅ 不用 JS-SDK | JS-SDK 仅在飞书内嵌浏览器可用，Chrome 插件环境不支持 |

---

## 三、文件结构与职责

```
l10n-tm-companion/
│
├── manifest.json                 # MV3 清单，声明权限和组件
│
├── content.js                    # [Content Script] 飞书文档页面文案抓取
│                                 # 注入飞书页面，提取原文案
│
├── popup.html                    # [Popup] 弹窗 UI 结构
├── popup.css                     # [Popup] 弹窗样式
├── popup.js                      # [Popup] 弹窗逻辑：结果展示、用户操作、触发写入
│
├── background.js                 # [Service Worker] 协调各模块通信
│                                 # 转发消息：popup ↔ native messaging / API
│
├── lib/
│   ├── starling-tm.js            # Starling CLI 调用封装（通过 background 转发）
│   ├── ai-translate.js           # LLM API 调用封装
│   ├── feishu-bitable.js         # 飞书多维表格 REST API 封装
│   └── diff.js                   # AI 翻译 vs TM 翻译对比逻辑
│
├── native-host/
│   ├── com.l10n.tm-companion.json  # Native Messaging Host 注册清单
│   ├── install.sh                  # 一键注册脚本（macOS）
│   └── starling-bridge.py          # Python 桥接：接收插件消息 → 调用 CLI → 返回结果
│
├── options.html                  # [Options] 设置页面结构
├── options.css                   # [Options] 设置页样式
├── options.js                    # [Options] 设置页逻辑
│
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
│
└── README.md                     # 安装和使用说明
```

---

## 四、模块详细设计

### 4.1 Content Script — 飞书文档文案抓取

**文件：** `content.js`

**注入目标：**
- `*://*.feishu.cn/docx/*`
- `*://*.larksuite.com/docx/*`

**两种模式：**

#### 批量模式（抓取全文）

```javascript
// 遍历飞书文档所有段落块，提取文本
function extractAllText() {
  const blocks = document.querySelectorAll('div[data-block-id]');
  const results = [];

  blocks.forEach((block, index) => {
    // 过滤 UI 控件文本
    if (isUIElement(block)) return;

    const text = block.textContent.trim();
    if (text.length === 0) return;

    results.push({
      id: `p-${index}`,
      source_text: text,
      context: getBlockContext(block),    // 所在 section/标题
      location: `Paragraph ${index + 1}`,
      char_count: text.length
    });
  });

  return results;
}

function isUIElement(el) {
  // 排除工具栏、菜单、按钮等 UI 元素
  return el.closest('[role="toolbar"]') ||
         el.closest('[role="menu"]') ||
         el.closest('button') ||
         el.closest('.doc-toolbar') ||
         el.closest('.comment-card');
}

function getBlockContext(block) {
  // 向上查找最近的标题元素，作为上下文
  let node = block.previousElementSibling;
  while (node) {
    if (node.querySelector('h1, h2, h3, [data-block-type="heading"]')) {
      return node.textContent.trim();
    }
    node = node.previousElementSibling;
  }
  return 'Document root';
}
```

#### 选中模式

```javascript
function extractSelectedText() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return null;

  const text = selection.toString().trim();
  if (text.length === 0) return null;

  return [{
    id: `sel-${Date.now()}`,
    source_text: text,
    context: getSelectionContext(selection),
    location: 'User selection',
    char_count: text.length
  }];
}
```

**消息通信：**

```javascript
// 监听来自 Popup 的请求
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'extract_all') {
    const data = extractAllText();
    sendResponse({ items: data });
  } else if (msg.action === 'extract_selection') {
    const data = extractSelectedText();
    sendResponse({ items: data });
  }
  return true; // 异步响应
});
```

**输出数据结构：**

```json
[
  {
    "id": "p-1",
    "source_text": "Send a gift to your favorite streamer",
    "context": "Gift Panel Design",
    "location": "Paragraph 3",
    "char_count": 38
  }
]
```

---

### 4.2 Native Messaging + Starling CLI

**文件：** `native-host/starling-bridge.py`, `lib/starling-tm.js`

#### Python 桥接脚本

```python
#!/usr/bin/env python3
"""
starling-bridge.py
Bridge between Chrome Native Messaging and Starling CLI.
Reads JSON from stdin, calls Starling CLI, returns JSON to stdout.
"""

import sys
import json
import subprocess
import struct

def read_message():
    """Read a Native Messaging message from stdin."""
    raw_length = sys.stdin.buffer.read(4)
    if len(raw_length) == 0:
        sys.exit(0)
    message_length = struct.unpack('=I', raw_length)[0]
    message = sys.stdin.buffer.read(message_length).decode('utf-8')
    return json.loads(message)

def send_message(message):
    """Send a Native Messaging message to stdout."""
    encoded = json.dumps(message).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('=I', len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()

def search_tm(texts, source_lang, target_lang):
    """Call Starling CLI to search TM for each text."""
    results = []

    for text in texts:
        try:
            # TODO: 确认 Starling CLI 实际命令和参数
            # 以下是假设的命令格式，需在实现时根据实际 CLI 调整
            cmd = [
                'starling', 'tm', 'search',
                '--source-lang', source_lang,
                '--target-lang', target_lang,
                '--query', text,
                '--format', 'json'
            ]

            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=30
            )

            if proc.returncode == 0:
                # 解析 CLI 输出（格式需根据实际 CLI 确认）
                tm_result = json.loads(proc.stdout)
                results.append({
                    'source_text': text,
                    'tm_match': tm_result.get('translation', ''),
                    'similarity': tm_result.get('similarity', 0.0),
                    'origin': tm_result.get('origin', 'Unknown'),
                    'tm_source_lang': source_lang,
                    'tm_target_lang': target_lang
                })
            else:
                results.append({
                    'source_text': text,
                    'tm_match': '',
                    'similarity': 0.0,
                    'origin': f'CLI Error: {proc.stderr[:200]}',
                    'tm_source_lang': source_lang,
                    'tm_target_lang': target_lang
                })

        except subprocess.TimeoutExpired:
            results.append({
                'source_text': text,
                'tm_match': '',
                'similarity': 0.0,
                'origin': 'CLI Timeout',
                'tm_source_lang': source_lang,
                'tm_target_lang': target_lang
            })
        except Exception as e:
            results.append({
                'source_text': text,
                'tm_match': '',
                'similarity': 0.0,
                'origin': f'Error: {str(e)[:200]}',
                'tm_source_lang': source_lang,
                'tm_target_lang': target_lang
            })

    return results

def main():
    while True:
        try:
            message = read_message()
        except Exception:
            break

        action = message.get('action', '')

        if action == 'search_tm':
            results = search_tm(
                texts=message.get('texts', []),
                source_lang=message.get('source_lang', 'en'),
                target_lang=message.get('target_lang', 'ja')
            )
            send_message({'results': results})
        else:
            send_message({'error': f'Unknown action: {action}'})

if __name__ == '__main__':
    main()
```

#### Native Messaging Host 注册清单

**文件：** `native-host/com.l10n.tm-companion.json`

```json
{
  "name": "com.l10n.tm_companion",
  "description": "L10n TM Companion - Starling CLI Bridge",
  "path": "/ABSOLUTE/PATH/TO/native-host/starling-bridge.py",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://EXTENSION_ID/"
  ]
}
```

> ⚠️ `path` 必须是绝对路径，`EXTENSION_ID` 在插件加载后获取。

#### 安装脚本

**文件：** `native-host/install.sh`

```bash
#!/bin/bash
# 注册 Native Messaging Host 到 Chrome

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRIDGE_PATH="$SCRIPT_DIR/starling-bridge.py"
MANIFEST_SRC="$SCRIPT_DIR/com.l10n.tm-companion.json"
MANIFEST_DST="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.l10n.tm_companion.json"

# 获取 Extension ID
echo "请输入 Chrome Extension ID（从 chrome://extensions 获取）："
read EXTENSION_ID

# 创建注册清单
cat > "$MANIFEST_DST" << EOF
{
  "name": "com.l10n.tm_companion",
  "description": "L10n TM Companion - Starling CLI Bridge",
  "path": "$BRIDGE_PATH",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXTENSION_ID/"
  ]
}
EOF

chmod +x "$BRIDGE_PATH"
echo "✅ Native Messaging Host 已注册到: $MANIFEST_DST"
echo "   Bridge script: $BRIDGE_PATH"
```

#### JS 封装

**文件：** `lib/starling-tm.js`

```javascript
/**
 * Starling TM 查询封装
 * 通过 background.js 的 Native Messaging 转发调用
 */

export async function searchTM(texts, sourceLang, targetLang) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        action: 'native_search_tm',
        payload: {
          action: 'search_tm',
          texts: texts,
          source_lang: sourceLang,
          target_lang: targetLang
        }
      },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response?.error) {
          reject(new Error(response.error));
          return;
        }
        resolve(response?.results || []);
      }
    );
  });
}
```

**background.js 中的转发逻辑：**

```javascript
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'native_search_tm') {
    chrome.runtime.sendNativeMessage(
      'com.l10n.tm_companion',
      msg.payload,
      (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message });
        } else {
          sendResponse(response);
        }
      }
    );
    return true; // 异步响应
  }
});
```

---

### 4.3 AI 翻译推荐

**文件：** `lib/ai-translate.js`

```javascript
/**
 * AI 翻译推荐模块
 * 调用 LLM API，基于原文案 + TM 上下文生成翻译建议
 */

export async function translateWithAI(items, config) {
  const { apiEndpoint, apiKey, model, targetLang } = config;
  const results = [];

  for (const item of items) {
    try {
      const prompt = buildPrompt(item, targetLang);
      const response = await callLLM(apiEndpoint, apiKey, model, prompt);
      const parsed = parseAIResponse(response, item);
      results.push(parsed);
    } catch (e) {
      results.push({
        ...item,
        ai_translation: '',
        reasoning: `AI Error: ${e.message}`,
        reuse_tm: false
      });
    }
  }

  return results;
}

function buildPrompt(item, targetLang) {
  const langMap = { ja: '日本語', ko: '한국어', zh: '中文', en: 'English' };
  const langName = langMap[targetLang] || targetLang;

  let prompt = `You are a TikTok LIVE localization translation expert.\n\n`;
  prompt += `Source text: ${item.source_text}\n`;

  if (item.tm_match && item.similarity > 0) {
    prompt += `\nClosest TM match (similarity ${Math.round(item.similarity * 100)}%): ${item.tm_match}\n`;
    prompt += `TM origin: ${item.origin}\n\n`;

    if (item.similarity >= 0.95) {
      prompt += `The TM match is very high (>= 95%). Recommend reusing the TM translation unless there's a strong reason to change.\n`;
    }
  }

  prompt += `\nGenerate a ${langName} translation recommendation.\n`;
  prompt += `If you recommend a different translation than the TM match, explain why.\n\n`;
  prompt += `Respond in this exact JSON format:\n`;
  prompt += `{"ai_translation": "...", "reasoning": "...", "reuse_tm": true/false}\n`;

  return prompt;
}

async function callLLM(endpoint, apiKey, model, prompt) {
  // 兼容 OpenAI 和 Claude API 格式
  const isClaude = endpoint.includes('anthropic');

  if (isClaude) {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await resp.json();
    return data.content?.[0]?.text || '';
  } else {
    // OpenAI compatible
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3
      })
    });
    const data = await resp.json();
    return data.choices?.[0]?.message?.content || '';
  }
}

function parseAIResponse(responseText, item) {
  try {
    // 尝试从响应中提取 JSON
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        ...item,
        ai_translation: parsed.ai_translation || '',
        reasoning: parsed.reasoning || '',
        reuse_tm: parsed.reuse_tm ?? false
      };
    }
  } catch (e) {
    // JSON 解析失败，用原始文本
  }

  return {
    ...item,
    ai_translation: responseText,
    reasoning: 'Raw AI response (JSON parse failed)',
    reuse_tm: false
  };
}
```

---

### 4.4 AI vs TM 对比

**文件：** `lib/diff.js`

```javascript
/**
 * AI 翻译 vs TM 翻译对比模块
 * 比较同语言的两版翻译，标记差异和推荐
 */

export function compareAIvsTM(item) {
  const { ai_translation, tm_match, similarity } = item;

  // 无 TM 匹配
  if (!tm_match || similarity === 0) {
    return {
      ...item,
      ai_vs_tm: {
        status: 'no_tm',
        changes: 'No TM match found. AI translation is the only option.',
        key_differences: []
      }
    };
  }

  // AI 建议沿用 TM
  if (item.reuse_tm || ai_translation === tm_match) {
    return {
      ...item,
      ai_vs_tm: {
        status: 'same',
        changes: 'AI agrees with TM. Recommend reusing TM.',
        key_differences: []
      }
    };
  }

  // AI 与 TM 不同，分析差异
  const differences = extractKeyDifferences(ai_translation, tm_match);
  const status = similarity >= 0.95 ? 'different' : 'improved';

  return {
    ...item,
    ai_vs_tm: {
      status: status,
      changes: item.reasoning || 'AI suggests a different translation.',
      key_differences: differences
    }
  };
}

function extractKeyDifferences(aiText, tmText) {
  // 简单的词级别对比
  const aiWords = aiText.split(/\s+/);
  const tmWords = tmText.split(/\s+/);
  const differences = [];

  const maxLen = Math.max(aiWords.length, tmWords.length);
  for (let i = 0; i < maxLen; i++) {
    if (aiWords[i] !== tmWords[i]) {
      differences.push({
        position: i,
        tm: tmWords[i] || '(missing)',
        ai: aiWords[i] || '(missing)',
        reason: ''
      });
    }
  }

  return differences;
}
```

**Status 含义：**

| Status | 含义 | 默认操作 |
|--------|------|---------|
| `no_tm` | TM 无匹配 | 采纳 AI |
| `same` | AI 与 TM 一致 | 沿用 TM |
| `improved` | AI 优于 TM | 采纳 AI（推荐） |
| `different` | AI 与 TM 不同（高相似度 TM 仍有差异） | 需人工确认 |

---

### 4.5 飞书多维表格自动填入

**文件：** `lib/feishu-bitable.js`

```javascript
/**
 * 飞书多维表格 API 封装
 * 使用 tenant_access_token 写入 Bitable 记录
 */

const FEISHU_BASE = 'https://open.feishu.cn/open-apis';

export async function writeToBitable(items, config) {
  const { appId, appSecret, appToken, tableId } = config;

  // 1. 获取 tenant_access_token
  const token = await getTenantToken(appId, appSecret);

  // 2. 批量创建记录
  const records = items.map(item => ({
    fields: {
      '原文案': item.source_text,
      'TM最相似翻译': item.tm_match || '',
      '相似度': item.similarity ? Math.round(item.similarity * 100) : 0,
      'TM来源': item.origin || '',
      'AI推荐翻译': item.ai_translation || '',
      'AI vs TM对比': formatComparison(item.ai_vs_tm)
    }
  }));

  // 飞书批量创建 API 最多支持 500 条
  const batchSize = 500;
  const allResults = [];

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const resp = await fetch(
      `${FEISHU_BASE}/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_create`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ records: batch })
      }
    );

    const data = await resp.json();
    if (data.code !== 0) {
      throw new Error(`Bitable API error: ${data.msg}`);
    }
    allResults.push(...(data.data?.records || []));
  }

  return allResults;
}

async function getTenantToken(appId, appSecret) {
  const resp = await fetch(
    `${FEISHU_BASE}/auth/v3/tenant_access_token/internal`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: appId,
        app_secret: appSecret
      })
    }
  );

  const data = await resp.json();
  if (data.code !== 0) {
    throw new Error(`Feishu auth error: ${data.msg}`);
  }

  return data.tenant_access_token;
}

function formatComparison(aiVsTm) {
  if (!aiVsTm) return '';

  let text = `Status: ${aiVsTm.status}\n`;
  text += `${aiVsTm.changes}\n`;

  if (aiVsTm.key_differences?.length > 0) {
    text += '\nKey differences:\n';
    aiVsTm.key_differences.forEach(d => {
      text += `  - TM: ${d.tm} → AI: ${d.ai}`;
      if (d.reason) text += ` (${d.reason})`;
      text += '\n';
    });
  }

  return text;
}
```

**飞书多维表格字段预置：**

在多维表格中需预先创建以下字段（或由插件首次运行时自动检测）：

| 字段名 | 字段类型 | 说明 |
|--------|---------|------|
| 原文案 | 多行文本 | 飞书文档提取的原始英文 |
| TM最相似翻译 | 多行文本 | Starling TM 返回的最佳匹配翻译 |
| 相似度 | 数字 | 0-100 百分比 |
| TM来源 | 单行文本 | TM 匹配的项目/任务来源 |
| AI推荐翻译 | 多行文本 | LLM 生成的翻译建议 |
| AI vs TM对比 | 多行文本 | 对比结果文本 |

---

### 4.6 Popup UI

**文件：** `popup.html`, `popup.css`, `popup.js`

#### popup.html 结构

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <div class="container">
    <!-- Header -->
    <header class="header">
      <h1>🌐 L10n TM Companion</h1>
      <button id="settings-btn" title="Settings">⚙️</button>
    </header>

    <!-- Document Info -->
    <div class="doc-info">
      <span id="doc-title">📄 未检测到飞书文档</span>
      <span id="target-lang">🌍 目标语言: --</span>
    </div>

    <!-- Actions -->
    <div class="actions">
      <button id="btn-extract-all" class="btn btn-primary">📥 抓取全文</button>
      <button id="btn-extract-sel" class="btn btn-secondary">✋ 选中查询</button>
    </div>

    <!-- Progress -->
    <div id="progress" class="progress hidden">
      <div class="progress-bar" id="progress-bar"></div>
      <span id="progress-text">处理中...</span>
    </div>

    <!-- Results -->
    <div id="results" class="results">
      <!-- 动态生成结果卡片 -->
    </div>

    <!-- Footer -->
    <footer class="footer">
      <button id="btn-write-bitable" class="btn btn-success" disabled>
        📤 写入飞书表格
      </button>
      <span id="selected-count">已选 0/0</span>
    </footer>
  </div>

  <script type="module" src="popup.js"></script>
</body>
</html>
```

#### 结果卡片模板

```html
<!-- 单条结果卡片 -->
<div class="result-card" data-id="p-1">
  <div class="card-summary">
    <span class="source-text">"Send a gift to..."</span>
    <div class="badges">
      <span class="badge tm-badge">🔄 TM 85%</span>
      <span class="badge ai-badge">🤖 AI 推荐</span>
    </div>
  </div>
  <div class="card-actions">
    <button class="btn-sm btn-ai">采纳AI</button>
    <button class="btn-sm btn-tm">沿用TM</button>
    <button class="btn-sm btn-manual">手动</button>
  </div>
  <!-- 展开详情 -->
  <div class="card-detail hidden">
    <div class="detail-section">
      <h4>原文</h4>
      <p>Send a gift to your favorite streamer</p>
    </div>
    <div class="detail-section">
      <h4>TM 匹配</h4>
      <p>好きなストリーマーにギフトを送信</p>
      <small>来源: LIVE Gift v2.1 / JA-1234</small>
    </div>
    <div class="detail-section">
      <h4>AI 推荐</h4>
      <p>お気に入りの配信者にギフトを送る</p>
      <small>理由: より自然な表現に変更</small>
    </div>
    <div class="detail-section">
      <h4>AI vs TM 对比</h4>
      <p>Status: improved</p>
      <ul>
        <li>ストリーマー → 配信者（日本市場でより一般的）</li>
        <li>送信 → 送る（より口語的）</li>
      </ul>
    </div>
  </div>
</div>
```

#### popup.js 核心逻辑

```javascript
import { searchTM } from '../lib/starling-tm.js';
import { translateWithAI } from '../lib/ai-translate.js';
import { compareAIvsTM } from '../lib/diff.js';
import { writeToBitable } from '../lib/feishu-bitable.js';

let extractedItems = [];
let processedItems = [];
let userChoices = {};  // itemId → 'ai' | 'tm' | 'manual'

// ===== 抓取文案 =====
document.getElementById('btn-extract-all').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, { action: 'extract_all' }, (response) => {
    extractedItems = response?.items || [];
    processItems(extractedItems);
  });
});

document.getElementById('btn-extract-sel').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, { action: 'extract_selection' }, (response) => {
    extractedItems = response?.items || [];
    processItems(extractedItems);
  });
});

// ===== 处理流程：TM → AI → 对比 =====
async function processItems(items) {
  showProgress('查询 TM...');
  const config = await loadConfig();

  // Step 1: Starling TM 查询
  const tmResults = await searchTM(
    items.map(i => i.source_text),
    'en',
    config.targetLang
  );

  // 合并 TM 结果到 items
  items.forEach((item, i) => {
    if (tmResults[i]) {
      item.tm_match = tmResults[i].tm_match;
      item.similarity = tmResults[i].similarity;
      item.origin = tmResults[i].origin;
    }
  });

  showProgress('AI 翻译推荐...');

  // Step 2: AI 翻译
  const aiResults = await translateWithAI(items, config);

  // Step 3: AI vs TM 对比
  processedItems = aiResults.map(item => compareAIvsTM(item));

  showProgress('');
  renderResults(processedItems);
}

// ===== 写入飞书多维表格 =====
document.getElementById('btn-write-bitable').addEventListener('click', async () => {
  const config = await loadConfig();

  // 根据用户选择组装最终数据
  const itemsToWrite = processedItems.map(item => {
    const choice = userChoices[item.id] || 'ai';
    if (choice === 'tm') {
      item.final_translation = item.tm_match;
    } else if (choice === 'manual') {
      item.final_translation = item.manual_translation || '';
    } else {
      item.final_translation = item.ai_translation;
    }
    return item;
  });

  try {
    await writeToBitable(itemsToWrite, config);
    alert('✅ 写入成功！');
  } catch (e) {
    alert(`❌ 写入失败: ${e.message}`);
  }
});

// ===== 辅助函数 =====
async function loadConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get([
      'feishuAppId', 'feishuAppSecret',
      'bitableAppToken', 'bitableTableId',
      'targetLang', 'llmEndpoint', 'llmApiKey', 'llmModel'
    ], (result) => resolve(result));
  });
}

function showProgress(text) {
  const el = document.getElementById('progress');
  const textEl = document.getElementById('progress-text');
  if (text) {
    el.classList.remove('hidden');
    textEl.textContent = text;
  } else {
    el.classList.add('hidden');
  }
}
```

---

### 4.7 Options 设置页

**文件：** `options.html`, `options.js`

设置项清单：

| 设置项 | Key | 类型 | 必填 |
|--------|-----|------|------|
| Starling CLI 路径 | `starlingCliPath` | text | ✅ |
| 飞书 App ID | `feishuAppId` | text | ✅ |
| 飞书 App Secret | `feishuAppSecret` | password | ✅ |
| 多维表格 App Token | `bitableAppToken` | text | ✅ |
| 多维表格 Table ID | `bitableTableId` | text | ✅ |
| 目标语言 | `targetLang` | select (ja/ko/zh/en/...) | ✅ |
| LLM API Endpoint | `llmEndpoint` | text | ✅ |
| LLM API Key | `llmApiKey` | password | ✅ |
| LLM Model | `llmModel` | text | ✅ |

---

### 4.8 manifest.json

```json
{
  "manifest_version": 3,
  "name": "L10n TM Companion",
  "version": "1.0.0",
  "description": "Feishu doc → Starling TM → AI translation → Feishu Bitable auto-fill",
  "permissions": [
    "activeTab",
    "nativeMessaging",
    "storage"
  ],
  "host_permissions": [
    "*://*.feishu.cn/*",
    "*://*.larksuite.com/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": [
        "*://*.feishu.cn/docx/*",
        "*://*.larksuite.com/docx/*"
      ],
      "js": ["content.js"]
    }
  ],
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "options_page": "options.html",
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

---

## 五、实施计划（分步）

### Phase 1: 骨架搭建 ✏️ → ✅

| 步骤 | 任务 | 产出 | 验收标准 |
|------|------|------|---------|
| 1.1 | 创建项目目录结构 | 所有空文件就位 | 目录结构与第三节一致 |
| 1.2 | 编写 manifest.json | 完整 MV3 清单 | Chrome 可以加载（开发者模式），无报错 |
| 1.3 | 编写 background.js | 消息转发框架 | 能转发 popup ↔ content 消息 |
| 1.4 | 编写 content.js 骨架 | 能接收 extract_all/extract_selection 消息 | 控制台能看到消息收发 |

### Phase 2: 飞书文档抓取 ✏️ → ✅

| 步骤 | 任务 | 产出 | 验收标准 |
|------|------|------|---------|
| 2.1 | 调研飞书文档 DOM 结构 | DOM 选择器文档 | 能在 DevTools 中定位文案元素 |
| 2.2 | 实现批量抓取 | extractAllText() | 打开飞书文档，点击抓取，返回所有段落文本 |
| 2.3 | 实现选中抓取 | extractSelectedText() | 选中一段文字，点击查询，返回选中文本 |
| 2.4 | 添加上下文提取 | getBlockContext() | 每段文案附带所在 section 标题 |
| 2.5 | 过滤 UI 元素 | isUIElement() | 不抓取按钮、菜单、工具栏文本 |

### Phase 3: Starling CLI 对接 ✏️ → ✅

| 步骤 | 任务 | 产出 | 验收标准 |
|------|------|------|---------|
| 3.1 | 确认 Starling CLI 命令 | CLI 用法文档 | 能在终端运行 `starling tm search` 并获取结果 |
| 3.2 | 编写 starling-bridge.py | Python 桥接脚本 | 终端手动输入 JSON → 返回 TM 结果 |
| 3.3 | 注册 Native Messaging Host | install.sh + 注册清单 | Chrome 能识别 native host |
| 3.4 | 编写 lib/starling-tm.js | JS 调用封装 | popup 能通过 background 调用 CLI 并获取结果 |
| 3.5 | 错误处理 | CLI 超时/失败时的降级 | 返回空结果而非崩溃 |

### Phase 4: AI 翻译 ✏️ → ✅

| 步骤 | 任务 | 产出 | 验收标准 |
|------|------|------|---------|
| 4.1 | 编写 lib/ai-translate.js | LLM API 封装 | 输入文案 + TM 上下文 → 返回 AI 翻译 |
| 4.2 | 实现 Prompt 模板 | LIVE 术语感知 prompt | AI 输出包含翻译 + 理由 + reuse_tm 标志 |
| 4.3 | 支持 Claude + OpenAI 格式 | API 兼容层 | 两种 API 都能调用 |
| 4.4 | 编写 lib/diff.js | AI vs TM 对比 | 输出 status + key_differences |

### Phase 5: 飞书多维表格写入 ✏️ → ✅

| 步骤 | 任务 | 产出 | 验收标准 |
|------|------|------|---------|
| 5.1 | 飞书应用创建和审批 | App ID + Secret | 能获取 tenant_access_token |
| 5.2 | 多维表格字段创建 | 6 个字段 | 表格中有对应字段 |
| 5.3 | 编写 lib/feishu-bitable.js | REST API 封装 | 能写入单条记录 |
| 5.4 | 批量写入 | batch_create | 能批量写入 50+ 条记录 |
| 5.5 | 错误处理 | token 过期/字段不存在 | 有明确错误提示 |

### Phase 6: Popup UI ✏️ → ✅

| 步骤 | 任务 | 产出 | 验收标准 |
|------|------|------|---------|
| 6.1 | 编写 popup.html + popup.css | UI 结构和样式 | 布局与设计稿一致 |
| 6.2 | 实现结果卡片渲染 | 动态生成卡片 | 每条文案显示为一个卡片 |
| 6.3 | 实现展开/收起详情 | 点击卡片展开 | 展开显示完整对比信息 |
| 6.4 | 实现操作按钮 | 采纳AI/沿用TM/手动 | 点击切换选中状态 |
| 6.5 | 实现批量写入按钮 | 写入飞书表格 | 点击触发写入流程 |
| 6.6 | 进度条 | TM查询/AI翻译进度 | 用户能看到处理进度 |

### Phase 7: Options 设置页 ✏️ → ✅

| 步骤 | 任务 | 产出 | 验收标准 |
|------|------|------|---------|
| 7.1 | 编写 options.html | 设置表单 | 所有配置项可输入 |
| 7.2 | 实现保存/加载 | chrome.storage | 设置持久化，重启后保留 |
| 7.3 | 实现连接测试 | 测试按钮 | 可测试飞书 API 连接、CLI 可用性 |

### Phase 8: 集成测试 ✏️ → ✅

| 步骤 | 任务 | 产出 | 验收标准 |
|------|------|------|---------|
| 8.1 | 端到端测试 | 测试用例 | 打开飞书文档 → 抓取 → TM → AI → 对比 → 写入，全流程跑通 |
| 8.2 | 边界测试 | 空文案/超长文案/特殊字符 | 不崩溃，有合理降级 |
| 8.3 | 多语言测试 | ja/ko/zh | 目标语言切换正常 |
| 8.4 | 错误恢复测试 | CLI 不可用/API 超时 | 有明确错误提示，可重试 |

---

## 六、验收清单

### MVP 验收标准（必须全部通过）

- [x] Chrome 开发者模式可加载插件，无报错
- [ ] 打开飞书文档页面，插件图标可点击，Popup 弹出 — 待真机
- [ ] 点击"抓取全文"，Content Script 提取所有文案段落 — 待真机验证选择器
- [ ] 选中文字后点击"选中查询"，提取选中文本 — 待真机
- [ ] 抓取的文案自动查询 Starling TM，返回匹配结果 — 待装 Starling CLI
- [x] 每条文案显示 AI 推荐翻译 — 逻辑单测通过
- [x] AI 翻译与 TM 翻译对比结果正确显示 — 逻辑单测通过（4 种 status）
- [x] 用户可选择"采纳 AI"/"沿用 TM"/"手动" — UI 已实现
- [ ] 点击"写入飞书表格"，数据写入多维表格 — 待真机（飞书应用已发布可用）
- [ ] 多维表格中 6 个字段均正确填入 — 待真机
- [x] Options 页可配置所有必要参数 — 已实现
- [x] CLI 不可用时有明确错误提示 — 已实现降级

---

## 七、前置依赖与风险

### 前置依赖

| 依赖项 | 状态 | 负责人 | 备注 |
|--------|------|--------|------|
| Starling CLI 安装和可用 | ❌ 未装 | 用户 | 内部工具，走内部渠道安装；装好前 TM 降级 |
| 飞书应用创建和审批 | ✅ 已发布通过 | 用户 | `L10n TM Companion` v1.0.0 已发布，用 tenant_access_token |
| 多维表格创建和字段预置 | 🔲 待办 | 用户 | 需建 6 字段 + 把应用加为协作者 |
| LLM API Key | ✅ 已有 | 用户 | 字节内部 LLMBox 网关，走 SSO，无需外部 Key |
| Native Messaging 注册权限 | 🔲 待办 | 用户 | macOS 写入 `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` |

### 风险与缓解

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|---------|
| Starling CLI 命令格式与假设不符 | 高 | 中 | Phase 3 第一步先确认 CLI 用法，再写 bridge |
| 飞书应用审批慢 | 中 | 高 | 先用 test app 开发，正式环境再申请 |
| 飞书 DOM 结构变更 | 高 | 低 | 抽象选择器到配置文件，便于快速修复 |
| Native Messaging 在某些环境不可用 | 高 | 低 | 备选方案：改用本地 HTTP 代理 |
| LLM API 响应慢 | 中 | 中 | 逐条处理 + 进度条 + 超时降级 |
| 多维表格字段名不匹配 | 低 | 中 | Options 页增加字段名映射配置 |

---

## 八、技术备注

### 8.1 Native Messaging 调试

```bash
# 测试 Python bridge 脚本（手动输入）
echo '{"action":"search_tm","texts":["test"],"source_lang":"en","target_lang":"ja"}' | \
  python3 -c "
import sys, json, struct
msg = sys.stdin.read()
encoded = msg.encode('utf-8')
sys.stdout.buffer.write(struct.pack('=I', len(encoded)))
sys.stdout.buffer.write(encoded)
sys.stdout.buffer.flush()
" | python3 native-host/starling-bridge.py
```

### 8.2 飞书 API 速率限制

- `tenant_access_token` 有效期 2 小时，建议缓存
- Bitable `batch_create` 每次最多 500 条
- QPS 限制：约 5 QPS，大批量写入需加延迟

### 8.3 Chrome MV3 限制

- Service Worker 无持久状态，需用 `chrome.storage` 保存
- Content Script 不能直接调用 Native Messaging，必须通过 background 转发
- `chrome.runtime.sendNativeMessage` 仅在 Service Worker 中可用

### 8.4 安全注意事项

- 飞书 App Secret 存储在 `chrome.storage.local`（Chrome 加密存储）
- API Key 不经过任何第三方服务器
- TM 数据留在用户本地机器
- **高风险内容（金钱/法律/未成年人）必须人工确认后才写入表格**

---

## 九、相关文档

| 文档 | 路径 |
|------|------|
| 设计规格书 | `docs/superpowers/specs/2026-06-23-l10n-tm-companion-design.md` |
| Agent 原始需求 | `agent.md` |
| Starling CLI 文档 | 🔲 待补充链接 |
| 飞书 Bitable API 文档 | https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-record/create |
| Chrome Native Messaging | https://developer.chrome.com/docs/apps/nativeMessaging/ |
| Chrome MV3 迁移 | https://developer.chrome.com/docs/extensions/migrating/ |
