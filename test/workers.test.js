const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const ApiClient = require('../src/api/client');
const {
  parseWorkersArgs,
  filterWorkersList,
  fetchWorkersData,
  formatWorkersTelegramHtml
} = require('../src/cli/commands/workers');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'kerakerja.js');

test('workers - parseWorkersArgs mem-parsing flag dan filter dengan benar', () => {
  assert.deepEqual(parseWorkersArgs([]), {
    json: false,
    onlineOnly: false,
    offlineOnly: false,
    localOnly: false,
    all: true,
    filter: ''
  });
  assert.deepEqual(parseWorkersArgs(['--json', '--online', 'kk']), {
    json: true,
    onlineOnly: true,
    offlineOnly: false,
    localOnly: false,
    all: true,
    filter: 'kk'
  });
  assert.deepEqual(parseWorkersArgs(['offline', '--local', '--project']), {
    json: false,
    onlineOnly: false,
    offlineOnly: true,
    localOnly: true,
    all: false,
    filter: ''
  });
});

test('workers - filterWorkersList mengurutkan BUSY -> IDLE -> OFFLINE dan memfilter kode proyek', () => {
  const sample = [
    { worker_id: 'w1', hostname: 'pc-off', is_online: false, display_status: 'OFFLINE', project_code: 'kk', last_seen: '2026-11-17 10:00:00' },
    { worker_id: 'w2', hostname: 'pc-idle', is_online: true, display_status: 'IDLE', project_code: 'kk', last_seen: '2026-11-17 11:00:00' },
    { worker_id: 'w3', hostname: 'pc-busy', is_online: true, display_status: 'BUSY', project_code: 'kk', last_seen: '2026-11-17 10:30:00' },
    { worker_id: 'w4', hostname: 'pc-other', is_online: true, display_status: 'IDLE', project_code: 'ayo', last_seen: '2026-11-17 11:05:00' }
  ];

  const sortedKk = filterWorkersList(sample, { filter: '#kk' });
  assert.deepEqual(sortedKk.map((w) => w.worker_id), ['w3', 'w2', 'w1']);

  const onlineOnly = filterWorkersList(sample, { onlineOnly: true });
  assert.equal(onlineOnly.length, 3);
  assert.ok(onlineOnly.every((w) => w.is_online));
});

test('workers - fetchWorkersData menggabungkan data server dan worker lokal', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kk-workers-'));
  const workspacesFile = path.join(tmpDir, 'workspaces.json');
  fs.writeFileSync(workspacesFile, '[]', 'utf-8');
  fs.writeFileSync(path.join(tmpDir, 'kerakerja-worker.pid'), String(process.pid), 'utf-8');

  try {
    const mockClient = {
      async getWorkers() {
        return {
          statusCode: 200,
          data: {
            ok: true,
            workers: [
              {
                worker_id: 'w-busy',
                hostname: 'workstation-1',
                pid: 1234,
                is_online: true,
                display_status: 'BUSY',
                project_name: 'KeraKerja',
                project_code: 'kk',
                agent: 'agy',
                platform: 'win32',
                arch: 'x64',
                last_seen_ago: '5d lalu',
                active_task_id: '#TASK-fb0d',
                active_task_title: 'buat perintah /workers'
              },
              {
                worker_id: 'w-off',
                hostname: 'server-2',
                pid: 0,
                is_online: false,
                display_status: 'OFFLINE',
                project_name: 'Ayoke',
                project_code: 'ayo',
                agent: 'claude',
                platform: 'linux',
                arch: 'x64',
                last_seen_ago: '2j lalu'
              }
            ]
          }
        };
      }
    };

    const data = await fetchWorkersData({
      workDir: tmpDir,
      workspacesFile,
      config: { serverUrl: 'https://example.test/api.php', secret: 'sec', projectId: 'prj_1' },
      apiClient: mockClient
    });

    assert.equal(data.serverOk, true);
    assert.deepEqual(data.summary, {
      total: 2,
      online: 1,
      busy: 1,
      idle: 0,
      offline: 1,
      localRunning: 1
    });
    assert.equal(data.localWorkers[0].pid, process.pid);

    const html = formatWorkersTelegramHtml(data);
    assert.match(html, /DAFTAR WORKER/);
    assert.match(html, /workstation-1/);
    assert.match(html, /#TASK-fb0d/);
    assert.match(html, /OFFLINE/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('workers - formatWorkersTelegramHtml menangani daftar kosong', () => {
  const html = formatWorkersTelegramHtml({ serverWorkers: [], summary: { total: 0, online: 0, busy: 0, idle: 0, offline: 0 } });
  assert.match(html, /Tidak ada worker terdaftar/);
  assert.match(html, /kerakerja start --daemon/);
});

test('ApiClient - getWorkers memanggil endpoint api_workers dengan parameter benar', async () => {
  const client = new ApiClient('https://example.test/includes/api.php', 'sec', 'prj_1');
  let captured = null;
  client.request = async (endpoint, params) => {
    captured = { endpoint, params };
    return { statusCode: 200, data: { ok: true, workers: [] } };
  };

  await client.getWorkers({ all: true, status: 'online' });
  assert.deepEqual(captured, {
    endpoint: 'api_workers',
    params: { all: '1', status: 'online' }
  });
});

test('CLI - kerakerja workers --local --json, /workers --local --json, dan help berjalan sukses', () => {
  for (const cmd of ['workers', '/workers']) {
    const out = execFileSync(process.execPath, [BIN, cmd, '--local', '--json'], {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 10000,
      windowsHide: true
    });
    const parsed = JSON.parse(out);
    assert.equal(typeof parsed.summary.localRunning, 'number');
    assert.ok(Array.isArray(parsed.localWorkers));
    assert.ok(Array.isArray(parsed.serverWorkers));
  }

  const helpOut = execFileSync(process.execPath, [BIN, 'help'], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 10000,
    windowsHide: true
  });
  assert.match(helpOut, /workers \[--json\]/);
});
