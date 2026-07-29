/** 逐条确认写回与旧 CD review 列安全迁移测试。 */
import assert from 'node:assert/strict';
import {
  ensureReviewOutputSchema,
  writeConfirmedReviewItem,
  writeConfirmedReviewItems,
} from '../lib/feishu-sheets.js';

globalThis.chrome = {
  runtime: {
    lastError: null,
    sendMessage(_message, callback) {
      callback({ error: 'credentials_not_used_in_fixture' });
    },
  },
};

function installFetch(rows) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const call = {
      url: decodeURIComponent(String(url)),
      method: options.method || 'GET',
      body: options.body || '',
    };
    calls.push(call);
    const body = call.method === 'GET'
      ? { code: 0, data: { valueRange: { values: rows } } }
      : { code: 0, data: {} };
    return {
      ok: true,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
  return calls;
}

const legacyHeader = [
  'Best TM Match',
  'Orig Match %',
  'Rewritten Segment',
  'New Match %',
  'Reached 85%?',
  'CD review valid?',
];

{
  const calls = installFetch([legacyHeader, ['', '', '', '', '', '']]);
  const result = await ensureReviewOutputSchema({
    feishuUserAccessToken: 'user-token',
    spreadsheetToken: 'SP',
    sheetId: 'SHT',
    sheetLayout: {
      sourceColumn: 'A',
      dataStartRow: 2,
      outputStartColumn: 'B',
      confirmed: true,
    },
  }, 2);
  assert.equal(result.migrated, true);
  const update = calls.find((call) => call.url.includes('values_batch_update'));
  const ranges = JSON.parse(update.body).valueRanges;
  assert.equal(ranges[0].range, 'SHT!G1:G1');
  assert.equal(ranges[0].values[0][0], 'Final TM %');
}

{
  const calls = installFetch([legacyHeader, ['', '', '', '', '', 'Yes']]);
  await assert.rejects(
    ensureReviewOutputSchema({
      feishuUserAccessToken: 'user-token',
      spreadsheetToken: 'SP',
      sheetId: 'SHT',
      sheetLayout: {
        sourceColumn: 'A',
        dataStartRow: 2,
        outputStartColumn: 'B',
        confirmed: true,
      },
    }, 2),
    /legacy_cd_review_data_conflict/,
  );
  assert.equal(calls.some((call) => call.url.includes('values_batch_update')), false);
}

{
  const currentHeader = [
    'Best TM Match',
    'Orig Match %',
    'Rewritten Segment',
    'Post-TM %',
    'Reached 85%?',
    'Final TM %',
  ];
  const calls = installFetch([currentHeader, ['', '', '', '', '', '']]);
  const written = await writeConfirmedReviewItem({
    row: 2,
    tm_source: 'Send Gift',
    similarity: 70,
    final_source_text: 'Send a Gift',
    post_rewrite_tm: { status: 'complete', score: 88 },
    final_tm: { status: 'complete', score: 91 },
  }, {
    feishuUserAccessToken: 'user-token',
    spreadsheetToken: 'SP',
    sheetId: 'SHT',
    sheetLayout: {
      sourceColumn: 'A',
      dataStartRow: 2,
      outputStartColumn: 'B',
      confirmed: true,
    },
  });
  assert.equal(written, 1);
  const updates = calls.filter((call) => call.url.includes('values_batch_update'));
  assert.equal(updates.length, 1);
  const ranges = JSON.parse(updates[0].body).valueRanges;
  assert.deepEqual(ranges.map((entry) => entry.range), [
    'SHT!B2:B2',
    'SHT!C2:C2',
    'SHT!D2:D2',
    'SHT!E2:E2',
    'SHT!F2:F2',
    'SHT!G2:G2',
  ]);
  assert.deepEqual(ranges.map((entry) => entry.values[0][0]), [
    'Send Gift', 70, 'Send a Gift', 88, 'TRUE', 91,
  ]);
}

{
  const currentHeader = [
    'Best TM Match',
    'Orig Match %',
    'Rewritten Segment',
    'Post-TM %',
    'Reached 85%?',
    'Final TM %',
  ];
  const calls = installFetch([
    currentHeader,
    ['', '', '', '', '', ''],
    ['', '', '', '', '', ''],
    ['', '', '', '', '', ''],
  ]);
  const written = await writeConfirmedReviewItems([
    {
      row: 2,
      tm_source: 'Waiting for the party star',
      similarity: 51,
      final_source_text: 'Join the after-party',
      post_rewrite_tm: { status: 'complete', score: 98 },
      final_tm: { status: 'complete', score: 98 },
    },
    {
      row: 3,
      tm_source: 'Special Fly Love lock',
      similarity: 55,
      final_source_text: 'Special LIVE Love Lock',
      post_rewrite_tm: { status: 'complete', score: 88 },
      final_tm: { status: 'complete', score: 90 },
    },
    {
      row: 5,
      tm_source: 'Add more perks',
      similarity: 59,
      final_source_text: 'Add another perk',
      post_rewrite_tm: { status: 'complete', score: 87 },
      final_tm: { status: 'complete', score: 89 },
    },
  ], {
    feishuUserAccessToken: 'user-token',
    spreadsheetToken: 'SP',
    sheetId: 'SHT',
    sheetLayout: {
      sourceColumn: 'A',
      dataStartRow: 2,
      outputStartColumn: 'B',
      confirmed: true,
    },
  });
  assert.equal(written, 3);
  const updates = calls.filter((call) => call.url.includes('values_batch_update'));
  assert.equal(updates.length, 1);
  const ranges = JSON.parse(updates[0].body).valueRanges;
  assert.deepEqual(ranges.map((entry) => entry.range), ['SHT!B2:G3', 'SHT!B5:G5']);
  assert.deepEqual(ranges[0].values, [
    ['Waiting for the party star', 51, 'Join the after-party', 98, 'TRUE', 98],
    ['Special Fly Love lock', 55, 'Special LIVE Love Lock', 88, 'TRUE', 90],
  ]);
}

await assert.rejects(
  writeConfirmedReviewItems([
    {
      row: 2,
      final_source_text: 'Incomplete',
      final_tm: { status: 'incomplete', reason: 'timeout' },
    },
  ], {
    feishuUserAccessToken: 'user-token',
    spreadsheetToken: 'SP',
    sheetId: 'SHT',
  }),
  /final_tm_incomplete/,
);

{
  const currentHeader = [
    'Best TM Match',
    'Orig Match %',
    'Rewritten Segment',
    'Post-TM %',
    'Reached 85%?',
    'Final TM %',
  ];
  const calls = installFetch([currentHeader]);
  const items = Array.from({ length: 1000 }, (_, index) => ({
    row: index + 2,
    tm_source: `TM source ${index + 1}`,
    similarity: 55,
    final_source_text: `Final source ${index + 1}`,
    post_rewrite_tm: { status: 'complete', score: 88 },
    final_tm: { status: 'complete', score: 90 },
  }));
  assert.equal(await writeConfirmedReviewItems(items, {
    feishuUserAccessToken: 'user-token',
    spreadsheetToken: 'SP',
    sheetId: 'SHT',
    sheetLayout: {
      sourceColumn: 'A',
      dataStartRow: 2,
      outputStartColumn: 'B',
      confirmed: true,
    },
  }), 1000);
  const updates = calls.filter((call) => call.url.includes('values_batch_update'));
  assert.equal(updates.length, 1);
  const ranges = JSON.parse(updates[0].body).valueRanges;
  assert.deepEqual(ranges.map((entry) => entry.range), ['SHT!B2:G501', 'SHT!B502:G1001']);
}

console.log('feishu review workflow tests: passed');
