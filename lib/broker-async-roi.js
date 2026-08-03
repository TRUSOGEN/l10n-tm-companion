/**
 * Async ROI broker workflow bridge.
 *
 * This module adds a broker-backed execution path without deleting the local
 * synchronous path. It is deliberately small: existing popup code decides when
 * to create / confirm / archive a broker run and keeps the six-column Working
 * Sheet writeback in the extension. The broker owns Starling TM scoring,
 * persistence across Side Panel close/reopen and background archive scheduling.
 *
 * Final submissions are staged through a pending/outbox queue:
 *   - Working Sheet 写入成功后，先把 confirmed 记录入队 pending_final_submissions 并持久化 snapshot；
 *   - 然后顺序调用 broker submitRoiFinal；
 *   - 成功后移入 completed_final_submissions 并推进 revision；
 *   - 失败（非 revision conflict）保留 pending，待 Side Panel 重开时自动 replay；
 *   - 遇到 revision conflict 时，先 fetchBrokerRun 同步最新 revision，再重试当前条目；
 *   - archive 前必须确保 pending 为空，否则阻塞并给出明确原因。
 */

import {
  archiveRoiRun,
  createRoiRun,
  getBrokerAuthorizationStatus,
  getRoiRun,
  revokeBrokerAuthorization,
  startBrokerAuthorization,
  submitRoiFinal,
} from './backend-broker-client.js';
import { sha256Text } from './hash-utils.js';

export const BROKER_WORKFLOW_VERSION = 1;
export const BROKER_FEATURE_FLAG_KEY = 'l10nAsyncRoiBrokerEnabled';
export const BROKER_WORKFLOW_SNAPSHOT_KEY = 'l10nAsyncRoiBrokerRun';
export const BROKER_DEFAULT_POLL_INTERVAL_MS = 2500;
export const BROKER_REVISION_CONFLICT_RETRY = 1;

function isRevisionConflictError(error, response) {
  if (response && (response.status === 409 || response.conflict === true || response.revision_conflict === true)) {
    return true;
  }
  const message = error && (error.message || String(error));
  if (!message) return false;
  return /\b(409|conflict|revision[_ -]?conflict|expected_revision|version[_ -]?conflict)\b/i.test(message);
}

export async function isBrokerAsyncRoiEnabled() {
  const result = await chrome.storage.local.get(BROKER_FEATURE_FLAG_KEY);
  return result[BROKER_FEATURE_FLAG_KEY] === true;
}

export async function setBrokerAsyncRoiEnabled(enabled) {
  await chrome.storage.local.set({ [BROKER_FEATURE_FLAG_KEY]: Boolean(enabled) });
}

export async function connectFeishuBroker({ returnUrl = '' } = {}) {
  return startBrokerAuthorization({ returnUrl });
}

export async function disconnectFeishuBroker() {
  return revokeBrokerAuthorization();
}

export async function getFeishuBrokerStatus() {
  return getBrokerAuthorizationStatus();
}

export async function canonicalSourceHash(text) {
  return sha256Text(normalizeCanonicalText(text));
}

function normalizeCanonicalText(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .normalize('NFC');
}

function normalizeSnapshotShape(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  const out = { ...snapshot };
  if (!Array.isArray(out.pending_final_submissions)) out.pending_final_submissions = [];
  if (!out.completed_final_submissions || typeof out.completed_final_submissions !== 'object') {
    out.completed_final_submissions = {};
  }
  if (!out.final_submissions || typeof out.final_submissions !== 'object') {
    out.final_submissions = out.final_submissions || {};
  }
  if (typeof out.revision !== 'number') out.revision = Number(out.revision || 1);
  return out;
}

export async function persistBrokerRunSnapshot(snapshot) {
  if (!snapshot || !snapshot.run_id) return;
  const safe = normalizeSnapshotShape(snapshot);
  await chrome.storage.local.set({
    [BROKER_WORKFLOW_SNAPSHOT_KEY]: {
      ...safe,
      persisted_at: new Date().toISOString(),
    },
  });
}

export async function clearBrokerRunSnapshot() {
  await chrome.storage.local.remove(BROKER_WORKFLOW_SNAPSHOT_KEY);
}

export async function loadBrokerRunSnapshot() {
  const data = await chrome.storage.local.get(BROKER_WORKFLOW_SNAPSHOT_KEY);
  return normalizeSnapshotShape(data[BROKER_WORKFLOW_SNAPSHOT_KEY] || null);
}

export async function buildBrokerRunPayload({
  clientRunId,
  startedAt,
  sourceLocale,
  targetLocale,
  projectIds,
  projects,
  sheet,
  items,
}) {
  const safeItems = Array.isArray(items) ? items : [];
  const hashedItems = await Promise.all(safeItems.map(async (item) => {
    const resolvedSourceHash = item.source_hash || await canonicalSourceHash(item.source_text);
    return {
      item_id: item.item_id || item.id,
      source_key: item.source_key || item.id,
      sheet_row: Number(item.sheet_row || item.row || 0),
      source_text: item.source_text,
      source_hash: resolvedSourceHash,
    };
  }));
  return {
    body: {
      client_run_id: clientRunId,
      started_at: startedAt || new Date().toISOString(),
      sheet,
      projects: projects || (projectIds || []).map((id) => ({ project_id: String(id), name: String(id) })),
      display_scope: {
        source_locale: sourceLocale,
        target_locale: targetLocale,
        project_ids: (projectIds || []).map(String),
      },
      items: hashedItems,
    },
  };
}

function offsetColumnForReceipt(column, offset) {
  const base = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let index = 0;
  for (const ch of String(column || '').toUpperCase()) {
    if (!base.includes(ch)) return column;
    index = index * 26 + base.indexOf(ch) + 1;
  }
  index += offset;
  let result = '';
  while (index > 0) {
    const remainder = (index - 1) % 26;
    result = base[remainder] + result;
    index = Math.floor((index - 1) / 26);
  }
  return result;
}

export async function buildSheetReceipt({ config, item, finalText, outputStartColumn }) {
  if (!config?.spreadsheetToken || !config?.sheetId || !item?.row || !outputStartColumn) return null;
  const lastCol = offsetColumnForReceipt(outputStartColumn, 5);
  const outputRange = `${outputStartColumn}${item.row}:${lastCol}${item.row}`;
  const output_hash = await sha256Text(normalizeCanonicalText(finalText) + ':written');
  return {
    document_token: String(config.spreadsheetToken),
    sheet_id: String(config.sheetId),
    row: Number(item.row),
    output_range: outputRange,
    output_hash,
  };
}

export async function createBrokerRun(payload) {
  const response = await createRoiRun(payload);
  if (response?.run_id) {
    await persistBrokerRunSnapshot({
      run_id: response.run_id,
      revision: Number(response.revision || 1),
      created_at: new Date().toISOString(),
      payload: payload.body || payload,
      final_submissions: {},
      pending_final_submissions: [],
      completed_final_submissions: {},
    });
  }
  return response;
}

/**
 * 将一条 Sheet 写入成功后的 confirmed 记录放入 pending outbox，并返回最新 snapshot。
 * 注意：此函数只负责“入队 + 持久化”，不直接调用 broker；调用方随后应调用
 * replayPendingBrokerFinals 以稳定顺序逐条提交，这样无论是单条还是批量确认都
 * 能复用同一套失败重试 / conflict 恢复 / archive 阻塞逻辑。
 */
export async function enqueueBrokerFinalSubmission({
  runId,
  itemId,
  finalText,
  confirmedAt,
  sheetWriteReceipt,
  displayFinalTm,
  sheetRow,
} = {}) {
  const safeRunId = runId || (await loadBrokerRunSnapshot())?.run_id;
  if (!safeRunId) return null;
  const snapshot = normalizeSnapshotShape((await loadBrokerRunSnapshot()) || { run_id: safeRunId, revision: 1 });
  snapshot.run_id = safeRunId;
  const key = String(itemId || (sheetRow != null ? `row-${sheetRow}` : `item-${Date.now()}`));
  const final_text = String(finalText || '');
  const final_text_hash = await sha256Text(normalizeCanonicalText(final_text));
  const completed = snapshot.completed_final_submissions[key];
  // 已经以相同 final_text_hash 提交成功，则不再重复入队（幂等）。
  if (completed && completed.final_text_hash === final_text_hash) {
    return snapshot;
  }
  // 若 pending 中已有相同 key 的旧记录，覆盖为最新的 final/sheet receipt，保持稳定顺序。
  const existingIndex = snapshot.pending_final_submissions.findIndex((e) => e && e.item_id === key);
  const entry = {
    item_id: key,
    sheet_row: Number(sheetRow || 0),
    final_text,
    final_text_hash,
    confirmed_at: confirmedAt || new Date().toISOString(),
    sheet_write_receipt: sheetWriteReceipt || null,
    display_final_tm: displayFinalTm || null,
    enqueued_at: new Date().toISOString(),
    attempts: 0,
  };
  if (existingIndex >= 0) {
    snapshot.pending_final_submissions[existingIndex] = entry;
  } else {
    snapshot.pending_final_submissions.push(entry);
  }
  await persistBrokerRunSnapshot(snapshot);
  return snapshot;
}

/**
 * 顺序重放 pending_final_submissions：
 *   - 每条都使用当前 snapshot.revision 作为 expected_revision；
 *   - 成功：移入 completed_final_submissions，更新 revision，持久化；
 *   - revision conflict：fetchBrokerRun 刷新 revision，最多重试 BROKER_REVISION_CONFLICT_RETRY 次；
 *   - 其它错误：停止重放，保留当前及后续条目为 pending，等待下次恢复。
 *
 * 可注入 submitRoiFinal / getRoiRun 以便测试 stub。
 */
export async function replayPendingBrokerFinals({
  runId,
  submitClient = submitRoiFinal,
  fetchClient = getRoiRun,
} = {}) {
  const snapshot = normalizeSnapshotShape(await loadBrokerRunSnapshot());
  const safeRunId = runId || snapshot?.run_id;
  if (!safeRunId) return { submitted: 0, remaining: 0 };
  if (!snapshot || snapshot.run_id !== safeRunId) {
    return { submitted: 0, remaining: 0 };
  }
  let working = normalizeSnapshotShape(snapshot);
  let submitted = 0;
  let index = 0;
  while (index < working.pending_final_submissions.length) {
    const entry = working.pending_final_submissions[index];
    if (!entry) { index += 1; continue; }
    let attempt = 0;
    let delivered = false;
    let lastError = null;
    while (attempt <= BROKER_REVISION_CONFLICT_RETRY) {
      attempt += 1;
      entry.attempts = Number(entry.attempts || 0) + 1;
      try {
        const response = await submitClient(safeRunId, entry.item_id, {
          body: {
            expected_revision: Number(working.revision || 1),
            final_text: entry.final_text,
            final_text_hash: entry.final_text_hash,
            confirmed_at: entry.confirmed_at,
            sheet_write_receipt: entry.sheet_write_receipt,
            display_final_tm: entry.display_final_tm,
          },
        });
        const nextRevision = Number(response?.revision);
        if (nextRevision > 0) working.revision = nextRevision;
        working.final_submissions = working.final_submissions || {};
        working.final_submissions[entry.item_id] = {
          final_text_hash: entry.final_text_hash,
          confirmed_at: entry.confirmed_at,
          sheet_write_receipt: entry.sheet_write_receipt,
          submitted_at: new Date().toISOString(),
        };
        working.completed_final_submissions[entry.item_id] = {
          ...entry,
          submitted_at: new Date().toISOString(),
          revision: working.revision,
        };
        working.pending_final_submissions.splice(index, 1);
        submitted += 1;
        delivered = true;
        await persistBrokerRunSnapshot(working);
        break;
      } catch (error) {
        lastError = error;
        if (isRevisionConflictError(error)) {
          try {
            const latest = await fetchClient(safeRunId);
            const refreshed = Number(latest?.revision);
            if (refreshed > 0) working.revision = refreshed;
            await persistBrokerRunSnapshot(working);
            continue;
          } catch (refreshError) {
            lastError = refreshError;
            break;
          }
        }
        break;
      }
    }
    if (!delivered) {
      // 保留 pending，停止重放，等待下次 Side Panel 打开时自动 replay。
      await persistBrokerRunSnapshot(working);
      return {
        submitted,
        remaining: working.pending_final_submissions.length,
        error: lastError,
        stoppedAt: entry.item_id,
      };
    }
    // delivered 后 index 不递增，因为 splice 后下一条已经移动到当前 index。
  }
  await persistBrokerRunSnapshot(working);
  return { submitted, remaining: 0 };
}

export function countPendingBrokerFinalSubmissions(snapshot) {
  const safe = normalizeSnapshotShape(snapshot);
  if (!safe?.run_id) return 0;
  return Array.isArray(safe.pending_final_submissions) ? safe.pending_final_submissions.length : 0;
}

/** archive 前阻塞检查：存在 pending final 时返回 { blocked: true, reason, count }，否则返回 { blocked: false }。 */
export function canArchiveBrokerRun(snapshot) {
  const count = countPendingBrokerFinalSubmissions(snapshot);
  if (count > 0) {
    return {
      blocked: true,
      reason: `broker_pending_final_submissions:${count}`,
      count,
    };
  }
  return { blocked: false };
}

export async function submitBrokerFinal({ runId, itemId, revision, finalText, confirmedAt, sheetWriteReceipt, displayFinalTm }) {
  // 兼容旧调用：直接转发为 enqueue + replay，保证外部旧引用不会破坏 pending 队列语义。
  await enqueueBrokerFinalSubmission({
    runId,
    itemId,
    finalText,
    confirmedAt,
    sheetWriteReceipt,
    displayFinalTm,
  });
  const result = await replayPendingBrokerFinals({ runId });
  const snapshot = await loadBrokerRunSnapshot();
  const final_text_hash = await sha256Text(normalizeCanonicalText(finalText));
  return {
    run_id: runId,
    revision: Number(snapshot?.revision || revision || 1),
    submitted: result.submitted,
    remaining: result.remaining,
    body: {
      expected_revision: Number(revision || snapshot?.revision || 1),
      final_text: finalText,
      final_text_hash,
      confirmed_at: confirmedAt || new Date().toISOString(),
      sheet_write_receipt: sheetWriteReceipt || null,
      display_final_tm: displayFinalTm || null,
    },
  };
}

export async function requestBrokerArchive({ runId, revision, requestedAt }) {
  const snapshot = normalizeSnapshotShape(await loadBrokerRunSnapshot());
  const guard = canArchiveBrokerRun(snapshot);
  if (guard.blocked) {
    const error = new Error(`Cannot archive broker run: ${guard.count} pending final submission(s) must be replayed first.`);
    error.code = 'broker_pending_final_submissions';
    error.pendingCount = guard.count;
    throw error;
  }
  const expectedRevision = Number(revision || snapshot?.revision || 1);
  return archiveRoiRun(runId, {
    body: {
      expected_revision: expectedRevision,
      requested_at: requestedAt || new Date().toISOString(),
    },
  });
}

export async function fetchBrokerRun(runId) {
  return getRoiRun(runId);
}

export async function pollBrokerRunUntil({ runId, predicate, intervalMs = BROKER_DEFAULT_POLL_INTERVAL_MS, timeoutMs = 30000 }) {
  const start = Date.now();
  while (true) {
    const status = await fetchBrokerRun(runId);
    if (predicate(status)) return status;
    if (Date.now() - start > timeoutMs) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
