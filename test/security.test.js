const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { maskSecrets, validateWorkDir, isDangerousSystemCommand } = require('../src/security/guard');

test('Security Guard - maskSecrets menyamarkan token telegram dan secret key', () => {
  const sample = 'Token 1234567890:ABCdefGhIJKlmNoPQRsTUVwxyZ1234567, key tvscli_abcdef1234567890abcdef123456, dan legacy tvsc_abcdef1234567890abcdef123456';
  const masked = maskSecrets(sample);
  assert.ok(!masked.includes('1234567890:ABCdefGhIJKlmNoPQRsTUVwxyZ1234567'));
  assert.ok(!masked.includes('tvscli_abcdef1234567890abcdef123456'));
  assert.ok(!masked.includes('tvsc_abcdef1234567890abcdef123456'));
  assert.ok(masked.includes('[TELEGRAM_BOT_TOKEN_PROTECTED]'));
  assert.ok(masked.includes('[API_SECRET_PROTECTED]'));
});

test('Security Guard - validateWorkDir mengizinkan subpath yang valid', () => {
  const root = path.resolve(__dirname, '..');
  const valid = validateWorkDir('src', root);
  assert.strictEqual(valid, path.join(root, 'src'));
});

test('Security Guard - validateWorkDir menolak path traversal', () => {
  const root = path.resolve(__dirname, '..');
  assert.throws(() => {
    validateWorkDir('../../etc/passwd', root);
  }, /Path traversal ditolak/);
});

test('Security Guard - isDangerousSystemCommand mendeteksi perintah berbahaya', () => {
  assert.strictEqual(isDangerousSystemCommand('reboot now'), true);
  assert.strictEqual(isDangerousSystemCommand('shutdown -h now'), true);
  assert.strictEqual(isDangerousSystemCommand('rm -rf /'), true);
  assert.strictEqual(isDangerousSystemCommand('Restart-Computer -Force'), true);
  assert.strictEqual(isDangerousSystemCommand('format c:'), true);
  assert.strictEqual(isDangerousSystemCommand('node bin/tele.js start'), false);
  assert.strictEqual(isDangerousSystemCommand('buat fitur login jwt'), false);
});
