/**
 * Side Panel 运行时中英文文案表。
 *
 * Chrome `_locales` 只按浏览器语言静态选择；本插件需要用户即时切换，因此使用
 * `data-i18n` 属性重绘静态文案，并把选择保存在 `chrome.storage.local`。
 */

const MESSAGES = Object.freeze({
  en: {
    workflow: 'Workflow', results: 'Results', settings: 'Settings', projects: 'Projects',
    refreshProjects: 'Refresh projects', fastTarget: 'Fast TM target language',
    fastTargetHint: 'The default path queries this language once across all selected projects.',
    roiMode: 'ROI mode', roiHint: 'Off by default. Turn on only for shared-language pricing and archive.',
    source: '1. Source', readSheet: 'Read configured source range',
    otherSources: 'Other sources (DOM extraction, may be noisy)', extractAll: 'Extract all text',
    extractSelection: 'Extract selection', writeBack: 'Write back to sheet',
    resultTitle: 'Extraction & processing results', back: 'Back to workflow',
    validateFinal: 'Confirm final C and calculate Score C', writeRoi: 'Write ROI archive',
    detail: 'Details', hideDetail: 'Hide details', focus: 'Focus', useAi: 'Use AI', useTm: 'Use TM',
    manual: 'Manual', focusTitle: 'Result detail', previous: 'Previous', next: 'Next',
    vendor: 'Vendor', roiLanguages: 'Shared ROI target languages', selectAll: 'Select all', clearAll: 'Clear all',
    roiSharedHint: 'AI rewrites the English source in English. Choose the shared target languages once; every selected project is queried for the same languages. Only common languages with an exact vendor word rate are shown.',
    selectProjectsFirst: 'Select projects first.', noCommonPriced: 'has no common priced target language across all selected projects.',
    noLocaleMatches: 'No locale matches', selectedScopes: 'selected', availableScopes: 'available',
    sourceDetail: 'Source', tmSource: 'Best TM source match (English)', tmTarget: 'TM target translation',
    aiRewrite: 'AI rewrite', aiCandidates: 'AI rewrite candidates', postTm: 'Post-rewrite TM source',
    finalTm: 'Final C TM source', tmScores: 'TM scores by project and language', comparison: 'AI vs TM comparison',
    selected: 'Selected', noTm: 'No TM match',
    languageChinese: 'Chinese', sheet: 'Sheet', sourceColumn: 'Source column',
    dataStartRow: 'Data start row', outputStartColumn: 'Output start column',
    sourcePreview: 'Source preview (first 5 non-empty rows)', confirmLayout: 'Confirm this layout',
    validateFinalTitle: 'Reads the confirmed final source and runs the third TM query.',
    manualPlaceholder: 'Enter final translation...',
    restoredArchive: 'Recent run restored. You can write the ROI archive now.',
    restoredFinal: 'Recent run restored. After writing to the Sheet, you can confirm final C.',
    finalNeedsAb: 'Complete A/B TM processing and write it to the Sheet before confirming final C.',
    finalNeedsSheet: 'Select a writable Spreadsheet before confirming final C.',
    finalReadingButton: 'Reading final C...',
    finalReadingProgress: 'Reading final C rows confirmed as Yes...',
    finalNone: 'No final C was found. Check the displayed rewritten and CD review columns, and confirm the active Sheet.',
    finalQueryProgress: 'Querying final C TM: {projects} · {locale} ({current}/{total})...',
    finalComplete: 'Final C TM query completed. {count} CD-confirmed source segment(s) can be archived; unconfirmed rows remain incomplete.',
    finalButton: 'Confirm final C and calculate Score C',
    archiveNeedsFinal: 'Confirm final C and calculate Score C before writing the ROI archive.',
  },
  'zh-CN': {
    workflow: '工作台', results: '结果', settings: '设置', projects: '项目',
    refreshProjects: '刷新项目', fastTarget: '快速 TM 目标语言',
    fastTargetHint: '默认路径只对这个语言执行一次跨项目 Batch TM 查询。',
    roiMode: 'ROI 模式', roiHint: '默认关闭；只有需要多项目共享语言计价和归档时再开启。',
    source: '1. 原文', readSheet: '读取已配置的原文范围',
    otherSources: '其他来源（DOM 抓取可能包含噪声）', extractAll: '抓取全部文本',
    extractSelection: '抓取选中文本', writeBack: '写回表格',
    resultTitle: '抓取与处理结果', back: '返回工作台',
    validateFinal: '确认最终 C 并计算 Score C', writeRoi: '写入 ROI 归档',
    detail: '展开详情', hideDetail: '收起详情', focus: '专注查看', useAi: '采用 AI', useTm: '采用 TM',
    manual: '手动编辑', focusTitle: '结果详情', previous: '上一条', next: '下一条',
    vendor: '供应商', roiLanguages: 'ROI 共享目标语言', selectAll: '全选', clearAll: '全部取消',
    roiSharedHint: 'AI 始终用英文改写英文 source。共享目标语言只需选择一次，全部已选项目都会查询同一组语言；这里只显示项目共同支持且 Vendor 有精确按字费率的语言。',
    selectProjectsFirst: '请先选择项目。', noCommonPriced: '在全部已选项目中没有共同的可计费目标语言。',
    noLocaleMatches: '没有匹配的语言', selectedScopes: '已选', availableScopes: '可用',
    sourceDetail: '原始英文文案', tmSource: '最佳 TM 英文原文匹配', tmTarget: 'TM 目标语言译文',
    aiRewrite: 'AI 英文改写', aiCandidates: 'AI 改写候选', postTm: '改写后 TM 英文匹配',
    finalTm: '最终 C 的 TM 英文匹配', tmScores: '各项目与语言的 TM 分数', comparison: 'AI 与 TM 对比',
    selected: '已选择', noTm: '无 TM 命中',
    languageChinese: '中文', sheet: '工作表', sourceColumn: '原文列',
    dataStartRow: '数据起始行', outputStartColumn: '输出起始列',
    sourcePreview: '原文预览（前 5 条非空行）', confirmLayout: '确认当前布局',
    validateFinalTitle: '读取人工确认的最终原文，并执行第三次 TM 查询。',
    manualPlaceholder: '输入最终译文…',
    restoredArchive: '已恢复最近运行，可以直接写入 ROI 归档。',
    restoredFinal: '已恢复最近运行，写回工作表后可以确认最终 C。',
    finalNeedsAb: '请先完成 A/B TM 处理并写回工作表，再确认最终 C。',
    finalNeedsSheet: '请先选择可写入的电子表格，再确认最终 C。',
    finalReadingButton: '正在读取最终 C…',
    finalReadingProgress: '正在读取人工选择 Yes 的最终 C 文案…',
    finalNone: '未读取到最终 C，请核对页面显示的改写列和 CD review 列，并确认当前工作表。',
    finalQueryProgress: '正在查询最终 C 的 TM：{projects} · {locale}（{current}/{total}）…',
    finalComplete: '最终 C 的 TM 查询已完成；{count} 条已由 CD 确认的文案可以归档，未确认行保持 incomplete。',
    finalButton: '确认最终 C 并计算 Score C',
    archiveNeedsFinal: '请先确认最终 C 并计算 Score C，再写入 ROI 归档。',
  },
});

/** 规范化用户选择，未知值统一回到英文。 */
export function normalizeUiLanguage(language) {
  return language === 'zh-CN' ? 'zh-CN' : 'en';
}

/** 读取一条运行时文案；缺失翻译时回退英文 key。 */
export function t(key, language = 'en', params = {}) {
  const normalized = normalizeUiLanguage(language);
  const template = MESSAGES[normalized]?.[key] || MESSAGES.en[key] || key;
  return Object.entries(params).reduce(
    (message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
    template,
  );
}

/** 根据 `data-i18n` 属性更新当前文档中的静态文本。 */
export function applyI18n(root, language) {
  const normalized = normalizeUiLanguage(language);
  root.documentElement.lang = normalized === 'zh-CN' ? 'zh-CN' : 'en';
  root.querySelectorAll('[data-i18n]').forEach((element) => {
    element.textContent = t(element.dataset.i18n, normalized);
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
    element.setAttribute('placeholder', t(element.dataset.i18nPlaceholder, normalized));
  });
  root.querySelectorAll('[data-i18n-title]').forEach((element) => {
    element.setAttribute('title', t(element.dataset.i18nTitle, normalized));
  });
  root.querySelectorAll('[data-i18n-aria-label]').forEach((element) => {
    element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel, normalized));
  });
  return normalized;
}
