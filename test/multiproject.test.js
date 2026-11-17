const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  loadWorkspaces,
  registerWorkspace,
  unregisterWorkspace
} = require('../src/config/workspaces');
const { saveConfig } = require('../src/config/config');
const MultiProjectWorker = require('../src/worker/multi_worker');

test('Workspaces - registerWorkspace mendaftarkan multi-proyek (/a dan /b) dan memperbarui duplikat', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tele-ws-test-'));
  const wsFile = path.join(tmpDir, 'workspaces.json');

  const dirA = path.join(tmpDir, 'a');
  const dirB = path.join(tmpDir, 'b');
  fs.mkdirSync(dirA, { recursive: true });
  fs.mkdirSync(dirB, { recursive: true });

  const r1 = registerWorkspace({
    workDir: dirA,
    projectId: 'prj_a',
    secret: 'sec_a',
    agent: 'agy'
  }, wsFile);
  assert.strictEqual(r1.registered, true);
  assert.strictEqual(r1.total, 1);

  const r2 = registerWorkspace({
    workDir: dirB,
    projectId: 'prj_b',
    secret: 'sec_b',
    agent: 'claude'
  }, wsFile);
  assert.strictEqual(r2.registered, true);
  assert.strictEqual(r2.total, 2);

  // Upsert dirA dengan agent baru
  const r3 = registerWorkspace({
    workDir: dirA,
    projectId: 'prj_a_updated',
    secret: 'sec_a',
    agent: 'gemini'
  }, wsFile);
  assert.strictEqual(r3.updated, true);
  assert.strictEqual(r3.total, 2);

  const list = loadWorkspaces(wsFile);
  assert.strictEqual(list.length, 2);
  const itemA = list.find(w => w.workDir === path.resolve(dirA));
  const itemB = list.find(w => w.workDir === path.resolve(dirB));
  assert.ok(itemA && itemB);
  assert.strictEqual(itemA.projectId, 'prj_a_updated');
  assert.strictEqual(itemA.agent, 'gemini');
  assert.strictEqual(itemB.projectId, 'prj_b');

  // Invalid default projectId tidak didaftarkan
  const rInvalid = registerWorkspace({ workDir: dirA, projectId: 'default' }, wsFile);
  assert.strictEqual(rInvalid.registered, false);

  // Unregister dirB
  const rem = unregisterWorkspace(dirB, wsFile);
  assert.strictEqual(rem.removed, true);
  assert.strictEqual(loadWorkspaces(wsFile).length, 1);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('MultiProjectWorker - resolveValidWorkspaces memuat proyek valid dan melewati folder yang hilang', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tele-mw-test-'));
  const wsFile = path.join(tmpDir, 'workspaces.json');

  const dirA = path.join(tmpDir, 'proj_a');
  const dirB = path.join(tmpDir, 'proj_b');
  const dirMissing = path.join(tmpDir, 'proj_missing');
  fs.mkdirSync(dirA, { recursive: true });
  fs.mkdirSync(dirB, { recursive: true });

  saveConfig({ projectId: 'prj_alpha', secret: 'sec_alpha', agent: 'agy' }, dirA);
  saveConfig({ projectId: 'prj_beta', secret: 'sec_beta', agent: 'claude' }, dirB);

  registerWorkspace({ workDir: dirA, projectId: 'prj_alpha', secret: 'sec_alpha', agent: 'agy' }, wsFile);
  registerWorkspace({ workDir: dirB, projectId: 'prj_beta', secret: 'sec_beta', agent: 'claude' }, wsFile);
  registerWorkspace({ workDir: dirMissing, projectId: 'prj_ghost', secret: 'sec_ghost', agent: 'agy' }, wsFile);

  const mw = new MultiProjectWorker({ workspacesFile: wsFile });
  const valid = mw.resolveValidWorkspaces();

  assert.strictEqual(valid.length, 2);
  assert.strictEqual(valid[0].projectId, 'prj_alpha');
  assert.strictEqual(valid[0].workDir, path.resolve(dirA));
  assert.strictEqual(valid[1].projectId, 'prj_beta');
  assert.strictEqual(valid[1].workDir, path.resolve(dirB));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Installer & Service - mendukung pertanyaan autostart dan flag --all', () => {
  const installSrc = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'install.js'), 'utf-8');
  assert.ok(installSrc.includes('auto-start service'));
  assert.ok(installSrc.includes("serviceCommand(['install', '--all'])"));

  const serviceSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'cli', 'commands', 'service.js'), 'utf-8');
  assert.ok(serviceSrc.includes("isAll ? 'start --all' : 'start'"));
});

test('Start & DaemonCtl - resolveStartMode otomatis mendeteksi multi-proyek di folder tak terkonfigurasi', () => {
  const { resolveStartMode } = require('../src/cli/commands/start');
  const { resolveTargetAll } = require('../src/cli/commands/daemon_ctl');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tele-mode-test-'));
  const wsFile = path.join(tmpDir, 'workspaces.json');
  const unconfiguredDir = path.join(tmpDir, 'root_empty');
  const configuredDir = path.join(tmpDir, 'proj_a');
  fs.mkdirSync(unconfiguredDir, { recursive: true });
  fs.mkdirSync(configuredDir, { recursive: true });

  saveConfig({ projectId: 'prj_a', secret: 'sec_a', agent: 'agy' }, configuredDir);
  registerWorkspace({ workDir: configuredDir, projectId: 'prj_a', secret: 'sec_a', agent: 'agy' }, wsFile);

  const m1 = resolveStartMode([], unconfiguredDir, wsFile);
  assert.strictEqual(m1.isAll, true);
  assert.strictEqual(m1.autoDetected, true);
  assert.strictEqual(m1.registeredCount, 1);

  const m2 = resolveStartMode([], configuredDir, wsFile);
  assert.strictEqual(m2.isAll, false);
  assert.strictEqual(m2.autoDetected, false);

  const m3 = resolveStartMode(['--all'], configuredDir, wsFile);
  assert.strictEqual(m3.isAll, true);

  assert.strictEqual(resolveTargetAll(['--all'], unconfiguredDir), true);
  assert.strictEqual(resolveTargetAll(['--single'], unconfiguredDir), false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Status - showMultiStatus menghasilkan JSON multi-proyek yang valid', async () => {
  const { showMultiStatus } = require('../src/cli/commands/status');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tele-status-test-'));
  const wsFile = path.join(tmpDir, 'workspaces.json');
  const dirA = path.join(tmpDir, 'a');
  const dirB = path.join(tmpDir, 'b');
  fs.mkdirSync(dirA, { recursive: true });
  fs.mkdirSync(dirB, { recursive: true });

  registerWorkspace({ workDir: dirA, projectId: 'prj_a', agent: 'agy' }, wsFile);
  registerWorkspace({ workDir: dirB, projectId: 'prj_b', agent: 'claude' }, wsFile);

  const logs = [];
  const origLog = console.log;
  console.log = (msg) => logs.push(msg);
  try {
    await showMultiStatus(true, 12345, wsFile);
  } finally {
    console.log = origLog;
  }

  const parsed = JSON.parse(logs.join('\n'));
  assert.strictEqual(parsed.mode, 'multi-project');
  assert.strictEqual(parsed.multiWorker.status, 'online');
  assert.strictEqual(parsed.multiWorker.pid, 12345);
  assert.strictEqual(parsed.totalWorkspaces, 2);
  assert.strictEqual(parsed.workspaces[0].projectId, 'prj_a');
  assert.strictEqual(parsed.workspaces[1].projectId, 'prj_b');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Workspaces - memindahkan 1 proyek ke direktori baru menggantikan direktori lama (deduplikasi projectId)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tele-move-ws-'));
  const wsFile = path.join(tmpDir, 'workspaces.json');

  const dirA = path.join(tmpDir, 'a');
  const dirC = path.join(tmpDir, 'c');
  fs.mkdirSync(dirA, { recursive: true });
  fs.mkdirSync(dirC, { recursive: true });

  registerWorkspace({ workDir: dirA, projectId: 'prj_move', secret: 'sec1', agent: 'agy' }, wsFile);
  const moveRes = registerWorkspace({ workDir: dirC, projectId: 'prj_move', secret: 'sec1', agent: 'claude' }, wsFile);

  assert.strictEqual(moveRes.registered, true);
  assert.strictEqual(moveRes.updated, true);
  assert.strictEqual(moveRes.movedFrom, path.resolve(dirA));
  assert.strictEqual(moveRes.total, 1);

  const list = loadWorkspaces(wsFile);
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].workDir, path.resolve(dirC));
  assert.strictEqual(list[0].agent, 'claude');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('MultiProjectWorker - resolveValidWorkspaces melakukan auto-prune direktori hilang dari workspaces.json', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tele-prune-ws-'));
  const wsFile = path.join(tmpDir, 'workspaces.json');

  const dirValid = path.join(tmpDir, 'valid');
  const dirGone = path.join(tmpDir, 'gone');
  fs.mkdirSync(dirValid, { recursive: true });

  saveConfig({ projectId: 'prj_valid', secret: 'sec_valid', agent: 'agy' }, dirValid);
  registerWorkspace({ workDir: dirValid, projectId: 'prj_valid', secret: 'sec_valid', agent: 'agy' }, wsFile);
  registerWorkspace({ workDir: dirGone, projectId: 'prj_gone', secret: 'sec_gone', agent: 'agy' }, wsFile);

  const mw = new MultiProjectWorker({ workspacesFile: wsFile });
  const valid = mw.resolveValidWorkspaces();

  assert.strictEqual(valid.length, 1);
  assert.strictEqual(valid[0].projectId, 'prj_valid');

  // Pastikan workspaces.json sudah bersih dari dirGone
  const persisted = loadWorkspaces(wsFile);
  assert.strictEqual(persisted.length, 1);
  assert.strictEqual(persisted[0].workDir, path.resolve(dirValid));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
