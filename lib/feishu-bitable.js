/**
 * 飞书多维表格 API 封装
 * =====================
 * 使用 tenant_access_token 写入 Bitable 记录。
 *
 * 注意：
 *   - tenant_access_token 有效期约 2 小时，模块内做内存缓存。
 *   - batch_create 单次最多 500 条。
 *   - 默认字段名见 FIELD_MAP，可在 Options 中通过 fieldMapping 覆盖。
 */

const FEISHU_BASE = 'https://open.feishu.cn/open-apis';

// 默认字段名（用户的多维表格列名）。可通过 config.fieldMapping 覆盖。
// 对应 TM 优化工作流字段，名字必须与表格列头完全一致。
const DEFAULT_FIELDS = {
  source: 'Original Source Segment',
  tmMatch: 'Best TM Match',
  similarity: 'Orig Match %',
  aiTranslation: 'Rewritten Segment',   // AI 改写后的原文
  newMatch: 'New Match %',               // 改写后原文再查 TM 的相似度
  reachedThreshold: 'Reached 85%?',      // Orig Match % ≥ 85 时勾选
  cdReview: 'CD review valid?',           // 留空待人工
  comparison: 'Comment',
};

// token 内存缓存（Service Worker 生命周期内有效）
// 按 appId 索引：用户在 Options 改了 App ID 后不会误用旧 token。
const tokenCache = new Map(); // appId → { token, expireAt }

// 仅供测试重置；生产不应调用。
export function _resetTokenCache() {
  tokenCache.clear();
}

/**
 * @param {Array}  items  处理后的文案项
 * @param {object} config { feishuAppId, feishuAppSecret, bitableAppToken, bitableTableId, fieldMapping }
 * @returns {Promise<Array>} 写入成功的记录
 */
export async function writeToBitable(items, config) {
  const { feishuAppId, feishuAppSecret, bitableAppToken, bitableTableId } = config;

  if (!feishuAppId || !feishuAppSecret) {
    throw new Error('未配置飞书 App ID / Secret');
  }
  if (!bitableAppToken || !bitableTableId) {
    throw new Error('未配置多维表格 App Token / Table ID');
  }

  const token = await getTenantToken(feishuAppId, feishuAppSecret);
  const fields = { ...DEFAULT_FIELDS, ...(config.fieldMapping || {}) };

  const records = items.map((item) => ({
    fields: {
      [fields.source]: item.source_text || '',
      [fields.tmMatch]: item.tm_match || '',
      [fields.similarity]: item.similarity ? Math.round(item.similarity) : 0,
      [fields.aiTranslation]: item.ai_translation || '',
      [fields.newMatch]: item.new_match ? Math.round(item.new_match) : 0,
      [fields.reachedThreshold]: item.reached_threshold === true, // 复选框
      // cdReview 留空待人工勾选，不写
      [fields.comparison]: formatComparison(item.ai_vs_tm),
    },
  }));

  const batchSize = 500;
  const allResults = [];
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const resp = await fetch(
      `${FEISHU_BASE}/bitable/v1/apps/${bitableAppToken}/tables/${bitableTableId}/records/batch_create`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ records: batch }),
      }
    );
    const data = await resp.json();
    if (data.code !== 0) {
      throw new Error(`Bitable API error: ${data.msg || data.code}`);
    }
    allResults.push(...(data.data?.records || []));
  }
  return allResults;
}

/**
 * 获取 tenant_access_token，带缓存。
 */
export async function getTenantToken(appId, appSecret) {
  const now = Date.now();
  const cached = tokenCache.get(appId);
  if (cached && now < cached.expireAt - 60_000) {
    return cached.token;
  }
  const resp = await fetch(`${FEISHU_BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const data = await resp.json();
  if (data.code !== 0) {
    throw new Error(`Feishu auth error: ${data.msg || data.code}`);
  }
  // expire 通常 7200s，提前 5 分钟过期
  const expireAt = now + (data.expire ? data.expire - 300 : 6900) * 1000;
  tokenCache.set(appId, { token: data.tenant_access_token, expireAt });
  return data.tenant_access_token;
}

/**
 * 连接测试：尝试获取 token（校验 App ID/Secret）。
 */
export async function testFeishuConnection(appId, appSecret) {
  try {
    await getTenantToken(appId, appSecret);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * 从多维表格读取原文案（Original Source Segment 列）。
 * 用于表格驱动入口：用户在多维表格页打开扩展，直接读当前表的原文。
 *
 * @param {object} config { feishuAppId, feishuAppSecret, bitableAppToken, bitableTableId, fieldMapping }
 * @returns {Promise<Array>} 原文案数组 [{ source_text, record_id }]
 */
export async function listSourceSegments(config) {
  const { feishuAppId, feishuAppSecret, bitableAppToken, bitableTableId } = config;
  if (!feishuAppId || !feishuAppSecret) {
    throw new Error('未配置飞书 App ID / Secret');
  }
  if (!bitableAppToken || !bitableTableId) {
    throw new Error('未配置多维表格 App Token / Table ID');
  }

  const token = await getTenantToken(feishuAppId, feishuAppSecret);
  const fields = { ...DEFAULT_FIELDS, ...(config.fieldMapping || {}) };
  const sourceField = fields.source; // 'Original Source Segment'

  const results = [];
  let pageToken = null;
  // 分页拉取所有记录
  do {
    const url = new URL(
      `${FEISHU_BASE}/bitable/v1/apps/${bitableAppToken}/tables/${bitableTableId}/records`
    );
    url.searchParams.set('page_size', '500');
    if (pageToken) url.searchParams.set('page_token', pageToken);

    const resp = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await resp.json();
    if (data.code !== 0) {
      throw new Error(`Bitable list error: ${data.msg || data.code}`);
    }
    const records = data.data?.items || data.data?.records || [];
    for (const rec of records) {
      const f = rec.fields || {};
      // 字段值可能是字符串，也可能是 [{text}] 数组（多行文本）
      const raw = f[sourceField];
      const text = extractTextField(raw);
      if (text && text.trim()) {
        results.push({ source_text: text.trim(), record_id: rec.record_id || rec.id });
      }
    }
    pageToken = data.data?.has_more ? data.data?.page_token : null;
  } while (pageToken);

  return results;
}

/**
 * 把飞书多行文本字段值提取成纯字符串。
 * 多行文本字段返回 [{ text: '...' }, ...] 数组，单行文本直接是字符串。
 */
function extractTextField(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((v) => (typeof v === 'string' ? v : (v?.text || ''))).join('');
  }
  if (typeof value === 'object') return value.text || '';
  return String(value);
}

function formatComparison(aiVsTm) {
  if (!aiVsTm) return '';
  let text = `Status: ${aiVsTm.status}\n${aiVsTm.changes || ''}`;
  if (aiVsTm.key_differences?.length > 0) {
    text += '\nKey differences:\n';
    aiVsTm.key_differences.forEach((d) => {
      text += `  - TM: ${d.tm} → AI: ${d.ai}`;
      if (d.reason) text += ` (${d.reason})`;
      text += '\n';
    });
  }
  return text.trim();
}
