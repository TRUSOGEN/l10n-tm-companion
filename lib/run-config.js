/**
 * Popup 单次运行配置模型。
 *
 * 该模块只处理项目规范化、同 source locale 约束、ROI 语言 scope 和一至十个
 * 项目的门禁，不访问 DOM、Chrome storage 或网络。
 */

const VENDORS = Object.freeze(['RWS', 'Pactera', 'Alconost', 'Skrivanek']);
const MAX_PROJECTS = 10;
export const ROI_VENDORS = Object.freeze(['RWS', 'Pactera']);

/**
 * 将 Starling API 的 camelCase 或 bridge snake_case 项目转换为稳定结构。
 *
 * @param {object} raw Starling 项目原始对象。
 * @returns {{id:number,name:string,sourceLocale:string,targetLocales:string[]}|null} 项目。
 */
export function normalizeProject(raw) {
  const id = Number(raw?.id ?? raw?.projectId ?? raw?.project_id);
  if (!Number.isInteger(id) || id <= 0) return null;
  const sourceLocale = String(
    raw?.sourceLocale ?? raw?.source_locale ?? raw?.sourceLanguage ?? '',
  ).trim();
  const targetValue = raw?.targetLocales ?? raw?.target_locales ?? raw?.targetLanguages ?? [];
  const targetLocales = [...new Set(
    (Array.isArray(targetValue) ? targetValue : [targetValue])
      .map((locale) => String(locale || '').trim())
      .filter(Boolean),
  )].sort((left, right) => left.localeCompare(right));
  return {
    id,
    name: String(raw?.name ?? raw?.projectName ?? raw?.project_name ?? `Project ${id}`),
    sourceLocale,
    targetLocales,
  };
}

/**
 * 将完整权限项目列表切成稳定的 UI 页面，并校正越界页码。
 *
 * @param {Array<object>} projects 完整权限项目列表。
 * @param {number} requestedPageIndex 从零开始的目标页码。
 * @param {number} pageSize 每页项目数量。
 * @returns {{items:Array<object>,pageIndex:number,pageNumber:number,pageCount:number,totalItems:number,hasPrevious:boolean,hasNext:boolean}} 当前页面。
 */
export function paginateProjects(projects, requestedPageIndex = 0, pageSize = 8) {
  const allProjects = Array.isArray(projects) ? projects : [];
  const normalizedPageSize = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : 8;
  const pageCount = Math.ceil(allProjects.length / normalizedPageSize);
  const requested = Number.isInteger(requestedPageIndex) ? requestedPageIndex : 0;
  const pageIndex = pageCount > 0
    ? Math.min(Math.max(requested, 0), pageCount - 1)
    : 0;
  const start = pageIndex * normalizedPageSize;
  return {
    items: allProjects.slice(start, start + normalizedPageSize),
    pageIndex,
    pageNumber: pageCount > 0 ? pageIndex + 1 : 0,
    pageCount,
    totalItems: allProjects.length,
    hasPrevious: pageIndex > 0,
    hasNext: pageIndex + 1 < pageCount,
  };
}

/**
 * 计算所有项目共同支持的 target locale，空项目返回空数组。
 *
 * @param {Array<object>} projects 已规范化或原始项目。
 * @returns {string[]} 排序后的 target locale 交集。
 */
export function targetLocaleIntersection(projects) {
  const normalized = (projects || []).map(normalizeProject).filter(Boolean);
  if (!normalized.length) return [];
  let intersection = new Set(normalized[0].targetLocales);
  normalized.slice(1).forEach((project) => {
    intersection = new Set(
      [...intersection].filter((locale) => project.targetLocales.includes(locale)),
    );
  });
  return [...intersection].sort((left, right) => left.localeCompare(right));
}

/**
 * 构建普通 CD 路径的单一 Batch TM scope。
 *
 * 多个项目在同一次 Batch 查询中使用共同的 source/target locale，避免 ROI 关闭时
 * 仍按项目和全部语言串行放大请求数。
 *
 * @param {{projects?:Array<object>,projectIds?:Array<number|string>,targetLocale?:string}} input 输入。
 * @returns {{status:string,sourceLocale?:string,scopes:Array<object>,reason?:string}} 快速 scope。
 */
export function buildFastTmScope(input = {}) {
  const projects = (input.projects || []).map(normalizeProject).filter(Boolean);
  const projectIds = [...new Set((input.projectIds || []).map(Number).filter(Number.isInteger))];
  if (!projectIds.length) return { status: 'incomplete', reason: 'project_required', scopes: [] };
  if (projectIds.length > MAX_PROJECTS) return { status: 'incomplete', reason: 'max_projects', scopes: [] };
  const selectedProjects = projectIds.map((id) => projects.find((project) => project.id === id));
  if (selectedProjects.some((project) => !project)) {
    return { status: 'incomplete', reason: 'project_unavailable', scopes: [] };
  }
  const sourceLocales = new Set(selectedProjects.map((project) => project.sourceLocale));
  if (sourceLocales.size !== 1 || sourceLocales.has('')) {
    return { status: 'incomplete', reason: 'source_locale_mismatch', scopes: [] };
  }
  const requestedTargetLocale = String(input.targetLocale || '').trim();
  if (requestedTargetLocale
      && selectedProjects.some((project) => !project.targetLocales.includes(requestedTargetLocale))) {
    return { status: 'incomplete', reason: 'target_locale_unavailable', scopes: [] };
  }
  const commonLocales = targetLocaleIntersection(selectedProjects);
  if (!commonLocales.length) {
    return { status: 'incomplete', reason: 'no_common_target_locale', scopes: [] };
  }
  const targetLocale = requestedTargetLocale || commonLocales[0];
  const sourceLocale = selectedProjects[0].sourceLocale;
  return {
    status: 'ready',
    sourceLocale,
    scopes: [{
      key: `fast:${projectIds.join(',')}:${sourceLocale}:${targetLocale}`,
      projectId: projectIds[0],
      projectIds,
      projectName: selectedProjects.map((project) => project.name).join(', '),
      sourceLocale,
      targetLocale,
      mode: 'fast_tm',
    }],
  };
}

/**
 * 构建一次整车 ROI 运行所需的项目×共享目标语言 scope。
 *
 * 多项目只允许选择全部项目共同支持的 target locale；未显式配置时默认纳入
 * 全部共同语言。每个所选语言生成一个 scope，并在同一次 Batch TM 查询中携带全部
 * 项目 ID；source locale 必须完全一致，避免把不同 source 文案混入同一轮计算。
 *
 * @param {{projects?:Array<object>,projectIds?:Array<number|string>,selectedLocales?:string[]}} input 输入。
 * @returns {{status:string,sourceLocale?:string,scopes:Array<object>,reason?:string}} scope 或稳定失败原因。
 */
export function buildLocaleScopes(input = {}) {
  const projects = (input.projects || []).map(normalizeProject).filter(Boolean);
  const selectedIds = [...new Set(
    (input.projectIds || []).map(Number).filter(Number.isInteger),
  )];
  const selectedProjects = selectedIds
    .map((id) => projects.find((project) => project.id === id))
    .filter(Boolean);
  if (selectedProjects.length !== selectedIds.length) {
    return { status: 'incomplete', reason: 'project_unavailable', scopes: [] };
  }
  if (!selectedProjects.length) {
    return { status: 'incomplete', reason: 'project_required', scopes: [] };
  }

  const sourceLocales = new Set(selectedProjects.map((project) => project.sourceLocale));
  if (sourceLocales.size !== 1 || sourceLocales.has('')) {
    return { status: 'incomplete', reason: 'source_locale_mismatch', scopes: [] };
  }

  const commonLocales = targetLocaleIntersection(selectedProjects);
  if (!commonLocales.length) {
    return { status: 'incomplete', reason: 'no_common_target_locale', scopes: [] };
  }
  const requestedLocales = input.selectedLocales === undefined
    ? commonLocales
    : input.selectedLocales;
  if (!Array.isArray(requestedLocales) || !requestedLocales.length) {
    return { status: 'incomplete', reason: 'locale_scope_required', scopes: [] };
  }
  const locales = [...new Set(requestedLocales.map((locale) => String(locale || '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  if (!locales.length) {
    return { status: 'incomplete', reason: 'locale_scope_required', scopes: [] };
  }
  if (locales.some((targetLocale) => !commonLocales.includes(targetLocale))) {
    return { status: 'incomplete', reason: 'target_locale_unavailable', scopes: [] };
  }

  const projectIds = selectedProjects.map((project) => project.id);
  const projectNames = selectedProjects.map((project) => project.name);
  const sourceLocale = selectedProjects[0].sourceLocale;
  const scopes = locales.map((targetLocale) => ({
    key: `${projectIds.join(',')}:${sourceLocale}:${targetLocale}`,
    projectIds: [...projectIds],
    projectNames: [...projectNames],
    projectName: projectNames.join(', '),
    sourceLocale,
    targetLocale,
  }));
  return {
    status: 'ready',
    sourceLocale,
    scopes,
  };
}

/** 判断 locale 是否为英语变体，ROI 不为英文目标语言计价。 */
export function isEnglishLocale(locale) {
  return /^en(?:-|$)/i.test(String(locale || '').trim());
}

/**
 * 构建无需人工选择语言的 ROI scope。
 *
 * 自动覆盖已选项目共同支持的所有非英文 target locale；费率完整性由每个 vendor
 * 在 TM 快照完成后独立标记，不能因为其中一个 vendor 缺价而静默删掉语言。
 */
export function buildAutomaticRoiScopes(input = {}) {
  const result = buildLocaleScopes({
    projects: input.projects,
    projectIds: input.projectIds,
  });
  if (result.status !== 'ready') return result;
  const scopes = result.scopes.filter((scope) => !isEnglishLocale(scope.targetLocale));
  if (!scopes.length) return { status: 'incomplete', reason: 'non_english_locale_required', scopes: [] };
  return { ...result, scopes };
}

/**
 * 切换一个项目，同时执行数量和 source locale 约束。
 *
 * @param {{projects:Array<object>,selectedIds:Array<number|string>,projectId:number|string}} input 输入。
 * @returns {{ok:boolean,selectedIds:number[],reason?:string}} 新选择或失败原因。
 */
export function toggleProjectSelection(input) {
  const projects = (input.projects || []).map(normalizeProject).filter(Boolean);
  const selectedIds = [...new Set((input.selectedIds || []).map(Number))];
  const projectId = Number(input.projectId);
  if (selectedIds.includes(projectId)) {
    return { ok: true, selectedIds: selectedIds.filter((id) => id !== projectId) };
  }
  const candidate = projects.find((project) => project.id === projectId);
  if (!candidate) return { ok: false, selectedIds, reason: 'invalid_project' };
  if (selectedIds.length >= MAX_PROJECTS) {
    return { ok: false, selectedIds, reason: 'max_projects' };
  }
  const nextProjects = [...selectedIds, projectId]
    .map((id) => projects.find((project) => project.id === id))
    .filter(Boolean);
  const sourceLocales = new Set(nextProjects.map((project) => project.sourceLocale));
  if (sourceLocales.size > 1 || sourceLocales.has('')) {
    return { ok: false, selectedIds, reason: 'source_locale_mismatch' };
  }
  return { ok: true, selectedIds: [...selectedIds, projectId] };
}

/**
 * 验证 Popup 当前 vendor、项目和 ROI 语言 scope 是否可用于一次真实查询。
 *
 * @param {{vendor?:string,projects?:Array<object>,projectIds?:Array<number|string>,selectedLocales?:string[]}} input 配置。
 * @returns {object} 包含 vendor 和 scopes 的 ready 配置或稳定失败原因。
 */
export function validateRunConfig(input = {}) {
  const projectIds = [...new Set((input.projectIds || []).map(Number).filter(Number.isInteger))];
  if (!projectIds.length) return { status: 'incomplete', reason: 'project_required' };
  if (projectIds.length > MAX_PROJECTS) return { status: 'incomplete', reason: 'max_projects' };
  const vendor = String(input.vendor || '').trim();
  if (!vendor) return { status: 'incomplete', reason: 'vendor_required' };
  if (!VENDORS.includes(vendor)) return { status: 'incomplete', reason: 'invalid_vendor' };

  const localeScopes = buildLocaleScopes({
    projects: input.projects,
    projectIds,
    selectedLocales: input.selectedLocales,
  });
  if (localeScopes.status !== 'ready') return localeScopes;
  return {
    status: 'ready',
    vendor,
    projectIds,
    sourceLocale: localeScopes.sourceLocale,
    scopes: localeScopes.scopes,
  };
}

/**
 * 验证 ROI 单开关运行配置。
 *
 * RWS 与 Pactera 始终同时计算；此函数不接受 vendor 或语言选择，避免调用方把
 * 定价选择误传为 Starling 查询范围。
 */
export function validateAutomaticRoiRunConfig(input = {}) {
  const projectIds = [...new Set((input.projectIds || []).map(Number).filter(Number.isInteger))];
  if (!projectIds.length) return { status: 'incomplete', reason: 'project_required' };
  if (projectIds.length > MAX_PROJECTS) return { status: 'incomplete', reason: 'max_projects' };
  const localeScopes = buildAutomaticRoiScopes({
    projects: input.projects,
    projectIds,
  });
  if (localeScopes.status !== 'ready') return localeScopes;
  return {
    status: 'ready',
    vendors: [...ROI_VENDORS],
    projectIds,
    sourceLocale: localeScopes.sourceLocale,
    scopes: localeScopes.scopes,
  };
}
