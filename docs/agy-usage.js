#!/usr/bin/env node
'use strict';
// agy-usage — lihat sisa kuota Antigravity (agy) di terminal. Satu akun aktif, tanpa dependensi, tanpa config. Butuh Node 18+.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const BASE = 'https://daily-cloudcode-pa.googleapis.com/v1internal:';
const HOME = os.homedir();
const TOKEN_FILE = path.join(HOME, '.gemini', 'antigravity-cli', 'antigravity-oauth-token');
const FALLBACK_VERSION = '1.5.9'; // dipakai hanya jika `agy --version` tidak bisa dijalankan
const BUCKETS = [
  { id: 'gemini-5h', label: 'Gemini · 5h' },
  { id: 'gemini-weekly', label: 'Gemini · Weekly' },
  { id: '3p-5h', label: 'Claude & GPT · 5h' },
  { id: '3p-weekly', label: 'Claude & GPT · Weekly' },
  { id: 'gemini-argon-wtu-weekly', label: 'Gemini 4 Argon · Weekly', optional: true },
];

class UsageError extends Error {
  constructor(message, status = 0) { super(message); this.status = status; }
}

const run = (file, args, timeout = 8000) => new Promise(resolve => {
  execFile(file, args, { timeout, maxBuffer: 128 * 1024, windowsHide: true }, (err, stdout) =>
    resolve({ stdout: String(stdout || ''), code: err ? (typeof err.code === 'number' ? err.code : -1) : 0 }));
});

function tsMs(v) {
  if (typeof v === 'string') { v = v.trim().replace(/(\.\d{3})\d+/, '$1'); if (!v) return null; }
  else if (typeof v !== 'number') return null;
  const n = Number(v);
  const ms = Number.isFinite(n) ? (n < 1e11 ? n * 1000 : n) : Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

function emailFromJwt(j) {
  if (typeof j !== 'string') return null;
  const p = j.split('.');
  if (p.length !== 3) return null;
  try {
    const e = JSON.parse(Buffer.from(p[1], 'base64url').toString('utf8')).email;
    return typeof e === 'string' && e.includes('@') ? e : null;
  } catch { return null; }
}

function parseCredential(raw) {
  raw = raw.trim();
  const pre = 'go-keyring-base64:';
  if (raw.startsWith(pre)) raw = Buffer.from(raw.slice(pre.length), 'base64').toString('utf8');
  let d;
  try { d = JSON.parse(raw); } catch { try { d = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')); } catch { /* ditangani di bawah */ } }
  if (!d || typeof d !== 'object') throw new UsageError('Isi token agy bukan JSON yang valid.');
  const t = d.token && typeof d.token === 'object' ? d.token : d;
  const token = t.access_token || t.accessToken || null;
  if (!token && !t.refresh_token && !t.refreshToken) throw new UsageError('Token agy tidak berisi login OAuth.');
  return {
    token,
    exp: tsMs(t.expiry ?? t.expires_at ?? t.expiresAt ?? t.expiry_date),
    email: d.id_token_email || d.email || t.email || emailFromJwt(d.id_token ?? d.idToken ?? t.id_token ?? t.idToken) || null,
  };
}

// Baca login agy: file token dulu (agy terbaru), keyring macOS/Linux sebagai cadangan.
async function readCredential() {
  try {
    const raw = await fs.promises.readFile(TOKEN_FILE, 'utf8');
    if (raw.trim()) return parseCredential(raw);
  } catch (e) {
    if (e instanceof UsageError) throw e;
    if (e.code !== 'ENOENT') throw new UsageError('File token agy tidak bisa dibaca. Jalankan sebagai user yang login agy.');
  }
  let r = null;
  if (process.platform === 'darwin') r = await run('/usr/bin/security', ['find-generic-password', '-s', 'gemini', '-a', 'antigravity', '-w']);
  else if (process.platform === 'linux') r = await run('secret-tool', ['lookup', 'service', 'gemini', 'username', 'antigravity']);
  if (r && r.code === 0 && r.stdout.trim()) return parseCredential(r.stdout);
  throw new UsageError('Login agy tidak ditemukan. Masuk dulu dengan perintah: agy');
}

async function findAgy() {
  const win = process.platform === 'win32';
  const names = win ? ['agy.exe', 'agy.cmd'] : ['agy'];
  const dirs = [
    ...(process.env.PATH || '').split(path.delimiter),
    path.join(HOME, '.local', 'bin'), path.join(HOME, '.gemini', 'bin'),
    path.join(HOME, '.gemini', 'antigravity-cli', 'bin'), path.join(HOME, '.antigravity', 'bin'),
    '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin',
  ].filter(Boolean);
  for (const x of [process.env.AGY_PATH, process.env.ANTIGRAVITY_CLI_PATH]) if (x) dirs.unshift(x);
  for (const d of dirs) for (const n of names) {
    for (const f of [path.join(d, n), d]) {
      try {
        if (!(await fs.promises.stat(f)).isFile()) continue;
        await fs.promises.access(f, win ? fs.constants.F_OK : fs.constants.X_OK);
        return f;
      } catch { /* coba kandidat berikutnya */ }
    }
  }
  return null;
}

let versionCache = null;
async function cliVersion() {
  if (versionCache) return versionCache;
  versionCache = FALLBACK_VERSION;
  const bin = await findAgy();
  if (bin) {
    const r = await run(bin, ['--version'], 5000);
    const out = r.stdout.trim();
    if (r.code === 0 && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/.test(out)) versionCache = out;
  }
  return versionCache;
}

async function call(method, token, ua) {
  let res;
  try {
    res = await fetch(BASE + method, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${token}`, 'user-agent': ua },
      body: method === 'loadCodeAssist' ? JSON.stringify({ metadata: { ideType: 'ANTIGRAVITY' } }) : '{}',
      redirect: 'error', // jangan teruskan bearer token ke host lain
      signal: AbortSignal.timeout(12000),
    });
  } catch { throw new UsageError(`Permintaan ${method} gagal. Periksa koneksi internet.`); }
  if (!res.ok) throw new UsageError(`Permintaan kuota Antigravity gagal (HTTP ${res.status}).`, res.status);
  try { return await res.json(); } catch { throw new UsageError(`${method} mengembalikan JSON yang tidak valid.`); }
}

function tierLabel(d) {
  const id = typeof d?.g1Tier === 'string' && d.g1Tier ? d.g1Tier : (d?.paidTier?.id || d?.currentTier?.id);
  if (typeof id !== 'string' || !id) return null;
  return { 'free-tier': 'Free tier', 'standard-tier': 'Standard tier', 'g1-pro-tier': 'Google AI Pro', 'g1-ultra-tier': 'Google AI Ultra' }[id] || id;
}

function buildReport(doc, plan) {
  if (!Array.isArray(doc?.groups)) throw new UsageError('Antigravity mengirim ringkasan kuota yang tidak valid.');
  const by = new Map();
  for (const g of doc.groups) for (const b of (Array.isArray(g?.buckets) ? g.buckets : [])) {
    if (b && typeof b.bucketId === 'string' && !by.has(b.bucketId)) by.set(b.bucketId, b);
  }
  if (!BUCKETS.some(b => by.has(b.id))) throw new UsageError('Antigravity tidak melaporkan kuota Gemini atau Claude & GPT untuk login ini.');
  const windows = BUCKETS.filter(b => !b.optional || by.has(b.id)).map(b => {
    const x = by.get(b.id);
    const r = x?.remainingFraction;
    const reset = tsMs(x?.resetTime);
    return {
      id: b.id, label: b.label,
      usedPct: typeof r === 'number' && Number.isFinite(r) ? Math.round(Math.max(0, Math.min(100, (1 - r) * 100)) * 10) / 10 : null,
      resetsAt: reset === null ? null : new Date(reset).toISOString(),
    };
  });
  if (windows.every(w => w.usedPct === null)) throw new UsageError('Bucket kuota tidak berisi nilai remainingFraction yang valid.');
  const notes = [];
  if (plan === 'Free tier') notes.push('Di paket Free, bucket 5 jam bisa tetap penuh; pantau konsumsi lewat bucket mingguan.');
  if (windows.some(w => w.usedPct === null)) notes.push('Sebagian bucket tidak ada datanya; pemakaiannya tidak diketahui, bukan nol.');
  return { plan, windows, notes };
}

async function fetchReport() {
  const ua = 'antigravity/cli/' + await cliVersion();
  for (let i = 0; i < 2; i++) {
    const c = await readCredential();
    const expired = !c.token || (c.exp !== null && c.exp <= Date.now() + 60000);
    if (!expired) {
      try {
        const [quota, plan] = await Promise.all([
          call('retrieveUserQuotaSummary', c.token, ua),
          call('loadCodeAssist', c.token, ua).then(tierLabel).catch(() => null),
        ]);
        return { ...buildReport(quota, plan), email: c.email, fetchedAt: new Date().toISOString() };
      } catch (e) { if (![401, 403].includes(e.status)) throw e; }
    }
    if (i === 1) break;
    // Biarkan agy memperbarui login-nya sendiri; refresh token tidak pernah kita tukar.
    const bin = await findAgy();
    if (!bin) throw new UsageError('Binary agy tidak ditemukan untuk memperbarui login.');
    if ((await run(bin, ['models'], 10000)).code !== 0) throw new UsageError('Pembaruan login agy gagal. Masuk ulang dengan perintah: agy');
  }
  throw new UsageError('Login agy kedaluwarsa atau ditolak. Masuk ulang dengan perintah: agy');
}

// ---- Tampilan terminal ----
function fmtReset(iso, now = Date.now()) {
  if (!iso) return 'reset unknown';
  const ms = Date.parse(iso) - now;
  if (!(ms > 0)) return 'resets soon';
  const m = Math.round(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  return 'resets ' + (d >= 1 ? d + 'd' : h >= 1 ? h + 'h' : m + 'm');
}

function render(r, { color = false, hideEmail = false, now = Date.now() } = {}) {
  const paint = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
  const W = 24, labelW = Math.max(...r.windows.map(w => w.label.length));
  const out = [paint('1', 'Antigravity') + (r.plan ? '  ' + paint('2', `[${r.plan}]`) : '')];
  for (const w of r.windows) {
    const label = paint('2', w.label.padEnd(labelW));
    if (w.usedPct === null) { out.push(`${label}  ${paint('2', '░'.repeat(W))}  no data`); continue; }
    const left = Math.round(100 - w.usedPct);
    const filled = Math.round((left / 100) * W);
    const tone = w.usedPct >= 90 ? '31' : w.usedPct >= 70 ? '33' : '32';
    const bar = paint(tone, '█'.repeat(filled)) + paint('2', '░'.repeat(W - filled));
    out.push(`${label}  ${bar}  ${paint('1', (left + '% left').padStart(8))} ${paint('2', '· ' + fmtReset(w.resetsAt, now))}`);
  }
  for (const n of r.notes) out.push(paint('2', n));
  const time = new Date(r.fetchedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  out.push(paint('2', [!hideEmail && r.email, 'diperbarui ' + time].filter(Boolean).join(' · ')));
  return out.join('\n');
}

const HELP = `agy-usage — sisa kuota Antigravity (agy) di terminal

Pemakaian: agy-usage [opsi]
  --json            keluaran JSON (satu baris per pembacaan)
  -w, --watch [dt]  perbarui terus tiap dt detik (bawaan 60, minimal 10)
  --hide-email      sembunyikan email akun
  --no-color        tanpa warna (juga mengikuti env NO_COLOR)
  -h, --help        bantuan

Kode keluar: 0 berhasil, 1 gagal.`;

async function main() {
  const args = process.argv.slice(2);
  const has = (...f) => f.some(x => args.includes(x));
  if (has('-h', '--help')) return console.log(HELP);
  const json = has('--json'), hideEmail = has('--hide-email');
  const color = process.stdout.isTTY && !process.env.NO_COLOR && !has('--no-color');
  const wi = args.findIndex(a => a === '-w' || a === '--watch');
  const interval = wi < 0 ? 0 : Math.max(10, Number(args[wi + 1]) || 60);

  const once = async () => {
    const r = await fetchReport();
    if (hideEmail) r.email = null;
    if (json) console.log(JSON.stringify(r));
    else console.log(render(r, { color, hideEmail }));
  };
  if (!interval) {
    try { await once(); } catch (e) { console.error('Error: ' + (e instanceof UsageError ? e.message : 'Gagal membaca usage Antigravity.')); process.exitCode = 1; }
    return;
  }
  for (;;) {
    if (process.stdout.isTTY && !json) process.stdout.write('\x1b[2J\x1b[H');
    try { await once(); } catch (e) { console.error('Error: ' + (e instanceof UsageError ? e.message : 'Gagal membaca usage Antigravity.')); }
    await new Promise(r => setTimeout(r, interval * 1000));
  }
}

if (require.main === module) main();
module.exports = { render, buildReport, parseCredential, tsMs };