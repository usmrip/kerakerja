const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TeleWorker = require('../src/worker/worker');
const {
  getSnapshotRoot,
  parseSnapshotParams,
  detectDatabaseConfig,
  resolveSnapshotInputs,
  createSnapshot,
  listSnapshots,
  restoreSnapshot,
  buildRestoreTelegramPayload,
  formatSnapshotSuccessHtml
} = require('../src/cli/commands/snapshot');

test('Worker - parseSnapshotCommand dan parseRestoreCommand mem-parsing berbagai format', () => {
  assert.deepStrictEqual(TeleWorker.parseSnapshotCommand('/snapshot rilis full'), { args: ['rilis', 'full'] });
  assert.deepStrictEqual(TeleWorker.parseSnapshotCommand('/snapshot@KeraKerjaBot rilis db,kode'), { args: ['rilis', 'db,kode'] });
  assert.deepStrictEqual(TeleWorker.parseSnapshotCommand('/snapshot'), { args: [] });
  assert.strictEqual(TeleWorker.parseSnapshotCommand('buat /snapshot nanti'), null);

  assert.deepStrictEqual(TeleWorker.parseRestoreCommand('/restore rilis-01'), { code: 'rilis-01' });
  assert.deepStrictEqual(TeleWorker.parseRestoreCommand('/restore@KeraKerjaBot'), { code: '' });
  assert.strictEqual(TeleWorker.parseRestoreCommand('tolong /restore'), null);
});

test('Snapshot - parseSnapshotParams menangani full, db, kode, upload, dan db,kode', () => {
  assert.deepStrictEqual(parseSnapshotParams('full').includes, { kode: true, db: true, upload: true });
  assert.deepStrictEqual(parseSnapshotParams('db').includes, { kode: false, db: true, upload: false });
  assert.deepStrictEqual(parseSnapshotParams('kode').includes, { kode: true, db: false, upload: false });
  assert.deepStrictEqual(parseSnapshotParams('upload').includes, { kode: false, db: false, upload: true });
  assert.deepStrictEqual(parseSnapshotParams('db,kode').includes, { kode: true, db: true, upload: false });
  assert.strictEqual(parseSnapshotParams('unknown_param').ok, false);
});

test('Snapshot & Restore - penomoran otomatis (-01, -02), lokasi sejajar snapshot-kerakerja, restore kode lengkap & 4 tombol terakhir', () => {
  const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kerakerja-snap-'));
  const workDir = path.join(parentDir, 'myapp');

  try {
    fs.mkdirSync(path.join(workDir, 'data'), { recursive: true });
    fs.mkdirSync(path.join(workDir, 'uploads'), { recursive: true });
    fs.writeFileSync(path.join(workDir, 'app.js'), 'v1');
    fs.writeFileSync(path.join(workDir, 'data', 'app.db'), 'db-v1');
    fs.writeFileSync(path.join(workDir, 'uploads', 'pic.png'), 'img-v1');

    // Pertama kali tanpa kode harus ditolak
    const firstMissing = resolveSnapshotInputs([], workDir);
    assert.strictEqual(firstMissing.ok, false);

    // Snapshot pertama: rilis-01 (full)
    const r1 = resolveSnapshotInputs(['rilis', 'full'], workDir);
    assert.strictEqual(r1.ok, true);
    const s1 = createSnapshot({ workDir, baseCode: r1.baseCode, paramRes: r1.paramRes, projectId: 'prj_test' });
    assert.strictEqual(s1.meta.code, 'rilis-01');
    const tgHtml = formatSnapshotSuccessHtml(s1);
    assert.ok(tgHtml.includes('rilis-01'));
    assert.ok(tgHtml.includes('rilis-01.tar.gz'));
    assert.ok(tgHtml.includes('Folder:'));
    assert.ok(tgHtml.includes('Archive:'));
    assert.ok(tgHtml.includes('meta.json'));
    assert.strictEqual(s1.snapshotRoot, path.join(parentDir, 'snapshot-kerakerja'));
    assert.strictEqual(getSnapshotRoot(workDir), path.join(parentDir, 'snapshot-kerakerja'));
    assert.strictEqual(fs.existsSync(path.join(s1.snapshotDir, 'rilis-01.tar.gz')), true);
    assert.strictEqual(fs.existsSync(path.join(s1.snapshotDir, 'kode')), false);

    // Ubah file lalu buat snapshot kedua tanpa menulis ulang kode -> otomatis rilis-02 (db,kode)
    fs.writeFileSync(path.join(workDir, 'app.js'), 'v2');
    fs.writeFileSync(path.join(workDir, 'data', 'app.db'), 'db-v2');
    const r2 = resolveSnapshotInputs(['db,kode'], workDir);
    assert.strictEqual(r2.ok, true);
    const s2 = createSnapshot({ workDir, baseCode: r2.baseCode, paramRes: r2.paramRes, projectId: 'prj_test' });
    assert.strictEqual(s2.meta.code, 'rilis-02');
    assert.strictEqual(fs.existsSync(path.join(s2.snapshotDir, 'rilis-02.tar.gz')), true);
    assert.strictEqual(s2.meta.stats.kodeFiles, 3);
    assert.strictEqual(s2.meta.stats.dbFiles, 1);
    assert.strictEqual(s2.meta.stats.uploadFiles, 0);

    // Tambah snapshot 03, 04, 05 untuk uji batas 4 tombol terakhir
    for (const p of ['db', 'kode', 'upload']) {
      const rx = resolveSnapshotInputs(['rilis', p], workDir);
      createSnapshot({ workDir, baseCode: rx.baseCode, paramRes: rx.paramRes, projectId: 'prj_test' });
    }

    const { snapshots, latest } = listSnapshots(workDir, 4);
    assert.strictEqual(snapshots.length, 5);
    assert.strictEqual(latest.length, 4);
    assert.strictEqual(latest[0].code, 'rilis-05');

    // Tombol Telegram berisi 4 snapshot terakhir
    const tgPayload = buildRestoreTelegramPayload(latest, 'prj_test');
    assert.strictEqual(tgPayload.extra.reply_markup.inline_keyboard.length, 4);
    assert.strictEqual(tgPayload.extra.reply_markup.inline_keyboard[0][0].callback_data, 'cb:restore:rilis-05');

    // Restore dengan kode tidak lengkap harus gagal dan menyarankan 4 snapshot terakhir
    const badRestore = restoreSnapshot({ workDir, code: 'rilis' });
    assert.strictEqual(badRestore.ok, false);
    assert.strictEqual(badRestore.latest.length, 4);

    // Restore dengan kode lengkap rilis-01 mengembalikan file v1
    const okRestore = restoreSnapshot({ workDir, code: 'rilis-01' });
    assert.strictEqual(okRestore.ok, true);
    assert.strictEqual(fs.readFileSync(path.join(workDir, 'app.js'), 'utf-8'), 'v1');
    assert.strictEqual(fs.readFileSync(path.join(workDir, 'data', 'app.db'), 'utf-8'), 'db-v1');
    assert.strictEqual(fs.readFileSync(path.join(workDir, 'uploads', 'pic.png'), 'utf-8'), 'img-v1');
  } finally {
    fs.rmSync(parentDir, { recursive: true, force: true });
  }
});

test('Snapshot - detectDatabaseConfig membaca config CodeIgniter 4 dan WordPress', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kerakerja-dbcfg-'));
  try {
    const ci4Dir = path.join(tmpRoot, 'ci4');
    fs.mkdirSync(path.join(ci4Dir, 'app', 'Config'), { recursive: true });
    fs.writeFileSync(path.join(ci4Dir, 'app', 'Config', 'Database.php'), `<?php
class Database {
  public $default = [
    'hostname' => 'localhost',
    'username' => 'biru_user',
    'password' => 'secret_pw',
    'database' => 'biru_hai_db',
    'DBDriver' => 'MySQLi',
    'port' => 3306,
  ];
}`);
    const ci4Cfg = detectDatabaseConfig(ci4Dir);
    assert.strictEqual(ci4Cfg.source, 'app/Config/Database.php');
    assert.strictEqual(ci4Cfg.driver, 'mysql');
    assert.strictEqual(ci4Cfg.database, 'biru_hai_db');
    assert.strictEqual(ci4Cfg.username, 'biru_user');
    assert.strictEqual(ci4Cfg.port, '3306');

    const wpDir = path.join(tmpRoot, 'wp');
    fs.mkdirSync(wpDir, { recursive: true });
    fs.writeFileSync(path.join(wpDir, 'wp-config.php'), `<?php
define('DB_NAME', 'wp_site');
define('DB_USER', 'wp_admin');
define('DB_PASSWORD', 'wp_pass');
define('DB_HOST', '127.0.0.1');
`);
    const wpCfg = detectDatabaseConfig(wpDir);
    assert.strictEqual(wpCfg.source, 'wp-config.php');
    assert.strictEqual(wpCfg.database, 'wp_site');
    assert.strictEqual(wpCfg.username, 'wp_admin');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
