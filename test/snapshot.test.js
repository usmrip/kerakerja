const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TeleWorker = require('../src/worker/worker');
const {
  getSnapshotRoot,
  parseSnapshotParams,
  resolveSnapshotInputs,
  createSnapshot,
  listSnapshots,
  restoreSnapshot,
  buildRestoreTelegramPayload
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
    assert.strictEqual(s1.snapshotRoot, path.join(parentDir, 'snapshot-kerakerja'));
    assert.strictEqual(getSnapshotRoot(workDir), path.join(parentDir, 'snapshot-kerakerja'));
    assert.strictEqual(fs.existsSync(path.join(s1.snapshotDir, 'kode', 'app.js')), true);
    assert.strictEqual(fs.existsSync(path.join(s1.snapshotDir, 'db', 'sqlite', 'data', 'app.db')), true);
    assert.strictEqual(fs.existsSync(path.join(s1.snapshotDir, 'upload', 'uploads', 'pic.png')), true);

    // Ubah file lalu buat snapshot kedua tanpa menulis ulang kode -> otomatis rilis-02 (db,kode)
    fs.writeFileSync(path.join(workDir, 'app.js'), 'v2');
    fs.writeFileSync(path.join(workDir, 'data', 'app.db'), 'db-v2');
    const r2 = resolveSnapshotInputs(['db,kode'], workDir);
    assert.strictEqual(r2.ok, true);
    const s2 = createSnapshot({ workDir, baseCode: r2.baseCode, paramRes: r2.paramRes, projectId: 'prj_test' });
    assert.strictEqual(s2.meta.code, 'rilis-02');
    assert.strictEqual(fs.existsSync(path.join(s2.snapshotDir, 'kode', 'app.js')), true);
    assert.strictEqual(fs.existsSync(path.join(s2.snapshotDir, 'db', 'sqlite', 'data', 'app.db')), true);
    assert.strictEqual(fs.existsSync(path.join(s2.snapshotDir, 'upload')), false);

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
