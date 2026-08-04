/** Popup 运行配置纯函数回归测试。 */

import {
  buildFastTmScope,
  buildAutomaticRoiScopes,
  isEnglishLocale,
  buildLocaleScopes,
  normalizeProject,
  targetLocaleIntersection,
  targetLocaleCoverage,
  toggleProjectSelection,
  validateAutomaticRoiRunConfig,
  validateRunConfig,
} from '../lib/run-config.js';

import assert from 'node:assert/strict';

const projectA = normalizeProject({
  id: 513,
  name: 'live_client',
  sourceLocale: 'en',
  targetLocales: ['ja-JP', 'zh-Hans'],
});
const projectB = normalizeProject({
  projectId: 385,
  projectName: 'TikTok_Client',
  source_locale: 'en',
  target_locales: ['ko-KR', 'zh-Hans'],
});
const projectJaOnly = normalizeProject({
  id: 701,
  name: 'Japanese only',
  sourceLocale: 'en',
  targetLocales: ['ja-JP'],
});
const projectKoOnly = normalizeProject({
  id: 702,
  name: 'Korean only',
  sourceLocale: 'en',
  targetLocales: ['ko-KR'],
});

assert.equal(projectA.id, 513, '应保留真实项目 ID');
assert.equal(projectA.sourceLocale, 'en', '应保留真实 sourceLocale');
assert.deepEqual(projectA.targetLocales, ['ja-JP', 'zh-Hans']);
assert.deepEqual(targetLocaleCoverage([projectA, projectB]).map(({ targetLocale, projects }) => [
  targetLocale,
  projects.map((project) => project.id),
]), [
  ['ja-JP', [513]],
  ['ko-KR', [385]],
  ['zh-Hans', [513, 385]],
], '语言覆盖表应按并集返回每个 target locale 对应项目');

const fastScope = buildFastTmScope({
  projects: [projectA, projectB],
  projectIds: [513, 385],
  targetLocale: 'zh-Hans',
});
assert.equal(fastScope.status, 'ready', '快速 TM 应接受共同 target locale');
assert.deepEqual(fastScope.scopes[0].projectIds, [513, 385], '快速 TM 应在一个 Batch scope 中查询全部项目');
assert.equal(fastScope.scopes[0].targetLocale, 'zh-Hans');
const automaticFastScope = buildFastTmScope({
  projects: [projectA, projectB],
  projectIds: [513, 385],
});
assert.equal(automaticFastScope.status, 'ready', 'CD 快速路径无需手动选择 target locale');
assert.equal(automaticFastScope.scopes[0].targetLocale, 'zh-Hans', '内部参考 locale 必须从共同语言中确定性选择');
assert.equal(buildFastTmScope({
  projects: [projectJaOnly, projectKoOnly],
  projectIds: [701, 702],
  targetLocale: 'ja-JP',
}).reason, 'target_locale_unavailable', '快速 TM 目标语言必须被全部所选项目支持');
assert.equal(buildFastTmScope({
  projects: [projectJaOnly, projectKoOnly],
  projectIds: [701, 702],
}).reason, 'no_common_target_locale', '没有共同语言时必须正确失败');

const selected = toggleProjectSelection({
  projects: [projectA, projectB],
  selectedIds: [513],
  projectId: 385,
});
assert.equal(selected.ok, true);
assert.deepEqual(selected.selectedIds, [513, 385]);

const nonOverlappingSelected = toggleProjectSelection({
  projects: [projectJaOnly, projectKoOnly],
  selectedIds: [701],
  projectId: 702,
});
assert.equal(nonOverlappingSelected.ok, true, '同 source 项目无需共同 target locale');
assert.deepEqual(nonOverlappingSelected.selectedIds, [701, 702]);

const mismatched = toggleProjectSelection({
  projects: [projectA, normalizeProject({
    id: 278,
    name: 'Chinese source',
    sourceLocale: 'zh-Hans',
    targetLocales: ['ja-JP'],
  })],
  selectedIds: [513],
  projectId: 278,
});
assert.equal(mismatched.reason, 'source_locale_mismatch');

const maxed = toggleProjectSelection({
  projects: Array.from({ length: 11 }, (_, index) => normalizeProject({
    id: index + 1,
    name: `Project ${index + 1}`,
    sourceLocale: 'en',
    targetLocales: ['zh-Hans'],
  })),
  selectedIds: Array.from({ length: 10 }, (_, index) => index + 1),
  projectId: 11,
});
assert.equal(maxed.reason, 'max_projects');

assert.equal(
  validateRunConfig({ vendor: 'Pactera', projectIds: [], targetLocale: '' }).reason,
  'project_required',
);
assert.equal(
  validateRunConfig({ vendor: '', projectIds: [513], targetLocale: 'zh-Hans' }).reason,
  'vendor_required',
);
const valid = validateRunConfig({
  vendor: 'Pactera',
  projects: [projectA, projectB],
  projectIds: [513, 385],
});
assert.equal(valid.status, 'ready');
assert.equal(valid.sourceLocale, 'en');
assert.equal(valid.vendor, 'Pactera');
assert.deepEqual(valid.scopes.map((scope) => scope.key), [
  '513,385:en:zh-Hans',
], '运行校验必须为每个共同语言生成一个多项目 scope');
assert.deepEqual(valid.scopes[0].projectIds, [513, 385], '语言 scope 必须一次携带全部所选项目');
assert.deepEqual(valid.scopes[0].projectNames, ['live_client', 'TikTok_Client']);

const validNonOverlapping = validateRunConfig({
  vendor: 'Pactera',
  projects: [projectJaOnly, projectKoOnly],
  projectIds: [701, 702],
});
assert.equal(validNonOverlapping.status, 'incomplete');
assert.equal(validNonOverlapping.reason, 'no_common_target_locale', 'ROI 多项目必须至少共享一种目标语言');

const englishTarget = normalizeProject({
  id: 999,
  name: 'English target',
  sourceLocale: 'en',
  targetLocales: ['en'],
});
const englishToEnglish = validateRunConfig({
  vendor: 'RWS',
  projects: [englishTarget],
  projectIds: [999],
});
assert.equal(englishToEnglish.status, 'ready', 'en→en 是有效 TM 查询配置');
assert.equal(englishToEnglish.scopes[0].targetLocale, 'en', 'en target 必须原样保留');

const defaultScopes = buildLocaleScopes({
  projects: [projectA, projectB],
  projectIds: [513, 385],
});
assert.equal(defaultScopes.status, 'ready', '默认应覆盖所选项目的全部共同目标语言');
assert.equal(defaultScopes.sourceLocale, 'en');
assert.deepEqual(defaultScopes.scopes.map((scope) => scope.key), [
  '513,385:en:zh-Hans',
], '多项目 ROI scope 必须按共同语言生成，不能使用项目语言笛卡尔积');

const narrowedScopes = buildLocaleScopes({
  projects: [projectA],
  projectIds: [513],
  selectedLocales: ['ja-JP'],
});
assert.equal(narrowedScopes.status, 'ready');
assert.equal(narrowedScopes.scopes.length, 1, '显式选择应缩小所有项目共享的 ROI 语言范围');
assert.equal(narrowedScopes.scopes[0].key, '513:en:ja-JP');

const twentyOneLocales = Array.from({ length: 21 }, (_, index) => `locale-${String(index + 1).padStart(2, '0')}`);
const wideA = normalizeProject({
  id: 1001,
  name: 'Wide A',
  sourceLocale: 'en',
  targetLocales: twentyOneLocales,
});
const wideB = normalizeProject({
  id: 1002,
  name: 'Wide B',
  sourceLocale: 'en',
  targetLocales: twentyOneLocales,
});
const twentyOneScopes = buildLocaleScopes({
  projects: [wideA, wideB],
  projectIds: [1001, 1002],
});
assert.equal(twentyOneScopes.scopes.length, 21, '两个项目与二十一个语言只能生成二十一个语言 scope');
assert.ok(twentyOneScopes.scopes.every((scope) => (
  scope.projectIds.length === 2 && scope.projectIds[0] === 1001 && scope.projectIds[1] === 1002
)), '每个语言 scope 都必须携带两个项目 ID');

const unavailableLocale = buildLocaleScopes({
  projects: [projectA, projectB],
  projectIds: [513, 385],
  selectedLocales: ['ja-JP'],
});
assert.equal(unavailableLocale.reason, 'target_locale_unavailable', '显式选择非共同语言必须忠实失败');

assert.equal(buildLocaleScopes({
  projects: [projectA],
  projectIds: [513],
  selectedLocales: [],
}).reason, 'locale_scope_required', '显式取消全部语言时必须要求至少一个 scope');

const sourceLocaleMismatch = buildLocaleScopes({
  projects: [projectA, normalizeProject({
    id: 278,
    name: 'Chinese source',
    sourceLocale: 'zh-Hans',
    targetLocales: ['ja-JP'],
  })],
  projectIds: [513, 278],
});
assert.equal(sourceLocaleMismatch.reason, 'source_locale_mismatch');

const unavailableProject = buildLocaleScopes({
  projects: [projectA],
  projectIds: [513, 404],
});
assert.equal(unavailableProject.status, 'incomplete');
assert.equal(unavailableProject.reason, 'project_unavailable');
assert.deepEqual(unavailableProject.scopes, []);

assert.equal(validateRunConfig({
  vendor: 'Pactera',
  projects: [projectA],
  projectIds: [513, 404],
}).reason, 'project_unavailable', '运行校验必须保留不可用项目错误');

const automaticRoi = validateAutomaticRoiRunConfig({
  projects: [normalizeProject({
    id: 2001,
    name: 'Automatic ROI Europe',
    sourceLocale: 'en',
    targetLocales: ['en', 'en-GB', 'fr', 'ja-JP', 'zh-Hans'],
  }), normalizeProject({
    id: 2002,
    name: 'Automatic ROI Asia',
    sourceLocale: 'en',
    targetLocales: ['en', 'ko-KR', 'zh-Hans'],
  })],
  projectIds: [2001, 2002],
});
assert.equal(automaticRoi.status, 'ready', 'ROI 单开关配置应无需 vendor 或语言选择');
assert.deepEqual(automaticRoi.vendors, ['RWS', 'Pactera']);
assert.deepEqual(automaticRoi.scopes.map((scope) => scope.targetLocale), ['fr', 'ja-JP', 'ko-KR', 'zh-Hans']);
assert.deepEqual(automaticRoi.scopes.map((scope) => scope.projectIds), [
  [2001],
  [2001],
  [2002],
  [2001, 2002],
], '自动 ROI 应覆盖目标语言并集，并按语言只携带支持该语言的项目');
assert.deepEqual(automaticRoi.scopes.map((scope) => scope.requestedProjectIds), [
  [2001, 2002],
  [2001, 2002],
  [2001, 2002],
  [2001, 2002],
], 'scope 应保留用户请求的完整项目集用于审计');
assert.equal(isEnglishLocale('en-GB'), true);
assert.equal(isEnglishLocale('ja-JP'), false);
assert.equal(buildAutomaticRoiScopes({
  projects: [englishTarget], projectIds: [999],
}).reason, 'non_english_locale_required', 'ROI 必须排除英语并在无其他语言时正确失败');

console.log('run-config tests: 51 passed, 0 failed');
