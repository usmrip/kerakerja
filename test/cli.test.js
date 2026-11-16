const test = require('node:test');
const assert = require('node:assert');
const { execSync } = require('child_process');
const path = require('path');

test('CLI - tele help berjalan dengan exit code 0', () => {
  const binPath = path.join(__dirname, '..', 'bin', 'tele.js');
  const out = execSync(`node "${binPath}" help`, { encoding: 'utf-8' });
  assert.ok(out.includes('Tele-vs-CLI'));
  assert.ok(out.includes('doctor'));
  assert.ok(out.includes('start'));
});
