const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const TeleWorker = require('../src/worker/worker');
const {
  cleanTeleVsCliTrash,
  formatCleanupTable,
  formatCleanupTelegramHtml
} = require('../src/cli/commands/sampah');

test('Worker - parseSampahCommand mem-parsing /sampah dengan berbagai format', () => {
  assert.deepStrictEqual(TeleWorker.parseSampahCommand('/sampah'), { dryRun: false });
  assert.deepStrictEqual(TeleWorker.parseSampahCommand('/sampah@KeraKerjaBot'), { dryRun: false });
  assert.deepStrictEqual(TeleWorker.parseSampahCommand('/sampah --dry-run'), { dryRun: true });
  assert.strictEqual(TeleWorker.parseSampahCommand('tolong jalankan /sampah'), null);
});

test('Sampah - cleanTeleVsCliTrash membersihkan sampah tele-vs-cli lokal & global serta menjaga file user', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kerakerja-sampah-'));
  const workDir = path.join(tmpRoot, 'project');
  const homeDir = path.join(tmpRoot, 'home');
  const localAppData = path.join(tmpRoot, 'localappdata');

  try {
    fs.mkdirSync(path.join(workDir, 'logs'), { recursive: true });
    fs.mkdirSync(path.join(homeDir, '.tele-vs-cli'), { recursive: true });
    fs.mkdirSync(path.join(homeDir, '.config', 'tele-notify'), { recursive: true });
    fs.mkdirSync(path.join(localAppData, 'tele-vs-cli', 'bin'), { recursive: true });

    // Sampah lokal
    fs.writeFileSync(path.join(workDir, 'tele.config.json'), '{"secret":"old"}');
    fs.writeFileSync(path.join(workDir, 'kerakerja.config.json'), '{"projectId":"prj_1"}');
    fs.writeFileSync(path.join(workDir, 'tele-worker.pid'), '999999');
    fs.writeFileSync(path.join(workDir, 'tele-worker.log'), 'old log');
    fs.writeFileSync(path.join(workDir, 'logs', 'tele-worker.log'), 'old log 2');

    // Sampah global
    fs.writeFileSync(path.join(homeDir, '.tele-vs-cli', 'workspaces.json'), '[]');
    fs.writeFileSync(path.join(homeDir, '.config', 'tele-notify', 'config.env'), 'TOKEN=123');
    fs.writeFileSync(path.join(localAppData, 'tele-vs-cli', 'bin', 'tele.cmd'), '@echo off');

    // File proyek user yang harus tetap aman
    fs.writeFileSync(path.join(workDir, 'index.js'), 'console.log("safe");');

    const report = cleanTeleVsCliTrash({
      workDir,
      homeDir,
      localAppData,
      platform: 'win32',
      includeRegisteredWorkspaces: false,
      skipSystemCommands: true
    });

    assert.strictEqual(report.failedCount, 0);
    assert.ok(report.cleanedCount >= 6);
    assert.strictEqual(report.migratedCount, 1);

    // Config dimigrasi ke .biru/kerakerja.config.json + .htaccess proteksi
    assert.strictEqual(fs.existsSync(path.join(workDir, '.biru', 'kerakerja.config.json')), true);
    assert.strictEqual(fs.existsSync(path.join(workDir, '.biru', '.htaccess')), true);
    assert.strictEqual(fs.existsSync(path.join(workDir, 'kerakerja.config.json')), false);
    assert.strictEqual(fs.existsSync(path.join(workDir, 'tele.config.json')), false);

    // Sampah lokal & global terhapus
    assert.strictEqual(fs.existsSync(path.join(workDir, 'tele-worker.pid')), false);
    assert.strictEqual(fs.existsSync(path.join(workDir, 'tele-worker.log')), false);
    assert.strictEqual(fs.existsSync(path.join(workDir, 'logs', 'tele-worker.log')), false);
    assert.strictEqual(fs.existsSync(path.join(homeDir, '.tele-vs-cli')), false);
    assert.strictEqual(fs.existsSync(path.join(homeDir, '.config', 'tele-notify')), false);
    assert.strictEqual(fs.existsSync(path.join(localAppData, 'tele-vs-cli')), false);

    // File proyek user tetap ada
    assert.strictEqual(fs.existsSync(path.join(workDir, 'index.js')), true);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('Sampah - formatCleanupTable dan formatCleanupTelegramHtml membentuk tabel rapi', () => {
  const report = {
    dryRun: false,
    workDir: '/tmp/app',
    cleanedCount: 2,
    migratedCount: 0,
    failedCount: 0,
    totalBytes: 2048,
    items: [
      { item: 'tele.config.json', scope: 'Lokal', status: 'Dihapus', size: 1024, ok: true },
      { item: '~/.tele-vs-cli', scope: 'Global', status: 'Dihapus', size: 1024, ok: true }
    ]
  };

  const table = formatCleanupTable(report);
  assert.ok(table.includes('| No | Item'));
  assert.ok(table.includes('| Scope'));
  assert.ok(table.includes('| Status'));
  assert.ok(table.includes('tele.config.json'));
  assert.ok(table.includes('~/.tele-vs-cli'));

  const html = formatCleanupTelegramHtml(report, { projectId: 'prj_demo', timestamp: '2026-11-17 13:35:00' });
  assert.ok(html.includes('<pre>'));
  assert.ok(html.includes('</pre>'));
  assert.ok(html.includes('LAPORAN PEMBERSIHAN SAMPAH TELE-VS-CLI'));
  assert.ok(html.includes('2 dihapus, 0 dimigrasi'));

  const emptyTable = formatCleanupTable({ items: [] });
  assert.ok(emptyTable.includes('Sudah Bersih'));
});

test('CLI - kerakerja /sampah --dry-run --json --local-only berjalan sukses', () => {
  const binPath = path.join(__dirname, '..', 'bin', 'kerakerja.js');
  const out = execSync(`node "${binPath}" /sampah --dry-run --json --local-only`, { encoding: 'utf-8' });
  const parsed = JSON.parse(out);
  assert.strictEqual(parsed.dryRun, true);
  assert.ok(Array.isArray(parsed.items));
});

test('Sampah - membersihkan perintah tele-vs-code dari AGENTS.md & .vscode/tele-vs-code serta menambahkan aturan routing Telegram', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kerakerja-sampah-tvsc-'));
  try {
    fs.mkdirSync(path.join(tmpRoot, '.vscode', 'tele-vs-code'), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, '.vscode', 'tele-vs-code', 'tele-notify.js'), '// legacy');
    fs.writeFileSync(path.join(tmpRoot, 'AGENTS.md'), [
      '# 🤖 PANDUAN KERJA OTOMATIS AI AGENT (Tele-vs-Code)',
      '',
      '## 📢 2. NOTIFIKASI TELEGRAM',
      'Jalankan: `node .vscode/tele-vs-code/tele-notify.js "Tugas" --status SELESAI`',
      'Atau `node .vscode/tele-vs-code/tele-task.js done "#TASK-1" "OK"`',
      '',
      '## ✅ ATURAN PROYEK',
      '- Gunakan TypeScript strict.'
    ].join('\n'));

    const report = cleanTeleVsCliTrash({
      workDir: tmpRoot,
      cleanGlobal: false,
      includeRegisteredWorkspaces: false,
      skipSystemCommands: true
    });

    assert.strictEqual(report.failedCount, 0);
    assert.strictEqual(fs.existsSync(path.join(tmpRoot, '.vscode', 'tele-vs-code')), false);

    const updatedAgents = fs.readFileSync(path.join(tmpRoot, 'AGENTS.md'), 'utf-8');
    assert.strictEqual(/tele-notify\.js|tele-task\.js|\.vscode\/tele-vs-code/i.test(updatedAgents), false);
    assert.ok(updatedAgents.includes('Gunakan TypeScript strict.'));
    assert.ok(updatedAgents.includes('ATURAN ROUTING PENGIRIMAN TELEGRAM (ANTI-DUPLIKAT)'));
    assert.ok(updatedAgents.includes('Telegram KeraKerja'));
    assert.ok(updatedAgents.includes('setting `tele-vs-code`'));

    // Idempoten: jalankan ulang tidak menduplikasi aturan
    const report2 = cleanTeleVsCliTrash({
      workDir: tmpRoot,
      cleanGlobal: false,
      includeRegisteredWorkspaces: false,
      skipSystemCommands: true
    });
    assert.strictEqual(report2.items.length, 0);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
