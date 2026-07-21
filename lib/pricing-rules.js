/**
 * local rate 费率解析器。
 *
 * 只负责把已选择的 vendor 和插件语言代码映射到工作簿中的精确语言对，并返回
 * 原表按字费率。它不计算金额、不推导费率，也不执行任何跨 vendor 或语言回退。
 */

export const VENDORS = Object.freeze(['RWS', 'Pactera', 'Alconost', 'Skrivanek']);

/**
 * 生成统一的不可计费结果。
 *
 * @param {string} reason 稳定的失败原因代码。
 * @param {object} [details] 便于 UI 解释和审计的上下文。
 * @returns {{status: 'incomplete', reason: string}} 不完整结果。
 */
function incomplete(reason, details = {}) {
  return { status: 'incomplete', reason, ...details };
}

/**
 * 从已生成的 local rate 目录中解析按字 AIPE 与 T-only 费率。
 *
 * @param {object} catalog `data/local-rates.json` 解析后的对象。
 * @param {{vendor?: string, sourceLang?: string, targetLang?: string}} selection 用户选择。
 * @returns {object} `ready` 费率或带稳定 reason 的 `incomplete` 结果。
 */
export function resolveWordRate(catalog, selection = {}) {
  const vendor = String(selection.vendor || '').trim();
  if (!vendor) return incomplete('vendor_required');
  if (!VENDORS.includes(vendor)) return incomplete('invalid_vendor', { vendor });
  if (catalog?.schema_version !== 1 || !Array.isArray(catalog?.vendors?.[vendor])) {
    return incomplete('invalid_catalog', { vendor });
  }

  const sourceLocale = String(selection.sourceLang || '').trim();
  const targetLocale = String(selection.targetLang || '').trim();
  const row = catalog.vendors[vendor].find((candidate) => (
    candidate.source_locale === sourceLocale
    && candidate.target_locale === targetLocale
  ));
  if (!row) {
    return incomplete('missing_language_pair', {
      vendor,
      sourceLocale,
      targetLocale,
    });
  }

  const common = {
    vendor,
    sourceLanguage: row.source_language,
    targetLanguage: row.target_language,
    provenance: row.provenance,
    hourlyRateUsd: row.hourly_rate_usd,
  };
  if (!Number.isFinite(row.aipe_usd_per_1000_words)
      || !Number.isFinite(row.t_only_usd_per_1000_words)) {
    return incomplete('missing_word_rate', common);
  }
  return {
    status: 'ready',
    ...common,
    currency: 'USD',
    unit: 'word',
    aipeUsdPer1000Words: row.aipe_usd_per_1000_words,
    tOnlyUsdPer1000Words: row.t_only_usd_per_1000_words,
    aipeUsdPerWord: row.aipe_usd_per_1000_words / 1000,
    tOnlyUsdPerWord: row.t_only_usd_per_1000_words / 1000,
  };
}

/**
 * 枚举指定 canonical locale 语言对中具备完整按字费率的 vendor。
 *
 * @param {object} catalog local rate 目录。
 * @param {{sourceLang?:string,targetLang?:string}} selection canonical locale。
 * @returns {string[]} 按固定 vendor 顺序返回可用项。
 */
export function availableWordRateVendors(catalog, selection = {}) {
  return VENDORS.filter((vendor) => resolveWordRate(catalog, {
    vendor,
    sourceLang: selection.sourceLang,
    targetLang: selection.targetLang,
  }).status === 'ready');
}
