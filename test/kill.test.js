const test = require('node:test');
const assert = require('node:assert');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TeleWorker = require('../src/worker/worker');
const { parseKillArgs } = require('../src/cli/commands/task_ctl');
const {
  normalizeTaskId,
  matchesTaskId,
  killProcessTree,
  writeActiveTask,
  readActiveTask,
  clearActiveTask
} = require('../src/utils/process');

test('Process utils - normalizeTaskId dan matchesTaskId menangani variasi format ID', () => {
  assert.strictEqual(normalizeTaskId('#TASK-92fe'), 'TASK-92fe');
  assert.strictEqual(normalizeTaskId('  ##TASK-92fe  '), 'TASK-92fe');
  assert.strictEqual(matchesTaskId('#TASK-92fe', 'TASK-92fe'), true);
  assert.strictEqual(matchesTaskId('#TASK-92fe', '92fe'), true);
  assert.strictEqual(matchesTaskId('task-92fe', '#TASK-92FE'), true);
  assert.strictEqual(matchesTaskId('TASK-92fe', 'TASK-abcd'), false);
  assert.strictEqual(matchesTaskId('', 'TASK-92fe'), false);
});

test('Process utils - writeActiveTask, readActiveTask, dan clearActiveTask bekerja konsisten', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tele-kill-test-'));
  try {
    writeActiveTask(tmpDir, { taskId: '#TASK-92fe', pid: 12345, workerId: 'w1' });
    const loaded = readActiveTask(tmpDir);
    assert.ok(loaded);
    assert.strictEqual(loaded.taskId, '#TASK-92fe');
    assert.strictEqual(loaded.pid, 12345);

    // Clear with non-matching ID must not remove
    clearActiveTask(tmpDir, 'TASK-other');
    assert.ok(readActiveTask(tmpDir));

    // Clear with matching ID removes file
    clearActiveTask(tmpDir, '92fe');
    assert.strictEqual(readActiveTask(tmpDir), null);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Process utils - killProcessTree menghentikan child process aktif', async () => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
    stdio: 'ignore'
  });

  assert.ok(child.pid > 0);
  const exitPromise = new Promise((resolve) => {
    child.on('exit', (code, signal) => resolve({ code, signal }));
  });

  const killed = killProcessTree(child.pid);
  assert.strictEqual(killed, true);

  const res = await exitPromise;
  assert.ok(res.code !== 0 || res.signal !== null);
});

test('Worker - parseKillCommand mem-parsing /kill dengan berbagai format', () => {
  assert.deepStrictEqual(TeleWorker.parseKillCommand('/kill TASK-92fe'), {
    targetTaskId: 'TASK-92fe',
    reason: ''
  });
  assert.deepStrictEqual(TeleWorker.parseKillCommand('/kill #TASK-92fe terlalu lama'), {
    targetTaskId: '#TASK-92fe',
    reason: 'terlalu lama'
  });
  assert.deepStrictEqual(TeleWorker.parseKillCommand('/kill@TeleBot 92fe'), {
    targetTaskId: '92fe',
    reason: ''
  });
  assert.deepStrictEqual(TeleWorker.parseKillCommand('/kill'), {
    targetTaskId: null,
    reason: ''
  });
  assert.strictEqual(TeleWorker.parseKillCommand('Buat /kill task id'), null);
  assert.strictEqual(TeleWorker.parseKillCommand('/status'), null);
});

test('CLI - parseKillArgs mem-parsing taskId, --reason, dan --force', () => {
  assert.deepStrictEqual(parseKillArgs(['TASK-92fe']), {
    taskId: 'TASK-92fe',
    reason: 'Dihentikan paksa (/kill) melalui CLI',
    force: false
  });
  assert.deepStrictEqual(parseKillArgs(['#TASK-92fe', '--reason', 'Macet', '--force']), {
    taskId: '#TASK-92fe',
    reason: 'Macet',
    force: true
  });
  assert.deepStrictEqual(parseKillArgs(['-f', '92fe', '-r', 'Timeout']), {
    taskId: '92fe',
    reason: 'Timeout',
    force: true
  });
});

test('CLI - kerakerja help menampilkan kill dan kerakerja kill tanpa argumen menampilkan panduan', () => {
  const binPath = path.join(__dirname, '..', 'bin', 'kerakerja.js');
  const helpOut = execSync(`node "${binPath}" help`, { encoding: 'utf-8' });
  assert.ok(helpOut.includes('kill <task_id>'));

  const killOut = execSync(`node "${binPath}" kill`, { encoding: 'utf-8' });
  assert.ok(killOut.includes('Penggunaan: kerakerja kill <task_id>'));

  const slashKillOut = execSync(`node "${binPath}" /kill`, { encoding: 'utf-8' });
  assert.ok(slashKillOut.includes('Penggunaan: kerakerja kill <task_id>'));
});
