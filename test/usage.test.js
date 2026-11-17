const test = require('node:test');
const assert = require('node:assert');
const { execSync } = require('child_process');
const path = require('path');
const {
  tsMs,
  fmtReset,
  parseCredential,
  buildReport,
  render,
  renderTelegram,
  UsageError
} = require('../src/utils/agy_usage');

test('agy_usage - tsMs mem-parsing timestamp angka dan ISO dengan presisi', () => {
  const iso = '2026-11-21T05:16:14.123456Z';
  const ms = tsMs(iso);
  assert.ok(typeof ms === 'number');
  assert.strictEqual(tsMs(null), null);
  assert.strictEqual(tsMs(''), null);
  assert.strictEqual(tsMs(1731730000), 1731730000000);
});

test('agy_usage - fmtReset menghitung sisa waktu reset dengan benar', () => {
  const now = Date.parse('2026-11-16T12:00:00Z');
  assert.strictEqual(fmtReset(null, now), 'reset unknown');
  assert.strictEqual(fmtReset('2026-11-16T11:00:00Z', now), 'resets soon');
  assert.strictEqual(fmtReset('2026-11-16T15:00:00Z', now), 'resets 3h');
  assert.strictEqual(fmtReset('2026-11-16T12:30:00Z', now), 'resets 30m');
  assert.strictEqual(fmtReset('2026-11-18T12:00:00Z', now), 'resets 2d');
});

test('agy_usage - parseCredential mem-parsing json token dan keyring base64', () => {
  const sampleJson = JSON.stringify({
    token: {
      access_token: 'ya29.sample_test_token',
      expiry: 1731750000000
    },
    id_token_email: 'tester@example.com'
  });

  const cred1 = parseCredential(sampleJson);
  assert.strictEqual(cred1.token, 'ya29.sample_test_token');
  assert.strictEqual(cred1.email, 'tester@example.com');
  assert.strictEqual(cred1.exp, 1731750000000);

  const b64 = 'go-keyring-base64:' + Buffer.from(sampleJson).toString('base64');
  const cred2 = parseCredential(b64);
  assert.strictEqual(cred2.token, 'ya29.sample_test_token');
  assert.strictEqual(cred2.email, 'tester@example.com');

  assert.throws(() => parseCredential('invalid-json'), UsageError);
});

test('agy_usage - buildReport membangun struktur laporan bucket yang valid', () => {
  const doc = {
    groups: [
      {
        buckets: [
          { bucketId: 'gemini-5h', remainingFraction: 0.95, resetTime: '2026-11-16T17:00:00Z' },
          { bucketId: 'gemini-weekly', remainingFraction: 0.60, resetTime: '2026-11-21T00:00:00Z' },
          { bucketId: '3p-5h', remainingFraction: 1.0, resetTime: '2026-11-16T18:00:00Z' },
          { bucketId: '3p-weekly', remainingFraction: 0.85, resetTime: '2026-11-23T00:00:00Z' },
          { bucketId: 'gemini-argon-wtu-weekly', remainingFraction: 0.30, resetTime: '2026-11-21T12:00:00Z' }
        ]
      }
    ]
  };

  const rep = buildReport(doc, 'Google AI Pro');
  assert.strictEqual(rep.plan, 'Google AI Pro');
  assert.strictEqual(rep.windows.length, 5);

  const g5h = rep.windows.find(w => w.id === 'gemini-5h');
  assert.strictEqual(g5h.usedPct, 5);
  assert.strictEqual(g5h.label, 'Gemini · 5h');

  const gWk = rep.windows.find(w => w.id === 'gemini-weekly');
  assert.strictEqual(gWk.usedPct, 40);

  const p5h = rep.windows.find(w => w.id === '3p-5h');
  assert.strictEqual(p5h.usedPct, 0);
});

test('agy_usage - render dan renderTelegram memformat teks dan HTML yang rapi', () => {
  const rep = {
    plan: 'Google AI Pro',
    windows: [
      { id: 'gemini-5h', label: 'Gemini · 5h', usedPct: 10, resetsAt: '2026-11-16T17:00:00Z' },
      { id: 'gemini-weekly', label: 'Gemini · Weekly', usedPct: 35, resetsAt: '2026-11-21T00:00:00Z' },
      { id: '3p-5h', label: 'Claude & GPT · 5h', usedPct: 0, resetsAt: '2026-11-16T18:00:00Z' },
      { id: '3p-weekly', label: 'Claude & GPT · Weekly', usedPct: 0, resetsAt: '2026-11-23T00:00:00Z' },
      { id: 'gemini-argon-wtu-weekly', label: 'Gemini 4 Argon · Weekly', usedPct: 75, resetsAt: '2026-11-21T12:00:00Z' }
    ],
    notes: [],
    email: 'tester@example.com',
    fetchedAt: '2026-11-16T10:00:00.000Z'
  };

  const terminalOut = render(rep, { color: false, hideEmail: false });
  assert.ok(terminalOut.includes('Antigravity  [Google AI Pro]'));
  assert.ok(terminalOut.includes('Gemini · 5h'));
  assert.ok(terminalOut.includes('90% left'));
  assert.ok(terminalOut.includes('tester@example.com'));

  const teleOut = renderTelegram(rep, { hideEmail: false });
  assert.ok(teleOut.includes('🔋 <b>Antigravity Quota Usage</b> [<code>Google AI Pro</code>]'));
  assert.ok(teleOut.includes('Gemini · 5h'));
  assert.ok(teleOut.includes('90% left'));
  assert.ok(teleOut.includes('tester@example.com'));
});

test('CLI - kerakerja usage --json menghasilkan output JSON valid', () => {
  const binPath = path.join(__dirname, '..', 'bin', 'kerakerja.js');
  const out = execSync(`node "${binPath}" usage --json`, { encoding: 'utf-8' });
  const data = JSON.parse(out);
  assert.ok(data.plan);
  assert.ok(Array.isArray(data.windows));
  assert.ok(data.windows.length >= 4);
  assert.ok(data.fetchedAt);
});

test('CLI - kerakerja usage --help mencetak bantuan penggunaan', () => {
  const binPath = path.join(__dirname, '..', 'bin', 'kerakerja.js');
  const out = execSync(`node "${binPath}" usage --help`, { encoding: 'utf-8' });
  assert.ok(out.includes('kerakerja usage'));
  assert.ok(out.includes('--json'));
  assert.ok(out.includes('--watch'));
});
