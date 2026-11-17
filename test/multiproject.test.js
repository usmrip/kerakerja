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
  assert.strictEqual(list[0].projectId, 'prj_a_updated');
  assert.strictEqual(list[0].agent, 'gemini');
  assert.strictEqual(list[1].projectId, 'prj_b');

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
