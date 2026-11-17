const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TeleWorker = require('../src/worker/worker');
const ApiClient = require('../src/api/client');

test('Worker Control - readTaskAgentsMd membaca TASK_AGENTS.md dan menghitung [PENDING]', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tele-task-agents-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'kerakerja.config.json'), JSON.stringify({
      serverUrl: 'http://localhost',
      secret: 'sec_test',
      projectId: 'prj_test',
      agent: 'agy'
    }));
    const worker = new TeleWorker({ workDir: tmpDir, workerId: 'w-test-ta' });

    const resMissing = worker.readTaskAgentsMd();
    assert.strictEqual(resMissing.exists, false);
    assert.strictEqual(resMissing.pendingCount, 0);

    fs.writeFileSync(path.join(tmpDir, 'TASK_AGENTS.md'), '# Tasks\n### [PENDING] #TASK-1234\n- test\n### [PENDING] #TASK-5678\n');
    const resFound = worker.readTaskAgentsMd();
    assert.strictEqual(resFound.exists, true);
    assert.strictEqual(resFound.pendingCount, 2);
    assert.ok(worker.lastTaskAgentsStatus.includes('2 tugas [PENDING]'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Worker Control - handleHeartbeatResponse menyinkronkan timer TASK_AGENTS.md', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tele-hb-timer-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'kerakerja.config.json'), JSON.stringify({
      serverUrl: 'http://localhost',
      secret: 'sec_test',
      projectId: 'prj_test',
      agent: 'agy'
    }));
    const worker = new TeleWorker({ workDir: tmpDir, workerId: 'w-test-hb' });
    worker.running = true;

    await worker.handleHeartbeatResponse({
      status: 'ok',
      command: 'set_timer',
      command_data: { timer: 45 },
      task_agents_timer: 45
    });

    assert.strictEqual(worker.taskAgentsTimerSec, 45);
    assert.ok(worker.taskAgentsTimer !== null);

    await worker.stop();
    assert.strictEqual(worker.taskAgentsTimer, null);

    let pollTriggered = false;
    worker.checkAndProcessNextTask = async () => { pollTriggered = true; };
    await worker.handleHeartbeatResponse({ status: 'ok', command: 'wakeup' });
    assert.strictEqual(pollTriggered, true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ApiClient - registerWorker mengirim status, active_task_id, dan task_agents_timer', async () => {
  const api = new ApiClient('https://biru.co.id/kerakerja/', 'sec_x', 'prj_x');
  let captured = null;
  api.request = async (endpoint, params, method) => {
    captured = { endpoint, params, method };
    return { statusCode: 200, data: { status: 'ok' } };
  };

  await api.registerWorker('worker-test-1', {
    agent: 'agy',
    workDir: '/tmp/proj',
    hostname: 'host-1',
    pid: 1234,
    activeTask: '#TASK-2bb7',
    activeTaskTitle: 'Update dashboard',
    status: 'busy',
    taskAgentsTimer: 60,
    lastTaskAgentsRead: '2026-11-17 12:00:00'
  });

  assert.strictEqual(captured.endpoint, 'worker_heartbeat');
  assert.strictEqual(captured.method, 'POST');
  assert.strictEqual(captured.params.worker_id, 'worker-test-1');
  assert.strictEqual(captured.params.worker_status, 'busy');
  assert.strictEqual(captured.params.active_task_id, '#TASK-2bb7');
  assert.strictEqual(captured.params.task_agents_timer, 60);
  assert.strictEqual(captured.params.hostname, 'host-1');
  assert.strictEqual(captured.params.pid, 1234);
});
