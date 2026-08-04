#!/usr/bin/env node
/**
 * Starling batch TM 并发能力测量脚本（人工执行，禁止进 CI）。
 *
 * ⚠️ 重要警告：本脚本会对 Starling 这个**内部共享服务**真实加压。
 * ⚠️ 运行前必须先与 Starling RD 确认可用 QPS 配额；未确认前不要跑高档位。
 * ⚠️ 默认梯度上限（16）已刻意保守，且错误率超阈值会自动停止升档。
 * ⚠️ 请在 PPE 环境（默认）执行，不要拿线上环境做压测。
 *
 * 实现约束：
 * - 不自己实现签名逻辑。每个请求都通过既有 native host 路径发出：
 *   `native-host/starling-bridge.py`（action=search_tm, tm_mode=batch）
 *   → `native-host/starling-batch-client.js` → Starling 官方 StarlingClient 签名。
 * - bridge 主循环一次只处理一条消息，因此「并发 N」= 同时拉起 N 个 bridge 进程，
 *   每个进程内部 `batch_concurrency: 1`，即一个进程恰好一个在飞 HTTP 请求。
 * - 凭据只从环境变量读取（与 bridge 子进程一致的命名：STARLING_ACCESS_KEY /
 *   STARLING_SECRET_KEY），绝不打印到 stdout，也绝不写入任何文件。
 *
 * 用法（凭据用占位符）：
 *   STARLING_ACCESS_KEY=xxx STARLING_SECRET_KEY=yyy \
 *     node scripts/measure-batch-concurrency.mjs --project-ids 123456 --target-locale ja-JP
 *
 * 可选参数：
 *   --levels 1,3,5,8,12,16   并发梯度（默认 1,3,5,8,12,16）
 *   --sources 40             每请求 source 条数（默认 40，Starling 已批准上限）
 *   --rounds 2               每档轮数（默认 2）
 *   --source-locale en       源语言（默认 en）
 *   --target-locale ja-JP    目标语言（默认 ja-JP）
 *   --project-ids 1,2        项目 ID，逗号分隔（必填）
 *   --error-threshold 0.1    错误率阈值，超过则停止升档（默认 0.1）
 *   --python python3         bridge 使用的 Python 解释器（默认 python3）
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE = path.join(SCRIPT_DIR, '..', 'native-host', 'starling-bridge.py');

/** 解析 `--key value` 形式的命令行参数。 */
function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      args[key] = 'true';
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

/** 把逗号分隔字符串解析为正整数数组。 */
function parseIntList(raw, label) {
  const values = String(raw || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => Number(part));
  if (!values.length || values.some((value) => !Number.isInteger(value) || value <= 0)) {
    throw new Error(`${label} 必须是逗号分隔的正整数，例如 1,3,5`);
  }
  return values;
}

/** 生成本次压测使用的 source 文案，避免命中同一条缓存。 */
function buildSources(count, tag) {
  return Array.from(
    { length: count },
    (_, index) => `Concurrency probe ${tag} sentence ${index + 1}: please save your changes before leaving.`,
  );
}

/** 通过 native host 发一条 batch TM 请求，返回耗时与结果分类。 */
function requestOnce({ python, sources, options, credentials }) {
  const message = {
    action: 'search_tm',
    tm_mode: 'batch',
    use_ppe: true,
    texts: sources,
    source_lang: options.sourceLocale,
    target_lang: options.targetLocale,
    project_ids: options.projectIds,
    limit: 3,
    batch_size: sources.length,
    // 每个 bridge 进程只允许一个在飞 HTTP 请求，这样「进程数」就等于真实并发数。
    batch_concurrency: 1,
    access_key: credentials.accessKey,
    secret_key: credentials.secretKey,
  };
  const encoded = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(encoded.length, 0);

  const startedAt = process.hrtime.bigint();
  return new Promise((resolve) => {
    const child = spawn(python, [BRIDGE], { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = [];
    let stderr = '';
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => resolve({
      ok: false,
      durationMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
      errorCode: `spawn_failed:${error.message}`,
    }));
    child.on('close', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const raw = Buffer.concat(chunks);
      if (raw.length < 4) {
        resolve({ ok: false, durationMs, errorCode: classifyError(stderr || 'empty_bridge_output') });
        return;
      }
      const length = raw.readUInt32LE(0);
      let payload;
      try {
        payload = JSON.parse(raw.subarray(4, 4 + length).toString('utf8'));
      } catch {
        resolve({ ok: false, durationMs, errorCode: 'invalid_bridge_json' });
        return;
      }
      if (payload?.error) {
        resolve({ ok: false, durationMs, errorCode: classifyError(payload.error) });
        return;
      }
      const results = Array.isArray(payload?.results) ? payload.results : [];
      if (results.length !== sources.length) {
        resolve({ ok: false, durationMs, errorCode: `count_mismatch:${results.length}` });
        return;
      }
      resolve({ ok: true, durationMs, errorCode: '' });
    });
    child.stdin.end(Buffer.concat([header, encoded]));
  });
}

/** 把错误文本归一化成可统计的错误码，并单独识别限流类错误。 */
function classifyError(raw) {
  const text = String(raw || '').slice(0, 400);
  if (/error_code=1204|\b1204\b/.test(text)) return 'THROTTLE_1204';
  if (/\b429\b|too many requests|rate limit/i.test(text)) return 'THROTTLE_429';
  const httpMatch = text.match(/HTTP (\d{3})/);
  if (httpMatch) return `HTTP_${httpMatch[1]}`;
  if (/timeout|timed out/i.test(text)) return 'TIMEOUT';
  return `OTHER:${text.replace(/\s+/g, ' ').slice(0, 80)}`;
}

/** 计算分位耗时（毫秒，向上取样本）。 */
function percentile(sorted, ratio) {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(ratio * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const accessKey = process.env.STARLING_ACCESS_KEY;
  const secretKey = process.env.STARLING_SECRET_KEY;
  if (!accessKey || !secretKey) {
    throw new Error(
      '缺少 Starling 凭据：请设置环境变量 STARLING_ACCESS_KEY 与 STARLING_SECRET_KEY 后重试'
      + '（凭据只在内存中传给 native host，不会被打印或落盘）。',
    );
  }
  if (!args['project-ids']) {
    throw new Error('缺少 --project-ids：请传入至少一个 Starling 项目 ID，例如 --project-ids 123456');
  }
  const options = {
    projectIds: parseIntList(args['project-ids'], '--project-ids'),
    levels: parseIntList(args.levels || '1,3,5,8,12,16', '--levels'),
    sources: Number(args.sources || 40),
    rounds: Number(args.rounds || 2),
    sourceLocale: args['source-locale'] || 'en',
    targetLocale: args['target-locale'] || 'ja-JP',
    errorThreshold: Number(args['error-threshold'] || 0.1),
  };
  if (!Number.isInteger(options.sources) || options.sources < 1 || options.sources > 40) {
    throw new Error('--sources 必须是 1–40 之间的整数（40 是 Starling 已批准的单请求上限）');
  }
  if (!Number.isInteger(options.rounds) || options.rounds < 1) {
    throw new Error('--rounds 必须是正整数');
  }
  if (!(options.errorThreshold > 0 && options.errorThreshold < 1)) {
    throw new Error('--error-threshold 必须在 0 与 1 之间');
  }
  const python = args.python || 'python3';
  const credentials = { accessKey, secretKey };

  console.log('Starling batch TM 并发测量（PPE）');
  console.log(`项目: ${options.projectIds.join(',')} | ${options.sourceLocale} → ${options.targetLocale}`);
  console.log(`每请求 source 条数: ${options.sources} | 每档轮数: ${options.rounds} | 梯度: ${options.levels.join(',')}`);
  console.log('提醒：这是对内部共享服务加压，请确认已获得 Starling RD 的配额许可。\n');

  for (const level of options.levels) {
    const durations = [];
    const errorCounts = new Map();
    let success = 0;
    let attempted = 0;
    for (let round = 0; round < options.rounds; round += 1) {
      const batch = Array.from({ length: level }, (_, slot) => requestOnce({
        python,
        sources: buildSources(options.sources, `L${level}-R${round}-S${slot}`),
        options,
        credentials,
      }));
      const results = await Promise.all(batch);
      results.forEach((result) => {
        attempted += 1;
        durations.push(result.durationMs);
        if (result.ok) success += 1;
        else errorCounts.set(result.errorCode, (errorCounts.get(result.errorCode) || 0) + 1);
      });
    }
    const sorted = [...durations].sort((a, b) => a - b);
    const errorRate = attempted ? (attempted - success) / attempted : 1;
    const throttled = (errorCounts.get('THROTTLE_1204') || 0) + (errorCounts.get('THROTTLE_429') || 0);
    const errorSummary = errorCounts.size
      ? [...errorCounts.entries()].map(([code, count]) => `${code}×${count}`).join(', ')
      : '无';
    console.log(
      `并发 ${String(level).padStart(2)} | 成功率 ${((1 - errorRate) * 100).toFixed(1)}%`
      + ` | P50 ${percentile(sorted, 0.5).toFixed(0)}ms`
      + ` | P95 ${percentile(sorted, 0.95).toFixed(0)}ms`
      + ` | Max ${(sorted[sorted.length - 1] || 0).toFixed(0)}ms`
      + ` | 限流 ${throttled} | 错误: ${errorSummary}`,
    );
    if (errorRate > options.errorThreshold) {
      console.log(
        `\n错误率 ${(errorRate * 100).toFixed(1)}% 超过阈值 ${(options.errorThreshold * 100).toFixed(1)}%，`
        + `已在并发 ${level} 停止升档，避免继续给 Starling 加压。`,
      );
      console.log(`建议的安全并发上限：不超过 ${level - 1 > 0 ? level - 1 : 1}，并与 Starling RD 复核。`);
      return;
    }
  }
  console.log('\n全部梯度均在阈值内完成。请把结果发给 Starling RD 复核后再调整生产并发。');
}

main().catch((error) => {
  console.error(`测量失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
