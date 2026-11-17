const test = require('node:test');
const assert = require('node:assert/strict');
const { formatLocalTimestamp } = require('../src/utils/time');
const TeleWorker = require('../src/worker/worker');
const MultiProjectWorker = require('../src/worker/multi_worker');

test('Time utils - formatLocalTimestamp memformat waktu sesuai jam lokal workstation (bukan UTC)', () => {
  const sample = new Date(2026, 10, 17, 10, 22, 5); // 2026-11-17 10:22:05 waktu lokal
  assert.equal(formatLocalTimestamp(sample), '2026-11-17 10:22:05');

  const pad = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const expectedPrefix = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:`;
  assert.ok(formatLocalTimestamp(now).startsWith(expectedPrefix));

  assert.equal(formatLocalTimestamp('invalid-date'), '');
});

test('Worker logger - TeleWorker dan MultiProjectWorker mencatat waktu lokal workstation', () => {
  const logs = [];
  const origLog = console.log;
  console.log = (msg) => logs.push(msg);
  try {
    const pad = (n) => String(n).padStart(2, '0');
    const before = new Date();
    const expectedDate = `${before.getFullYear()}-${pad(before.getMonth() + 1)}-${pad(before.getDate())}`;
    const expectedHour = pad(before.getHours());

    const w = new TeleWorker({ workerId: 'w-test', workDir: process.cwd() });
    w.log('Uji logger worker');

    const mw = new MultiProjectWorker();
    mw.log('Uji logger multi-worker');

    assert.equal(logs.length, 2);
    assert.match(logs[0], new RegExp(`^\\[${expectedDate} ${expectedHour}:\\d{2}:\\d{2}\\] \\[w-test\\] Uji logger worker$`));
    assert.match(logs[1], new RegExp(`^\\[${expectedDate} ${expectedHour}:\\d{2}:\\d{2}\\] \\[multi-worker\\] Uji logger multi-worker$`));
  } finally {
    console.log = origLog;
  }
});
