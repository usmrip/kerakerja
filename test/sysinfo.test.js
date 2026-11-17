const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  collectSysinfo,
  formatSysinfoText,
  formatSysinfoTelegramHtml,
  formatWorkersTable,
  isWorkerCommandLine
} = require('../src/cli/commands/sysinfo');
const { parseSysinfoCommand } = require('../src/worker/worker');

test('Worker - parseSysinfoCommand mem-parsing /sysinfo dengan berbagai format', () => {
  assert.deepEqual(parseSysinfoCommand('/sysinfo'), { json: false });
  assert.deepEqual(parseSysinfoCommand('/sysinfo@kerakerja_bot'), { json: false });
  assert.deepEqual(parseSysinfoCommand('/sysinfo --json'), { json: true });
  assert.equal(parseSysinfoCommand('/info'), null);
  assert.equal(parseSysinfoCommand('kerjakan sesuatu'), null);
});

test('Sysinfo - isWorkerCommandLine mengenali proses worker KeraKerja', () => {
  assert.equal(isWorkerCommandLine('node /opt/kerakerja/bin/kerakerja.js start --daemon'), true);
  assert.equal(isWorkerCommandLine('node C:\\app\\src\\worker\\multi_worker.js'), true);
  assert.equal(isWorkerCommandLine('node /home/user/.vscode/kerakerja/tele-worker.js'), true);
  assert.equal(isWorkerCommandLine('node server.js'), false);
});

test('Sysinfo - collectSysinfo menghitung info mesin, masing-masing worker, dan total usage', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kk-sysinfo-'));
  const workspacesFile = path.join(tmpDir, 'workspaces.json');
  fs.writeFileSync(workspacesFile, JSON.stringify({ workspaces: [] }), 'utf-8');

  try {
    const info = collectSysinfo({
      workDir: tmpDir,
      workspacesFile,
      processScanner: () => [
        {
          pid: 41001,
          cpuPercent: 3.5,
          memoryBytes: 64 * 1024 * 1024,
          commandLine: 'node /srv/kerakerja/bin/kerakerja.js start --daemon'
        },
        {
          pid: 41002,
          cpuPercent: 1.5,
          memoryBytes: 36 * 1024 * 1024,
          commandLine: 'node /srv/kerakerja/src/worker/multi_worker.js --all'
        },
        {
          pid: 41003,
          cpuPercent: 10.0,
          memoryBytes: 100 * 1024 * 1024,
          commandLine: 'node /srv/other-app/server.js'
        }
      ]
    });

    assert.ok(info.machine.hostname);
    assert.ok(info.machine.cpuCores >= 1);
    assert.ok(info.machine.totalMemBytes > 0);
    assert.equal(info.workers.length, 2);
    assert.equal(info.workers[0].pid, 41001);
    assert.equal(info.workers[0].cpuPercent, 3.5);
    assert.equal(info.workers[1].pid, 41002);
    assert.equal(info.workers[1].mode, 'multi-project');

    assert.equal(info.workerTotals.runningCount, 2);
    assert.equal(info.workerTotals.totalCpuPercent, 5.0);
    assert.equal(info.workerTotals.totalMemoryBytes, 100 * 1024 * 1024);
    assert.ok(info.workerTotals.totalMemoryPercent >= 0);

    const text = formatSysinfoText(info);
    assert.ok(text.includes('SYSTEM INFO & WORKER USAGE (KERAKERJA)'));
    assert.ok(text.includes('WORKER KERAKERJA AKTIF (2 running)'));
    assert.ok(text.includes('TOTAL USAGE SYSTEM WORKER KERAKERJA'));
    assert.ok(text.includes('5.0%'));

    const html = formatSysinfoTelegramHtml(info, { projectId: 'prj_demo' });
    assert.ok(html.includes('SYSTEM INFO &amp; WORKER USAGE (KERAKERJA)'));
    assert.ok(html.includes('prj_demo'));
    assert.ok(html.includes('Worker Running (2)'));
    assert.ok(html.includes('Total Usage Worker KeraKerja'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Sysinfo - formatWorkersTable menangani daftar worker kosong', () => {
  const out = formatWorkersTable([]);
  assert.ok(out.includes('Tidak ada worker KeraKerja'));
});

test('CLI - kerakerja sysinfo --json dan /sysinfo --json menghasilkan struktur valid', () => {
  const cliPath = path.join(__dirname, '..', 'bin', 'kerakerja.js');
  for (const cmd of ['sysinfo', '/sysinfo']) {
    const raw = execFileSync(process.execPath, [cliPath, cmd, '--json'], {
      encoding: 'utf-8',
      windowsHide: true,
      timeout: 15000
    });
    const parsed = JSON.parse(raw);
    assert.ok(parsed.machine);
    assert.ok(Array.isArray(parsed.workers));
    assert.ok(parsed.workerTotals);
    assert.equal(typeof parsed.workerTotals.runningCount, 'number');
    assert.equal(typeof parsed.workerTotals.totalCpuPercent, 'number');
    assert.equal(typeof parsed.workerTotals.totalMemoryBytes, 'number');
  }
});
