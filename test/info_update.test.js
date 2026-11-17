const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { execSync } = require('child_process');

const TeleWorker = require('../src/worker/worker');
const { buildInfoData, formatInfoTelegramHtml } = require('../src/cli/commands/info');

test('Worker - parseInfoCommand mem-parsing /info dengan berbagai format', () => {
  assert.strictEqual(TeleWorker.parseInfoCommand('/info'), true);
  assert.strictEqual(TeleWorker.parseInfoCommand('/info@KeraKerjaBot'), true);
  assert.strictEqual(TeleWorker.parseInfoCommand('tolong /info'), false);
});

test('Info - buildInfoData dan formatInfoTelegramHtml mengembalikan versi & tanggal update terakhir', () => {
  const info = buildInfoData(process.cwd());
  assert.ok(info.version);
  assert.ok(info.lastUpdateDate);
  const html = formatInfoTelegramHtml(info);
  assert.ok(html.includes('INFORMASI VERSI KERAKERJA'));
  assert.ok(html.includes(`v${info.version}`));
  assert.ok(html.includes(info.lastUpdateDate));
});

test('CLI - kerakerja info --json dan /info --json berjalan sukses', () => {
  const binPath = path.join(__dirname, '..', 'bin', 'kerakerja.js');
  const out = execSync(`node "${binPath}" info --json`, { encoding: 'utf-8' });
  const parsed = JSON.parse(out);
  assert.strictEqual(parsed.name, 'KeraKerja');
  assert.ok(parsed.version);
  assert.ok(parsed.lastUpdateDate);

  const slashOut = execSync(`node "${binPath}" /info --json`, { encoding: 'utf-8' });
  const slashParsed = JSON.parse(slashOut);
  assert.strictEqual(slashParsed.name, 'KeraKerja');
});
