const test = require('node:test');
const assert = require('node:assert');
const {
  stripAnsi,
  cleanMarkdownForReport,
  buildTaskPrompt,
  extractTaskSummary
} = require('../src/executor/report');

test('Report - stripAnsi menghapus kode warna dan kontrol terminal', () => {
  const raw = '\x1B[32mSukses\x1B[0m menjalankan \x1B[1mtest\x1B[22m';
  assert.strictEqual(stripAnsi(raw), 'Sukses menjalankan test');
});

test('Report - cleanMarkdownForReport membersihkan link file:/// dan bold markdown mentah', () => {
  const raw = [
    '- **Lokasi:** [jaran-03](file:///A:/ngodings/snapshot-kerakerja/jaran-03)',
    '- **Arsip:** [jaran-03.tar.gz](file:///A:/ngodings/snapshot-kerakerja/jaran-03/jaran-03.tar.gz) (994.624 byte)',
    '- **Docs:** [KeraKerja](https://biru.co.id/kerakerja/)'
  ].join('\n');

  const cleaned = cleanMarkdownForReport(raw);
  assert.ok(!cleaned.includes('file:///'));
  assert.ok(!cleaned.includes('**'));
  assert.ok(cleaned.includes('- Lokasi: jaran-03'));
  assert.ok(cleaned.includes('- Arsip: jaran-03.tar.gz (994.624 byte)'));
  assert.ok(cleaned.includes('- Docs: KeraKerja (https://biru.co.id/kerakerja/)'));
});

test('Report - buildTaskPrompt menyertakan instruksi laporan hasil terstruktur', () => {
  const prompt = buildTaskPrompt({ id: 'TASK-1474' }, 'perbaiki laporan hasil pekerjaan');
  assert.ok(prompt.includes('Tugas #TASK-1474: perbaiki laporan hasil pekerjaan.'));
  assert.ok(prompt.includes('Ringkasan Hasil:'));
  assert.ok(prompt.includes('Detail pekerjaan/perubahan'));
  assert.ok(prompt.includes('Hasil pengujian'));
});

test('Report - extractTaskSummary memprioritaskan bagian Ringkasan Hasil dan mempertahankan baris baru', () => {
  const stdout = [
    'Membaca file proyek...',
    'Menjalankan analisis awal...',
    'Mengedit beberapa file...',
    '',
    'Ringkasan Hasil:',
    '- **Perbaikan:** Menambahkan ekstraktor laporan hasil pekerjaan di `src/executor/report.js`',
    '- **Integrasi:** Memperbarui `src/executor/cli.js` agar tidak memotong 300 karakter',
    '- **Pengujian:** Seluruh 105 unit test lulus tanpa error'
  ].join('\n');

  const summary = extractTaskSummary(stdout, '', 0);
  assert.ok(summary.startsWith('Ringkasan Hasil:'));
  assert.ok(summary.includes('\n- Perbaikan:'));
  assert.ok(summary.includes('\n- Integrasi:'));
  assert.ok(summary.includes('\n- Pengujian: Seluruh 105 unit test lulus tanpa error'));
  assert.ok(!summary.includes('Membaca file proyek...'));
});

test('Report - extractTaskSummary tidak memotong laporan di 300 karakter dan memakai stderr saat gagal tanpa stdout', () => {
  const longDetail = Array.from({ length: 8 }, (_, i) => `- Poin ${i + 1}: Perubahan detail komponen ke-${i + 1} telah diverifikasi dengan lengkap.`).join('\n');
  const summary = extractTaskSummary(longDetail, '', 0);
  assert.ok(summary.length > 300, 'Ringkasan detail harus bisa lebih dari 300 karakter');
  assert.ok(summary.includes('- Poin 1:'));
  assert.ok(summary.includes('- Poin 8:'));

  const errSummary = extractTaskSummary('', '\x1B[31mError: koneksi gagal\x1B[0m', 1);
  assert.strictEqual(errSummary, 'Error: koneksi gagal');
});
