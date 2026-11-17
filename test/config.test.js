const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadConfig, saveConfig } = require('../src/config/config');

test('Config - Memuat konfigurasi default dengan benar', () => {
  const cfg = loadConfig(__dirname);
  assert.ok(cfg.serverUrl);
  assert.ok(cfg.taskTimeout > 0);
  assert.ok(cfg.pollInterval > 0);
});

test('Config - Menyimpan dan membaca tele.config.json', () => {
  const tmpDir = path.join(__dirname, 'tmp_cfg');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const custom = {
    serverUrl: 'https://biru.co.id/kerakerja/',
    secret: 'test_secret_123',
    projectId: 'test_project',
    agent: 'claude',
    taskTimeout: 300000,
    pollInterval: 3000
  };

  saveConfig(custom, tmpDir);
  const loaded = loadConfig(tmpDir);

  assert.strictEqual(loaded.serverUrl, 'https://biru.co.id/kerakerja/');
  assert.strictEqual(loaded.secret, 'test_secret_123');
  assert.strictEqual(loaded.projectId, 'test_project');
  assert.strictEqual(loaded.agent, 'claude');

  // Bersihkan folder sementara
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
