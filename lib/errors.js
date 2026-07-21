/**
 * 可操作错误信息（LOOP_SPEC §6.3）
 * ===============================
 * 把原始错误映射成「问题 + 下一步」的可操作文案，
 * 告诉用户怎么修，而非只报通用 error。
 *
 * 规则：识别错误特征 → 返回 { title, action } 结构化提示。
 * 不识别时回退原始 message。
 */

/**
 * 把任意 error/string 映射成可操作提示。
 * @param {string|Error} err
 * @param {'en'|'zh-CN'} language 当前界面语言。
 * @returns {{title:string, action:string, raw:string}}
 */
export function friendlyError(err, language = 'en') {
  const raw = (err && err.message) ? err.message : String(err || '');
  const msg = raw.toLowerCase();
  const zh = language === 'zh-CN';
  const result = (enTitle, enAction, zhTitle, zhAction) => ({
    title: zh ? zhTitle : enTitle,
    action: zh ? zhAction : enAction,
    raw,
  });

  // Native host 不可用
  if (/native messaging host|specified native messaging|sendnativemessage|communicating with the native/i.test(raw)) {
    return result(
      'Native Messaging Host unavailable',
      'Run native-host/register-native-host.sh, then reload the extension in chrome://extensions.',
      'Native Messaging Host 不可用',
      '请运行 native-host/register-native-host.sh 注册，然后在 chrome://extensions 重新加载扩展。',
    );
  }

  // 飞书权限缺失
  if (/sheets:spreadsheet|scopes required|permission denied|access denied/i.test(raw)) {
    return result(
      'Insufficient Feishu permission',
      'Enable sheets:spreadsheet, publish the app version, and add the app as an editor of this Spreadsheet.',
      '飞书权限不足',
      '请在飞书开放平台开通 sheets:spreadsheet 权限、重新发布版本，并把本应用加为该电子表格的协作者（可编辑）。',
    );
  }

  // 电子表格 token 缺失（精确匹配，避免吞掉含 "token" 字样的诊断信息）
  if (/未配置电子表格 token|spreadsheet token is not configured/i.test(raw)) {
    return result(
      'No working spreadsheet',
      'Open a Spreadsheet in the popup or paste its URL under Working spreadsheet.',
      '未设置写入目标',
      '请在工作表区域打开或粘贴飞书电子表格 URL，插件会自动解析 token。',
    );
  }

  // 飞书凭证缺失
  if (/未配置飞书 App ID|configure Feishu App ID|app secret invalid|tenant_access_token/i.test(raw)) {
    return result(
      'Missing or invalid Feishu app credentials',
      'Enter the correct Feishu App ID and App Secret in Settings.',
      '飞书应用凭证缺失或错误',
      '请在设置页填写正确的飞书 App ID 与 App Secret。',
    );
  }

  // 无效链接
  if (/非 sheets url|parsefeishuurl|invalid url|未识别/i.test(raw)) {
    return result(
      'Unrecognized link',
      'Paste a Feishu Spreadsheet (/sheets/) link.',
      '链接无法识别',
      '请粘贴飞书电子表格（/sheets/）链接。',
    );
  }

  // PPE 远端依赖超时：请求已到达 Starling，不能误导为本机凭证问题
  if (/error_code=1204/i.test(raw) && /remote or network error/i.test(raw)) {
    const logid = raw.match(/logid:\s*([^\s)]+)/i)?.[1];
    return result(
      'PPE TM service timeout',
      `A Starling PPE dependency did not respond within one second after three retries. Retry later; if it persists, send ${logid ? `LogID ${logid}` : 'the LogID in Raw error'} to the Starling API owner.`,
      'PPE TM 服务超时',
      `Starling PPE 的远端依赖本次在 1 秒内未返回，插件已自动重试 3 次。请稍后重试；若持续出现，请把${logid ? ` LogID ${logid}` : ' Raw error 中的 LogID'}提供给 Starling 接口同学。`,
    );
  }

  // TM 不可用 / 无匹配
  if (/tm 查询失败|no tm match|cli timeout|starling/i.test(raw)) {
    return result(
      'TM query unavailable',
      'Confirm starling-cli is installed and AK/SK are valid. Check /tmp/l10n-bridge-debug.log for details.',
      'TM 查询不可用',
      '请确认 starling-cli 已安装且 AK/SK 配置正确，并查看 /tmp/l10n-bridge-debug.log。',
    );
  }

  // 无法与页面通信（非飞书文档页）
  if (/无法与页面通信|no receiving end/i.test(raw)) {
    return result(
      'Cannot communicate with this page',
      'Open a supported Feishu document page and try again.',
      '无法与页面通信',
      '请确认当前打开的是受支持的飞书文档页面。',
    );
  }

  // 兜底
  return result(
    raw || 'Unknown error',
    'Review the raw error and retry.',
    raw || '未知错误',
    '请查看原始错误并重试。',
  );
}
