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

test('Config - Menyimpan dan membaca .biru/kerakerja.config.json beserta .htaccess proteksi publik', () => {
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

  const savedPath = saveConfig(custom, tmpDir);
  assert.strictEqual(savedPath, path.join(tmpDir, '.biru', 'kerakerja.config.json'));
  assert.strictEqual(fs.existsSync(savedPath), true);

  const htaccessPath = path.join(tmpDir, '.biru', '.htaccess');
  assert.strictEqual(fs.existsSync(htaccessPath), true);
  const htContent = fs.readFileSync(htaccessPath, 'utf-8');
  assert.ok(htContent.includes('Require all denied'));
  assert.ok(htContent.includes('Deny from all'));

  const loaded = loadConfig(tmpDir);

  assert.strictEqual(loaded.serverUrl, 'https://biru.co.id/kerakerja/');
  assert.strictEqual(loaded.secret, 'test_secret_123');
  assert.strictEqual(loaded.projectId, 'test_project');
  assert.strictEqual(loaded.agent, 'claude');
  assert.strictEqual(loaded.jsonConfigPath, savedPath);

  // Bersihkan folder sementara
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
