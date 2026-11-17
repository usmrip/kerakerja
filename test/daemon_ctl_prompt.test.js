const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { spawn } = require('child_process');

const { stopCommand, restartCommand, findActiveJobs } = require('../src/cli/commands/daemon_ctl');
const { writeActiveTask } = require('../src/utils/process');
const { computeNextIndex } = require('../src/utils/prompt');

test('Prompt helper - computeNextIndex memutar pilihan panah atas dan bawah', () => {
  assert.strictEqual(computeNextIndex(0, 'up', 3), 2);
  assert.strictEqual(computeNextIndex(2, 'down', 3), 0);
  assert.strictEqual(computeNextIndex(1, 'down', 3), 2);
});

test('daemon_ctl - stopCommand & restartCommand menawarkan 3 opsi saat ada pekerjaan aktif', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kerakerja-dctl-'));
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { stdio: 'ignore' });
  try {
    // Gunakan PID child process terpisah sebagai simulasi worker background aktif
    fs.writeFileSync(path.join(tmpDir, 'kerakerja-worker.pid'), String(child.pid));
    writeActiveTask(tmpDir, {
      taskId: '#TASK-9999',
      workerPid: child.pid,
      executor: 'cli',
      startedAt: new Date().toISOString()
    });

    const active = findActiveJobs(tmpDir, false);
    assert.strictEqual(active.length, 1);
    assert.strictEqual(active[0].taskId, '#TASK-9999');

    // 1. Pilih "Batal" -> tidak stop & tidak restart
    let killed = false;
    let started = false;
    let seenLabels = [];
    const cancelRes = await restartCommand([], {
      cwd: tmpDir,
      restartDelayMs: 0,
      selectOption: async (title, choices) => {
        seenLabels = choices.map((c) => c.value);
        return choices.find((c) => c.value === 'cancel');
      },
      killWorker: () => { killed = true; },
      startCommand: async () => { started = true; }
    });
    assert.deepStrictEqual(seenLabels, ['wait', 'now', 'cancel']);
    assert.strictEqual(cancelRes.cancelled, true);
    assert.strictEqual(killed, false);
    assert.strictEqual(started, false);

    // 2. Pilih "Selesaikan pekerjaan" (wait) -> menunggu selesai lalu stop & start
    let waited = false;
    const waitRes = await restartCommand([], {
      cwd: tmpDir,
      restartDelayMs: 0,
      selectOption: async (_title, choices) => choices.find((c) => c.value === 'wait'),
      waitForActiveJobs: async () => { waited = true; },
      killWorker: () => { killed = true; },
      startCommand: async () => { started = true; }
    });
    assert.strictEqual(waitRes.cancelled, false);
    assert.strictEqual(waitRes.restarted, true);
    assert.strictEqual(waited, true);
    assert.strictEqual(killed, true);
    assert.strictEqual(started, true);

    // 3. Pilih "Lakukan sekarang" (now) -> langsung stop tanpa menunggu
    fs.writeFileSync(path.join(tmpDir, 'kerakerja-worker.pid'), String(child.pid));
    writeActiveTask(tmpDir, {
      taskId: '#TASK-9999',
      workerPid: child.pid,
      executor: 'cli',
      startedAt: new Date().toISOString()
    });
    let killedNow = false;
    let waitedNow = false;
    const nowRes = await stopCommand([], {
      cwd: tmpDir,
      selectOption: async (_title, choices) => choices.find((c) => c.value === 'now'),
      waitForActiveJobs: async () => { waitedNow = true; },
      killWorker: () => { killedNow = true; }
    });
    assert.strictEqual(nowRes.stopped, true);
    assert.strictEqual(nowRes.cancelled, false);
    assert.strictEqual(killedNow, true);
    assert.strictEqual(waitedNow, false);
  } finally {
    try { child.kill(); } catch (e) {}
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
