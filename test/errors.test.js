// 验证 lib/errors.js：可操作错误提示（T23）
import { friendlyError } from '../lib/errors.js';

let pass = 0, fail = 0;
const assert = (n, c, e = '') => c ? (pass++, console.log(`  ✅ ${n}`)) : (fail++, console.log(`  ❌ ${n} ${e}`));

console.log('\n=== errors: friendlyError 可操作提示 ===');
{
  // Native host
  const e1 = friendlyError('Error when communicating with the native messaging host');
  assert('native host → title', e1.title.includes('Native Messaging Host'));
  assert('native host → action 含 register', /register-native-host/.test(e1.action));

  // 飞书权限
  const e2 = friendlyError('Access denied. scopes required: [sheets:spreadsheet]');
  assert('英文默认权限 → title', e2.title.includes('permission'));
  assert('英文默认权限 → action 含细分 Sheet scope + reauthorize',
    /sheets:spreadsheet\.meta:read/.test(e2.action) && /authorize again/.test(e2.action));

  // token 缺失
  const e3 = friendlyError('未配置电子表格 token');
  assert('token → action 含贴 URL', /URL/.test(e3.action));

  // 凭证
  const e4 = friendlyError('app secret invalid');
  assert('凭证 → action 含 App ID/Secret', /App ID/.test(e4.action));

  // 无效链接
  const e5 = friendlyError('非 sheets URL');
  assert('链接 → action 含 /sheets/ 或 /base/', /\/sheets\/|\/base\//.test(e5.action));

  // TM 不可用
  const e6 = friendlyError('TM 查询失败：CLI Timeout');
  assert('TM → action 含 starling-cli', /starling-cli/.test(e6.action));

  // PPE 远端超时：不能误导用户去检查本机 AK/SK
  const e6a = friendlyError(
    'Starling batch TM HTTP 400: remote or network error[remote]: error_code=1204 request timeout (logid: test-logid)'
  );
  assert('PPE 1204 → 明确服务超时', e6a.title.includes('PPE') && e6a.title.includes('timeout'));
  assert('PPE 1204 → 建议稍后重试', /Retry later/.test(e6a.action));
  assert('PPE 1204 → 不误导 AK/SK', !/AK\/SK/.test(e6a.action));

  // 无法与页面通信
  const e7 = friendlyError('无法与页面通信，原因: no receiving end');
  assert('通信 → 英文 action', /Feishu document/.test(e7.action));

  // 中文模式必须从同一错误分类返回完整中文。
  const zhPermission = friendlyError('Access denied. scopes required: [sheets:spreadsheet]', 'zh-CN');
  assert('中文权限 → title', zhPermission.title.includes('权限'));
  assert('中文权限 → action 含重新授权', /重新授权/.test(zhPermission.action));
  const zhTimeout = friendlyError('remote or network error: error_code=1204', 'zh-CN');
  assert('中文 PPE 超时 → title', zhTimeout.title.includes('超时'));

  // 兜底
  const e8 = friendlyError('something unexpected');
  assert('兜底 → title=原始', e8.title === 'something unexpected');
  assert('兜底 → raw 保留', e8.raw === 'something unexpected');
  assert('兜底 → action 非空', e8.action.length > 0);

  // Error 对象
  const e9 = friendlyError(new Error('Error when communicating with the native messaging host'));
  assert('Error 对象也识别', e9.title.includes('Native Messaging Host'));

  // 空/null
  const e10 = friendlyError(null);
  assert('null 不崩溃', typeof e10.title === 'string');

  const workingSheet = friendlyError(
    'No working sheet configured. Stored keys: starlingProjectIds, targetLang',
    'zh-CN',
  );
  assert('Working spreadsheet 缺失不误判为 TM', workingSheet.title === '未设置工作表');
}

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`);
if (fail > 0) process.exit(1);
