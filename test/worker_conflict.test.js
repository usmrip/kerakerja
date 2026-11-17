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

test('Worker - executor routing hanya menerima executor CLI yang valid', () => {
  assert.strictEqual(TeleWorker.isCliExecutor(''), true);
  assert.strictEqual(TeleWorker.isCliExecutor('all'), true);
  assert.strictEqual(TeleWorker.isCliExecutor('CLI'), true);
  assert.strictEqual(TeleWorker.isCliExecutor('kerakerja'), true);
  assert.strictEqual(TeleWorker.isCliExecutor('headless'), true);
  assert.strictEqual(TeleWorker.isCliExecutor('other-runner'), false);
  assert.strictEqual(TeleWorker.isCliExecutor('remote-ui'), false);

  assert.strictEqual(TeleWorker.isTaskForCliExecutor({ id: 'TASK-1', executor: 'other-runner' }, 'w-cli'), false);
  assert.strictEqual(TeleWorker.isTaskForCliExecutor({ id: 'TASK-2', executor: 'all', worker_id: 'w-other' }, 'w-cli'), false);
  assert.strictEqual(TeleWorker.isTaskForCliExecutor({ id: 'TASK-3', executor: 'cli', worker_id: 'w-cli' }, 'w-cli'), true);
  assert.strictEqual(TeleWorker.isTaskForCliExecutor({ id: 'TASK-4', executor: 'all' }, 'w-cli'), true);
});

test('Worker - selectNextCliTask melewati tugas non-CLI dan menunda jika ada IN_PROGRESS lain', () => {
  const queueWithNonCliFirst = [
    { id: 'TASK-1', status: 'PENDING', executor: 'other-runner', instruction: 'Tugas runner lain' },
    { id: 'TASK-2', status: 'PENDING', executor: 'cli', instruction: 'Jalankan test' }
  ];
  const res1 = TeleWorker.selectNextCliTask(queueWithNonCliFirst, 'w-cli');
  assert.strictEqual(res1.task && res1.task.id, 'TASK-2');
  assert.strictEqual(res1.blockedBy, null);

  const queueWithActiveOther = [
    { id: 'TASK-1', status: 'IN_PROGRESS', executor: 'cli', worker_id: 'w-other', instruction: 'Sedang jalan' },
    { id: 'TASK-2', status: 'PENDING', executor: 'cli', instruction: 'Antre' }
  ];
  const res2 = TeleWorker.selectNextCliTask(queueWithActiveOther, 'w-cli');
  assert.strictEqual(res2.task, null);
  assert.strictEqual(res2.blockedBy && res2.blockedBy.id, 'TASK-1');

  const queueWithUrgentKill = [
    { id: 'TASK-1', status: 'IN_PROGRESS', executor: 'cli', worker_id: 'w-other', instruction: 'Macet' },
    { id: 'TASK-KILL', status: 'PENDING', executor: 'cli', instruction: '/kill TASK-1' }
  ];
  const res3 = TeleWorker.selectNextCliTask(queueWithUrgentKill, 'w-cli');
  assert.strictEqual(res3.task && res3.task.id, 'TASK-KILL');
});

test('Worker - isClaimAccepted menolak klaim yang dimenangkan worker lain atau error server', () => {
  assert.strictEqual(TeleWorker.isClaimAccepted({ statusCode: 200, data: { ok: true, task: { worker_id: 'w-cli', executor: 'cli' } } }, 'w-cli'), true);
  assert.strictEqual(TeleWorker.isClaimAccepted({ statusCode: 409, data: { ok: false } }, 'w-cli'), false);
  assert.strictEqual(TeleWorker.isClaimAccepted({ statusCode: 200, data: { ok: false, error: 'Already claimed' } }, 'w-cli'), false);
  assert.strictEqual(TeleWorker.isClaimAccepted({ statusCode: 200, data: { ok: true, task: { worker_id: 'w-other', executor: 'cli' } } }, 'w-cli'), false);
  assert.strictEqual(TeleWorker.isClaimAccepted({ statusCode: 200, data: { ok: true, task: { executor: 'other-runner' } } }, 'w-cli'), false);
});

test('Process utils - isActiveTaskLocked dan hasLocalQueueInProgress mencegah bentrok lokal', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tele-conflict-test-'));
  try {
    // 1. Stale PID lock auto-cleaned
    writeActiveTask(tmpDir, { taskId: 'TASK-STALE', pid: 999999, workerPid: 999999, workerId: 'w-dead' });
    const staleRes = isActiveTaskLocked(tmpDir, 'w-cli', process.pid);
    assert.strictEqual(staleRes.locked, false);
    assert.strictEqual(readActiveTask(tmpDir), null);

    // 2. Live lock from another CLI worker blocks current worker
    writeActiveTask(tmpDir, {
      taskId: 'TASK-OTHER',
      pid: process.pid,
      workerId: 'w-other',
      executor: 'cli'
    });
    const lockedRes = isActiveTaskLocked(tmpDir, 'w-cli', process.pid + 1000);
    assert.strictEqual(lockedRes.locked, true);
    assert.strictEqual(lockedRes.owner.taskId, 'TASK-OTHER');

    // 3. TASK_QUEUE.md [IN_PROGRESS] detection
    fs.writeFileSync(path.join(tmpDir, 'TASK_QUEUE.md'), [
      '# TASK QUEUE',
      '## ⏳ Tugas Aktif',
      '### [IN_PROGRESS] #TASK-CLI1',
      '- **Status:** IN_PROGRESS',
      '## ✅ Riwayat Tugas Selesai',
      '### [DONE] #TASK-OLD'
    ].join('\n'));
    const q1 = hasLocalQueueInProgress(tmpDir, 'TASK-NEW');
    assert.strictEqual(q1.active, true);
    assert.strictEqual(q1.taskId, '#TASK-CLI1');

    const qSame = hasLocalQueueInProgress(tmpDir, 'TASK-CLI1');
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
        data: { ok: true, task: { id: 'TASK-RACE', worker_id: 'w-other', executor: 'cli' } }
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

test('TeleWorker - checkAndProcessNextTask menunda klaim jika summary IN_PROGRESS > 0 di server', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tele-seq-test-'));
  const prevIgnore = process.env.TELE_IGNORE_LOCAL_QUEUE;
  process.env.TELE_IGNORE_LOCAL_QUEUE = '1';
  try {
    const worker = new TeleWorker({ workDir: tmpDir, workerId: 'w-cli' });
    let startCalled = false;

    worker.api = {
      pullTasks: async () => ({
        statusCode: 200,
        data: { tasks: [{ id: 'TASK-NEXT', instruction: 'Tugas berikutnya', status: 'PENDING', executor: 'cli' }] }
      }),
      getStatus: async () => ({
        statusCode: 200,
        data: { ok: true, summary: { PENDING: 3, IN_PROGRESS: 1, DONE: 28, FAILED: 0 } }
      }),
      startTask: async () => {
        startCalled = true;
        return { statusCode: 200, data: { ok: true } };
      }
    };

    await worker.checkAndProcessNextTask();
    assert.strictEqual(startCalled, false, 'startTask tidak boleh dipanggil saat masih ada IN_PROGRESS di server');
  } finally {
    if (prevIgnore === undefined) delete process.env.TELE_IGNORE_LOCAL_QUEUE;
    else process.env.TELE_IGNORE_LOCAL_QUEUE = prevIgnore;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ApiClient - addTask mengirim status PENDING secara default agar antrean Terminal sinkron dengan Telegram & Web', async () => {
  const ApiClient = require('../src/api/client');
  const client = new ApiClient('https://biru.co.id/kerakerja/', 'sec', 'prj_test');
  let captured = null;
  client.request = async (endpoint, params, method) => {
    captured = { endpoint, params, method };
    return { statusCode: 200, data: { status: 'success', id: 'TASK-123' } };
  };

  await client.addTask('Tes sinkronisasi 3 jalur', { sender: 'Terminal CLI', executor: 'cli' });
  assert.strictEqual(captured.endpoint, 'push');
  assert.strictEqual(captured.params.status, 'PENDING');
  assert.strictEqual(captured.params.sender, 'Terminal CLI');
  assert.strictEqual(captured.params.executor, 'cli');
});

test('ApiClient - request POST mengirim params di body form-urlencoded (bukan query string) agar payload besar tidak HTTP 500', async () => {
  const http = require('http');
  const ApiClient = require('../src/api/client');

  let receivedUrl = '';
  let receivedMethod = '';
  let receivedContentType = '';
  let receivedBody = '';

  const server = http.createServer((req, res) => {
    receivedUrl = req.url;
    receivedMethod = req.method;
    receivedContentType = req.headers['content-type'] || '';
    req.on('data', chunk => { receivedBody += chunk; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const client = new ApiClient(`http://127.0.0.1:${port}/`, 'sec123', 'prj_test');
    const longLog = 'A'.repeat(9500);
    const res = await client.doneTask('#TASK-BIG', 'Selesai 100%', 'abc123', longLog);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(receivedMethod, 'POST');
    assert.strictEqual(receivedContentType, 'application/x-www-form-urlencoded');
    assert.ok(!receivedUrl.includes('AAAA'), 'Payload log besar tidak boleh masuk query string URL');
    const parsedBody = new URLSearchParams(receivedBody);
    assert.strictEqual(parsedBody.get('id'), '#TASK-BIG');
    assert.strictEqual(parsedBody.get('log').length, 9500);
  } finally {
    server.close();
  }
});

test('TeleWorker - checkAndProcessNextTask membersihkan stale IN_PROGRESS di TASK_QUEUE.md jika server IN_PROGRESS=0', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tele-stale-q-'));
  const prevIgnore = process.env.TELE_IGNORE_LOCAL_QUEUE;
  delete process.env.TELE_IGNORE_LOCAL_QUEUE;
  try {
    fs.writeFileSync(path.join(tmpDir, 'TASK_QUEUE.md'), '# Queue\n\n### [IN_PROGRESS] #TASK-STALE\n- old\n');
    const worker = new TeleWorker({ workDir: tmpDir, workerId: 'w-cli' });
    let executedId = null;

    worker.api = {
      pullTasks: async () => ({
        statusCode: 200,
        data: { tasks: [{ id: 'TASK-NEXT', status: 'PENDING', executor: 'cli', instruction: 'Kerjakan ini' }] }
      }),
      getStatus: async () => ({ statusCode: 200, data: { ok: true, summary: { PENDING: 1, IN_PROGRESS: 0 } } }),
      getTask: async () => ({ statusCode: 200, data: { ok: true, task: { id: '#TASK-STALE', status: 'PENDING' } } }),
      startTask: async () => ({ statusCode: 200, data: { ok: true, task: { id: 'TASK-NEXT', worker_id: 'w-cli', executor: 'cli' } } }),
      doneTask: async () => ({ statusCode: 200, data: { ok: true } }),
      failTask: async () => ({ statusCode: 200, data: { ok: true } })
    };
    worker.executor = {
      execute: async (task) => { executedId = task.id; return { success: true, summary: 'OK' }; }
    };

    await worker.checkAndProcessNextTask();
    assert.strictEqual(executedId, 'TASK-NEXT');
    const qContent = fs.readFileSync(path.join(tmpDir, 'TASK_QUEUE.md'), 'utf-8');
    assert.strictEqual(qContent.includes('[IN_PROGRESS] #TASK-STALE'), false);
    assert.strictEqual(qContent.includes('[PENDING] #TASK-STALE'), true);
  } finally {
    if (prevIgnore === undefined) delete process.env.TELE_IGNORE_LOCAL_QUEUE;
    else process.env.TELE_IGNORE_LOCAL_QUEUE = prevIgnore;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ApiClient - retry otomatis saat Server error HTTP 500 sementara lalu berhasil', async () => {
  const http = require('http');
  const ApiClient = require('../src/api/client');
  let hitCount = 0;
  const server = http.createServer((req, res) => {
    hitCount += 1;
    if (hitCount < 3) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, attempt: hitCount }));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const client = new ApiClient(`http://127.0.0.1:${port}/`, 'sec123', 'prj_test', { maxRetries: 3, retryDelayMs: 5 });
    const res = await client.startTask('#TASK-RETRY500', 'w1', 'agy');
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.data.ok, true);
    assert.strictEqual(hitCount, 3);
  } finally {
    server.close();
  }
});

test('TeleWorker - executeTask tidak menandai FAILED jika startTask gagal HTTP 500 sementara', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tele-500-pending-'));
  try {
    const worker = new TeleWorker({ workDir: tmpDir, workerId: 'w-cli' });
    let failCalled = false;
    worker.api = {
      startTask: async () => { throw new Error('Server error HTTP 500 [in_progress]: '); },
      failTask: async () => { failCalled = true; },
      doneTask: async () => {}
    };
    await worker.executeTask({ id: 'TASK-TMP500', instruction: 'Test', executor: 'all' });
    assert.strictEqual(failCalled, false);
    assert.strictEqual(readActiveTask(tmpDir), null);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
