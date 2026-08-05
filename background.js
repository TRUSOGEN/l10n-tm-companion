/**
 * background.js — Service Worker
 *
 * 协调各模块通信，转发消息：
 *   popup ↔ content script (extract_all / extract_selection)
 *   popup ↔ native messaging host (native_search_tm)
 *
 * MV3 注意：
 *   - Service Worker 无持久状态，所有状态用 chrome.storage
 *   - chrome.runtime.sendNativeMessage 仅在此处可用
 */

const NATIVE_HOST = 'com.l10n.tm_companion';

/**
 * 后台日志脱敏：Service Worker 是 classic script，无法复用 ESM 的 lib/ui-errors.js，
 * 因此这里只输出错误类型与错误代码，绝不输出 error.message 或 error 对象本身，
 * 从根上保证 secret / access key / token 不会进入后台日志。
 * @param {unknown} error
 * @returns {string} 形如 `Error (E_CODE)` 的脱敏描述
 */
function describeErrorForLog(error) {
  const name = (error && typeof error === 'object' && error.name) ? String(error.name) : 'Error';
  const code = (error && typeof error === 'object' && (error.code ?? error.status)) ?? null;
  return code === null || code === undefined || code === '' ? name : `${name} (${String(code)})`;
}

// 点击扩展图标直接打开持久 Side Panel，避免 Popup 失焦关闭和固定高度截断结果。
chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => {
  console.warn('[bg] Side Panel behavior setup failed:', describeErrorForLog(error));
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.action) return false;
  console.log('[bg] 收到消息:', msg.action);

  switch (msg.action) {
    // === 转发到 Content Script：抓取飞书文案 ===
    case 'extract_all':
    case 'extract_selection':
      console.log('[bg] 转发到 active tab:', msg.action);
      forwardToActiveTab(msg, sendResponse);
      return true; // 异步响应

    // === 转发到 Native Host：Starling TM 查询 ===
    case 'native_search_tm':
      chrome.runtime.sendNativeMessage(NATIVE_HOST, msg.payload, (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message });
        } else {
          sendResponse(response);
        }
      });
      return true; // 异步响应

    // === 转发到 Native Host：LLM 调用（绕过浏览器 CORS，由 Python 直连网关）===
    case 'native_llm_call':
      chrome.runtime.sendNativeMessage(NATIVE_HOST, msg.payload, (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message });
        } else {
          sendResponse(response);
        }
      });
      return true; // 异步响应

    // === 转发到 Native Host：飞书 ROI 归档用户 OAuth ===
    case 'native_feishu_oauth_info':
    case 'native_feishu_user_oauth':
    case 'native_feishu_credentials':
      chrome.runtime.sendNativeMessage(NATIVE_HOST, msg.payload, (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message });
        } else {
          sendResponse(response);
        }
      });
      return true; // OAuth 回调期间保持消息通道，直到本机授权完成

    // === 转发到 Native Host：Broker OAuth / 异步 ROI ===
    case 'native_broker_request':
      chrome.runtime.sendNativeMessage(NATIVE_HOST, {
        action: 'native_broker_request',
        payload: msg.payload,
      }, (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message });
        } else {
          sendResponse(response);
        }
      });
      return true;

    default:
      sendResponse({ error: `Unknown action: ${msg.action}` });
      return false;
  }
});

/**
 * 把消息转发给当前激活标签页的 content script。
 * 若 sendMessage 失败（content script 未注入——常见于扩展重载后未刷新的 wiki 标签页），
 * 用 chrome.scripting 程序化注入 content.js 再重试一次。
 */
function forwardToActiveTab(msg, sendResponse) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs?.[0];
    console.log('[bg] active tab:', tab?.id, tab?.url);
    if (!tab?.id) {
      sendResponse({ error: 'No active tab found' });
      return;
    }

    chrome.tabs.sendMessage(tab.id, msg, async (response) => {
      const lastErr = chrome.runtime.lastError;
      console.log('[bg] sendMessage 返回, lastError:', lastErr ? describeErrorForLog(lastErr) : 'none');
      // 没报错 → 正常返回
      if (!lastErr) {
        sendResponse(response);
        return;
      }

      // 报错通常是「Receiving end does not exist」——content script 未注入。
      // 兜底：程序化化注入 content.js 后重试一次。
      console.log('[bg] content script 未注入，尝试兜底注入 content.js...');
      const injected = await injectContentScriptIfNeeded(tab.id);
      console.log('[bg] 兜底注入结果:', injected);
      if (!injected) {
        sendResponse({
          error:
            'Cannot communicate with the page. Please make sure the active tab is a Feishu doc page ' +
            '(feishu.cn/docx/*, larksuite.com/docx/*, or larkoffice.com/wiki/*). ' +
            `Reason: ${lastErr.message}`
        });
        return;
      }

      chrome.tabs.sendMessage(tab.id, msg, (resp2) => {
        const e2 = chrome.runtime.lastError;
        console.log('[bg] 重试 sendMessage 返回, lastError:', e2 ? describeErrorForLog(e2) : 'none');
        if (e2) {
          sendResponse({
            error:
              'Cannot communicate with the page (tried injecting content script, still failed). ' +
              'Please refresh the Feishu doc page and retry. Reason: ' +
              e2.message
          });
          return;
        }
        sendResponse(resp2);
      });
    });
  });
}

/**
 * 程序化注入 content.js（兜底注入）。扩展已声明 scripting 权限与 larkoffice host 权限。
 * @returns {Promise<boolean>} 是否注入成功
 */
async function injectContentScriptIfNeeded(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
    return true;
  } catch (e) {
    // 可能是受限页面（chrome:// 等）或无 host 权限
    console.warn('content.js 兜底注入失败（已脱敏）:', describeErrorForLog(e));
    return false;
  }
}
