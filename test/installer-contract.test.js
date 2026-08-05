/** macOS 安装入口、固定扩展 ID 与配置帮助链接契约测试。 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const installScript = fs.readFileSync(path.join(root, 'native-host/install.sh'), 'utf8');
const optionsHtml = fs.readFileSync(path.join(root, 'options.html'), 'utf8');
const popupHtml = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
const offlineManual = fs.readFileSync(path.join(root, 'docs/offline-install-manual.md'), 'utf8');
const appExecutable = path.join(root, 'L10n TM Companion Installer.app/Contents/MacOS/l10n-installer');
const appScript = fs.readFileSync(appExecutable, 'utf8');
const packageScript = fs.readFileSync(path.join(root, 'scripts/build-offline-package.sh'), 'utf8');
const progressSource = fs.readFileSync(path.join(root, 'installer-ui/installer-progress.m'), 'utf8');
const contentMatches = manifest.content_scripts?.flatMap((entry) => entry.matches || []) || [];
const contentReviewRoot = path.join(root, 'skills/cd-content-review-version-2');
const expectedRuleHashes = {
  'references/style-guide.md': '76e8b96f98a52d80fa8ee7782a2ec7b0eb5c4e0b6dc7dbfbb5182575090b9946',
  'references/glossary.md': '6ff564807c85712e9d12ccb9d7d56c030419e5584225366bbb69f97b49247b2c',
  'references/game-legal-guidelines.md': 'd457aca54735932e4a4539a0b91a176adc70869763473b2b011775fbaf4171d8',
  'references/revenue-legal-guidelines.md': '540f4a7293e80a6defa4fe0e730fab5b8d311bb5e0e19402075e752ed39e3d50',
};

const digest = crypto.createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest().subarray(0, 16);
const extensionId = [...digest]
  .flatMap((byte) => [byte >> 4, byte & 0x0f])
  .map((nibble) => String.fromCharCode('a'.charCodeAt(0) + nibble))
  .join('');

assert.equal(extensionId, 'bgbodpcofifiloekhfjiffmchcaiiicm', 'manifest 公钥必须生成稳定的 32 位扩展 ID');
assert.match(extensionId, /^[a-p]{32}$/);
assert.ok(installScript.includes('--dry-run'), '安装器必须提供无副作用的 dry-run 自检入口');
assert.ok(installScript.includes('chrome://extensions'), '安装器必须自动打开 Chrome 扩展页');
assert.ok(installScript.includes('/opt/homebrew/bin'), 'Finder 双击安装必须补齐 Homebrew PATH');
assert.ok(installScript.includes('.nvm/versions/node'), 'Finder 双击安装必须探测 nvm Node 路径');
assert.ok(!installScript.includes('welukkiwnwhmkigs'), '禁止继续使用错误的 16 位兜底 ID');
assert.ok(fs.existsSync(appExecutable), '必须提供可双击的 macOS Installer.app');
assert.ok((fs.statSync(appExecutable).mode & 0o111) !== 0, 'Installer.app 主入口必须可执行');
assert.ok(!appScript.includes('--install-starling'), 'Installer.app 不得修改用户的全局 npm 环境');
assert.ok(appScript.includes('Contents/Resources/extension'), '线下 Installer.app 必须优先使用内置插件 payload');
assert.ok(appScript.includes('Application Support/L10n TM Companion'), '线下安装必须复制到稳定的用户目录');
assert.ok(appScript.includes('/usr/bin/pbcopy'), '安装完成后必须复制正确插件目录，避免用户查找隐藏路径');
assert.ok(appScript.includes('L10n TM Companion - Chrome 加载这个文件夹'), '安装后必须创建名称清楚的可见 Chrome 加载目录');
assert.ok(appScript.includes('/Desktop/'), '安装后必须在 Desktop 创建可手动点击的加载入口');
assert.ok(appScript.includes('l10n-progress'), 'Installer.app 必须启动原生进度窗口');
assert.ok(appScript.includes('L10N_TM_INSTALLER_NO_UI'), 'Installer.app 必须支持隔离无 GUI 端到端测试');
assert.ok(installScript.includes('--progress-file'), '统一安装脚本必须向进度窗口报告阶段');
assert.ok(packageScript.includes('installer-ui/installer-progress.m'), '构建器必须编译进度窗口源码');
assert.ok(packageScript.includes('STARLING_VERSION="1.1.41"'), '安装包必须固定使用已验证的 Starling CLI 1.1.41');
assert.ok(packageScript.includes('-arch arm64') && packageScript.includes('-arch x86_64'), '进度窗口必须同时支持 Apple Silicon 与 Intel Mac');
assert.ok(progressSource.includes('--self-test'), '进度窗口必须提供无 GUI 自检入口');
assert.ok(offlineManual.includes('桌面'), '非技术手册必须说明从桌面手动选择加载目录');
assert.ok(!offlineManual.includes('Command + Shift + G'), '正式手册不得继续依赖无效的前往文件夹快捷键');
assert.ok(packageScript.includes('docs/offline-install-manual.md'), '线下包必须包含非技术用户手册');
assert.equal(manifest.version, '1.6.0', '自动 ROI、Broker 关闭态能力与受控 Starling 批量能力使用 1.6.0 版本');
assert.ok(popupHtml.includes('Read source → Query TM → AI rewrite'), '线下包主入口必须描述完整查询链路');
assert.ok(!popupHtml.includes('id="btn-write-bitable"'), '线下包不得包含旧的全局主流程写回按钮');
assert.ok(!popupHtml.includes('id="btn-write-results"'), '线下包不得包含旧的全局结果写回按钮');
assert.ok(!popupHtml.includes('id="btn-validate-final"'), '线下包不得包含旧的全局 Final C 按钮');
assert.ok(
  offlineManual.includes('`50 ≤ Score A < 85`') && offlineManual.includes('`Final TM %`'),
  '线下手册必须说明新 AI 边界与 Sheet schema',
);
assert.ok(
  offlineManual.includes('Confirm & save remaining')
    && offlineManual.includes('Owner/受控 Pilot'),
  '线下手册必须说明批量确认入口与无 broker 时的分发边界',
);
assert.ok(
  offlineManual.includes('L10n ROI Items')
    && offlineManual.includes('20,000')
    && offlineManual.includes('重新授权'),
  '线下手册必须说明三层归档、容量边界与新增 scope 后的重新授权',
);
assert.ok(packageScript.includes('skills/cd-content-review-version-2'), '线下包必须包含 Content Review skill 与规则 Markdown');
assert.ok(
  packageScript.includes("--exclude='.DS_Store'") && packageScript.includes("--exclude='._*'"),
  '线下包必须过滤 macOS Finder 元数据，避免不可移植文件导致构建失败',
);
assert.ok(
  packageScript.includes('--norsrc')
    && packageScript.includes('--noextattr')
    && !packageScript.includes('--sequesterRsrc'),
  '最终 ZIP 必须禁止 resource fork 和扩展属性，不能生成 __MACOSX/._*',
);
for (const [relativePath, expectedHash] of Object.entries(expectedRuleHashes)) {
  const assetPath = path.join(contentReviewRoot, relativePath);
  assert.ok(fs.existsSync(assetPath), `规则快照必须存在：${relativePath}`);
  const actualHash = crypto.createHash('sha256').update(fs.readFileSync(assetPath)).digest('hex');
  assert.equal(actualHash, expectedHash, `规则快照必须保持用户提供的原文：${relativePath}`);
}
assert.ok(fs.existsSync(path.join(contentReviewRoot, 'SNAPSHOT.md')), '规则快照必须记录来源日期与哈希');
assert.ok(packageScript.includes('native-host/starling-bridge.py'), '线下包必须包含 Native Messaging bridge');
assert.ok(packageScript.includes('native-host/feishu_oauth_broker.py'), '线下包必须包含 Feishu Broker Native Host 模块');
assert.ok(packageScript.includes('native-host/roi_broker_client.py'), '线下包必须包含异步 ROI Broker Native Host 模块');
assert.ok(packageScript.includes('runtime/bin'), '线下包必须封装私有运行环境');
assert.ok(
  fs.readFileSync(path.join(root, 'scripts/run-full-regression.sh'), 'utf8').includes('test/*.py'),
  '完整回归必须发现所有顶层 Python 测试命名形式',
);
assert.ok(installScript.includes('runtime/bin'), '安装时必须优先使用插件私有运行环境');
assert.ok(
  installScript.includes('_resolve_starling_cli_root') && installScript.includes('starling-agent-core'),
  '安装必须验证私有 Starling CLI 可定位官方 Core',
);
assert.ok(!installScript.includes('npm install -g @byted/starling-agent-cli'), '用户安装不得修改全局 npm 环境');
assert.ok(!packageScript.includes('TUTORIAL.md'), '线下包不得包含教程草稿和历史凭证');
assert.ok(optionsHtml.includes('href="https://inspire.bytedance.net"'), 'Inspire 配置区必须提供产品入口链接');
assert.ok(!optionsHtml.includes('href="docs/offline-install-manual.md"'), 'Settings 不再展示会打断配置流程的 Guide 入口');
assert.ok(optionsHtml.includes('class="setup-steps"'), 'Settings 必须提供四步配置清单');
assert.ok(optionsHtml.includes('ROI archive:') && optionsHtml.includes('open ROI_Test'), 'Settings 必须提供固定 ROI archive 直达入口');
assert.ok(contentMatches.includes('*://*.feishu.cn/wiki/*'), 'feishu.cn Wiki 页面必须注入内容脚本');
assert.ok(contentMatches.includes('*://*.feishu.cn/sheets/*'), 'feishu.cn Sheet 页面必须注入内容脚本');
assert.ok(contentMatches.includes('*://*.larksuite.com/wiki/*'), 'larksuite.com Wiki 页面必须注入内容脚本');
assert.ok(contentMatches.includes('*://*.larksuite.com/sheets/*'), 'larksuite.com Sheet 页面必须注入内容脚本');
const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'l10n-installer-test-'));
const isolatedHome = path.join(isolatedRoot, 'home');
const fakeBin = path.join(isolatedRoot, 'bin');
fs.mkdirSync(isolatedHome);
fs.mkdirSync(fakeBin);
const realPython = childProcess.execFileSync('/usr/bin/which', ['python3'], { encoding: 'utf8' }).trim();
fs.symlinkSync(realPython, path.join(fakeBin, 'python3'));
fs.writeFileSync(path.join(fakeBin, 'node'), '#!/bin/sh\necho v-test\n', { mode: 0o755 });
fs.writeFileSync(path.join(fakeBin, 'starling-cli'), '#!/bin/sh\necho 1.1.41\n', { mode: 0o755 });
const controlledEnv = {
  ...process.env,
  HOME: isolatedHome,
  PATH: `${fakeBin}:/usr/bin:/bin`,
  PYTHONDONTWRITEBYTECODE: '1',
  PYTHONPYCACHEPREFIX: path.join(isolatedRoot, 'pycache'),
  L10N_TM_SKIP_PATH_DISCOVERY: '1',
};
try {
  const progressFile = path.join(isolatedRoot, 'installer-progress.txt');
  const dryRunOutput = childProcess.execFileSync(
    '/bin/bash',
    [path.join(root, 'native-host/install.sh'), '--dry-run', '--no-open', '--progress-file', progressFile],
    { cwd: root, encoding: 'utf8', env: controlledEnv },
  );
  assert.match(dryRunOutput, /固定扩展 ID：bgbodpcofifiloekhfjiffmchcaiiicm/);
  assert.match(dryRunOutput, /DRY RUN：不会写入文件/);
  assert.match(fs.readFileSync(progressFile, 'utf8'), /^100\|安装准备完成/);
  assert.equal(
    fs.existsSync(path.join(isolatedHome, 'Library/Application Support/Google/Chrome/NativeMessagingHosts')),
    false,
    'dry-run 不得创建或写入 NativeMessagingHosts',
  );

  fs.rmSync(path.join(fakeBin, 'node'));
  const missingNode = childProcess.spawnSync(
    '/bin/bash',
    [path.join(root, 'native-host/install.sh'), '--dry-run', '--no-open'],
    { cwd: root, encoding: 'utf8', env: controlledEnv },
  );
  assert.equal(missingNode.status, 1, '缺少 Node 时安装器必须失败');
  assert.match(missingNode.stdout, /未找到 Node\.js/);

  fs.writeFileSync(path.join(fakeBin, 'node'), '#!/bin/sh\necho v-test\n', { mode: 0o755 });
  fs.rmSync(path.join(fakeBin, 'starling-cli'));
  const missingStarling = childProcess.spawnSync(
    '/bin/bash',
    [path.join(root, 'native-host/install.sh'), '--dry-run', '--no-open'],
    { cwd: root, encoding: 'utf8', env: controlledEnv },
  );
  assert.equal(missingStarling.status, 1, '非交互环境缺少 Starling CLI 时必须失败');
  assert.match(missingStarling.stdout, /安装包没有内置 Starling CLI/);
} finally {
  fs.rmSync(isolatedRoot, { recursive: true, force: true });
}

console.log('installer contract tests: 53 passed, 0 failed');
