const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TeleWorker = require('../src/worker/worker');
const {
  isActiveTaskLocked,
  hasLocalQueueInProgress,
  writeActiveTask,
  readActiveTask
} = require('../src/utils/process');

test('Worker - executor routing membedakan tele-vs-cli dan tele-vs-code', () => {
  assert.strictEqual(TeleWorker.isCliExecutor(''), true);
  assert.strictEqual(TeleWorker.isCliExecutor('all'), true);
  assert.strictEqual(TeleWorker.isCliExecutor('CLI'), true);
  assert.strictEqual(TeleWorker.isCliExecutor('tele-vs-cli'), true);
  assert.strictEqual(TeleWorker.isCliExecutor('headless'), true);
  assert.strictEqual(TeleWorker.isCliExecutor('vscode'), false);
  assert.strictEqual(TeleWorker.isCliExecutor('tele-vs-code'), false);
  assert.strictEqual(TeleWorker.isCliExecutor('ide'), false);

  assert.strictEqual(TeleWorker.isVscodeExecutor('tele-vs-code'), true);
  assert.strictEqual(TeleWorker.isVscodeExecutor('vscode'), true);
  assert.strictEqual(TeleWorker.isVscodeExecutor('cli'), false);

  assert.strictEqual(TeleWorker.isTaskForCliExecutor({ id: 'TASK-1', executor: 'tele-vs-code' }, 'w-cli'), false);
  assert.strictEqual(TeleWorker.isTaskForCliExecutor({ id: 'TASK-2', executor: 'all', worker_id: 'w-vscode' }, 'w-cli'), false);
  assert.strictEqual(TeleWorker.isTaskForCliExecutor({ id: 'TASK-3', executor: 'cli', worker_id: 'w-cli' }, 'w-cli'), true);
  assert.strictEqual(TeleWorker.isTaskForCliExecutor({ id: 'TASK-4', executor: 'all' }, 'w-cli'), true);
});

test('Worker - selectNextCliTask melewati tugas tele-vs-code dan menunda jika ada IN_PROGRESS lain', () => {
  const queueWithVscodeFirst = [
    { id: 'TASK-1', status: 'PENDING', executor: 'tele-vs-code', instruction: 'Edit di IDE' },
    { id: 'TASK-2', status: 'PENDING', executor: 'cli', instruction: 'Jalankan test' }
  ];
  const res1 = TeleWorker.selectNextCliTask(queueWithVscodeFirst, 'w-cli');
  assert.strictEqual(res1.task && res1.task.id, 'TASK-2');
  assert.strictEqual(res1.blockedBy, null);

  const queueWithActiveVscode = [
    { id: 'TASK-1', status: 'IN_PROGRESS', executor: 'tele-vs-code', worker_id: 'w-vscode', instruction: 'Sedang jalan' },
    { id: 'TASK-2', status: 'PENDING', executor: 'cli', instruction: 'Antre' }
  ];
  const res2 = TeleWorker.selectNextCliTask(queueWithActiveVscode, 'w-cli');
  assert.strictEqual(res2.task, null);
  assert.strictEqual(res2.blockedBy && res2.blockedBy.id, 'TASK-1');

  const queueWithUrgentKill = [
    { id: 'TASK-1', status: 'IN_PROGRESS', executor: 'cli', worker_id: 'w-other', instruction: 'Macet' },
    { id: 'TASK-KILL', status: 'PENDING', executor: 'cli', instruction: '/kill TASK-1' }
  ];
  const res3 = TeleWorker.selectNextCliTask(queueWithUrgentKill, 'w-cli');
  assert.strictEqual(res3.task && res3.task.id, 'TASK-KILL');
});

test('Worker - isClaimAccepted menolak klaim yang dimenangkan tele-vs-code atau error server', () => {
  assert.strictEqual(TeleWorker.isClaimAccepted({ statusCode: 200, data: { ok: true, task: { worker_id: 'w-cli', executor: 'cli' } } }, 'w-cli'), true);
  assert.strictEqual(TeleWorker.isClaimAccepted({ statusCode: 409, data: { ok: false } }, 'w-cli'), false);
  assert.strictEqual(TeleWorker.isClaimAccepted({ statusCode: 200, data: { ok: false, error: 'Already claimed' } }, 'w-cli'), false);
  assert.strictEqual(TeleWorker.isClaimAccepted({ statusCode: 200, data: { ok: true, task: { worker_id: 'w-vscode', executor: 'tele-vs-code' } } }, 'w-cli'), false);
  assert.strictEqual(TeleWorker.isClaimAccepted({ statusCode: 200, data: { ok: true, task: { executor: 'vscode' } } }, 'w-cli'), false);
});

test('Process utils - isActiveTaskLocked dan hasLocalQueueInProgress mencegah bentrok lokal', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tele-conflict-test-'));
  try {
    // 1. Stale PID lock auto-cleaned
    writeActiveTask(tmpDir, { taskId: 'TASK-STALE', pid: 999999, workerPid: 999999, workerId: 'w-dead' });
    const staleRes = isActiveTaskLocked(tmpDir, 'w-cli', process.pid);
    assert.strictEqual(staleRes.locked, false);
    assert.strictEqual(readActiveTask(tmpDir), null);

    // 2. Live lock from tele-vs-code blocks tele-vs-cli
    const vscodeDir = path.join(tmpDir, '.vscode', 'tele-vs-code');
    fs.mkdirSync(vscodeDir, { recursive: true });
    fs.writeFileSync(path.join(vscodeDir, 'active-task.json'), JSON.stringify({
      taskId: 'TASK-IDE',
      pid: process.pid,
      workerId: 'w-vscode',
      executor: 'tele-vs-code'
    }));
    const lockedRes = isActiveTaskLocked(tmpDir, 'w-cli', process.pid + 1000);
    assert.strictEqual(lockedRes.locked, true);
    assert.strictEqual(lockedRes.owner.taskId, 'TASK-IDE');

    // 3. TASK_QUEUE.md [IN_PROGRESS] detection
    fs.writeFileSync(path.join(tmpDir, 'TASK_QUEUE.md'), [
      '# TASK QUEUE',
      '## ⏳ Tugas Aktif',
      '### [IN_PROGRESS] #TASK-IDE1',
      '- **Status:** IN_PROGRESS',
      '## ✅ Riwayat Tugas Selesai',
      '### [DONE] #TASK-OLD'
    ].join('\n'));
    const q1 = hasLocalQueueInProgress(tmpDir, 'TASK-NEW');
    assert.strictEqual(q1.active, true);
    assert.strictEqual(q1.taskId, '#TASK-IDE1');

    const qSame = hasLocalQueueInProgress(tmpDir, 'TASK-IDE1');
    assert.strictEqual(qSame.active, false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('TeleWorker - membatalkan eksekusi jika klaim startTask ditolak server', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tele-claim-test-'));
  try {
    const worker = new TeleWorker({ workDir: tmpDir, workerId: 'w-cli' });
    let executed = false;
    let failedCalled = false;

    worker.api = {
      startTask: async () => ({
        statusCode: 200,
        data: { ok: true, task: { id: 'TASK-RACE', worker_id: 'w-vscode', executor: 'tele-vs-code' } }
      }),
      failTask: async () => { failedCalled = true; },
      doneTask: async () => {}
    };
    worker.executor = {
      execute: async () => { executed = true; return { success: true }; }
    };

    await worker.executeTask({ id: 'TASK-RACE', instruction: 'Test race', executor: 'all' });
    assert.strictEqual(executed, false);
    assert.strictEqual(failedCalled, false);
    assert.strictEqual(readActiveTask(tmpDir), null);
    assert.strictEqual(worker.activeTask, null);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
