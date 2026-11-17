const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadConfig } = require('../../config/config');
const { formatLocalTimestamp } = require('../../utils/time');
const { formatBytes } = require('./sampah');
const { escapeTelegramHtml, sendTelegramHtml } = require('../../utils/telegram');

const VALID_PARAM_TOKENS = new Set(['full', 'db', 'database', 'kode', 'code', 'upload', 'uploads']);
const CODE_EXCLUDE_DIRS = new Set(['.git', 'node_modules', 'logs', 'tmp', '.tmp', 'snapshot-kerakerja']);
const CODE_EXCLUDE_FILES = new Set(['kerakerja-worker.pid', 'tele-worker.pid']);
const DB_EXTENSIONS = new Set(['.db', '.sqlite', '.sqlite3']);
const UPLOAD_DIR_CANDIDATES = [
  'uploads',
  'upload',
  path.join('public', 'uploads'),
  path.join('storage', 'app', 'public'),
  'attachments',
  'media'
];

function getSnapshotRoot(workDir = process.cwd()) {
  const resolved = path.resolve(workDir);
  return path.join(path.dirname(resolved), 'snapshot-kerakerja');
}

function sanitizeBaseCode(rawCode) {
  const cleaned = String(rawCode || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned;
}

function isParamTokenString(token) {
  const parts = String(token || '')
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0) return false;
  return parts.every((p) => VALID_PARAM_TOKENS.has(p));
}

function parseSnapshotParams(paramText = 'full') {
  const raw = String(paramText || 'full').trim().toLowerCase();
  if (!raw) {
    return { ok: true, label: 'full', includes: { kode: true, db: true, upload: true } };
  }

  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) {
    return { ok: true, label: 'full', includes: { kode: true, db: true, upload: true } };
  }

  const includes = { kode: false, db: false, upload: false };
  const normalizedParts = [];
  for (const part of parts) {
    if (!VALID_PARAM_TOKENS.has(part)) {
      return {
        ok: false,
        error: `Parameter snapshot tidak dikenal: '${part}'. Gunakan: full, db, kode, upload, atau kombinasi (misal: db,kode).`
      };
    }
    if (part === 'full') {
      includes.kode = true;
      includes.db = true;
      includes.upload = true;
      normalizedParts.push('full');
    } else if (part === 'db' || part === 'database') {
      includes.db = true;
      normalizedParts.push('db');
    } else if (part === 'kode' || part === 'code') {
      includes.kode = true;
      normalizedParts.push('kode');
    } else if (part === 'upload' || part === 'uploads') {
      includes.upload = true;
      normalizedParts.push('upload');
    }
  }

  const label = (includes.kode && includes.db && includes.upload)
    ? 'full'
    : Array.from(new Set(normalizedParts)).join(',');

  return { ok: true, label, includes };
}

function listSnapshots(workDir = process.cwd(), limit = 4) {
  const snapshotRoot = getSnapshotRoot(workDir);
  if (!fs.existsSync(snapshotRoot)) {
    return { snapshotRoot, snapshots: [], latest: [] };
  }

  const snapshots = [];
  for (const entry of fs.readdirSync(snapshotRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dirPath = path.join(snapshotRoot, entry.name);
    const metaPath = path.join(dirPath, 'meta.json');
    let meta = null;
    if (fs.existsSync(metaPath)) {
      try {
        meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      } catch (e) {}
    }
    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(dirPath).mtimeMs || 0;
    } catch (e) {}

    const baseMatch = entry.name.match(/^(.+)-(\d+)$/);
    snapshots.push({
      code: (meta && meta.code) || entry.name,
      baseCode: (meta && meta.baseCode) || (baseMatch ? baseMatch[1] : entry.name),
      seq: (meta && meta.seq) || (baseMatch ? parseInt(baseMatch[2], 10) : 1),
      params: (meta && meta.params) || 'full',
      includes: (meta && meta.includes) || {
        kode: fs.existsSync(path.join(dirPath, 'kode')),
        db: fs.existsSync(path.join(dirPath, 'db')),
        upload: fs.existsSync(path.join(dirPath, 'upload'))
      },
      createdAt: (meta && meta.createdAt) || formatLocalTimestamp(mtimeMs || Date.now()),
      createdAtMs: (meta && meta.createdAtMs) || mtimeMs,
      totalBytes: (meta && meta.stats && meta.stats.totalBytes) || 0,
      dirPath
    });
  }

  snapshots.sort((a, b) => (b.createdAtMs - a.createdAtMs) || b.code.localeCompare(a.code));
  return {
    snapshotRoot,
    snapshots,
    latest: snapshots.slice(0, limit)
  };
}

function resolveSnapshotInputs(args = [], workDir = process.cwd()) {
  const tokens = Array.isArray(args)
    ? args.map((a) => String(a).trim()).filter(Boolean)
    : String(args || '').trim().split(/\s+/).filter(Boolean);

  const { snapshots } = listSnapshots(workDir);
  const latestSnapshot = snapshots[0] || null;

  if (tokens.length === 0) {
    if (!latestSnapshot) {
      return {
        ok: false,
        error: 'Kode snapshot pertama kali wajib diisi! Contoh: /snapshot rilis full'
      };
    }
    return {
      ok: true,
      baseCode: latestSnapshot.baseCode,
      paramRes: parseSnapshotParams('full')
    };
  }

  if (tokens.length === 1) {
    const first = tokens[0];
    if (isParamTokenString(first) && latestSnapshot) {
      return {
        ok: true,
        baseCode: latestSnapshot.baseCode,
        paramRes: parseSnapshotParams(first)
      };
    }
    const baseCode = sanitizeBaseCode(first);
    if (!baseCode) {
      return { ok: false, error: 'Kode snapshot tidak valid. Gunakan huruf/angka, misal: /snapshot rilis full' };
    }
    return {
      ok: true,
      baseCode,
      paramRes: parseSnapshotParams('full')
    };
  }

  const baseCode = sanitizeBaseCode(tokens[0]);
  if (!baseCode) {
    return { ok: false, error: 'Kode snapshot tidak valid. Gunakan huruf/angka, misal: /snapshot rilis full' };
  }
  const paramRes = parseSnapshotParams(tokens.slice(1).join(','));
  if (!paramRes.ok) {
    return { ok: false, error: paramRes.error };
  }

  return { ok: true, baseCode, paramRes };
}

function getNextSnapshotName(snapshotRoot, baseCode) {
  let maxSeq = 0;
  if (fs.existsSync(snapshotRoot)) {
    const escaped = baseCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^${escaped}-(\\d+)$`, 'i');
    for (const entry of fs.readdirSync(snapshotRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const m = entry.name.match(re);
      if (m) {
        const seq = parseInt(m[1], 10);
        if (!Number.isNaN(seq) && seq > maxSeq) maxSeq = seq;
      }
    }
  }
  const nextSeq = maxSeq + 1;
  return {
    seq: nextSeq,
    fullCode: `${baseCode}-${String(nextSeq).padStart(2, '0')}`
  };
}

function copyTreeFiltered(srcDir, destDir, options = {}, stats = { files: 0, bytes: 0 }, depth = 0) {
  if (!fs.existsSync(srcDir) || depth > 20) return stats;
  fs.mkdirSync(destDir, { recursive: true });

  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (options.excludeDirs && options.excludeDirs.has(entry.name)) continue;
    if (options.excludeFiles && options.excludeFiles.has(entry.name)) continue;

    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      copyTreeFiltered(srcPath, destPath, options, stats, depth + 1);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
      try {
        stats.bytes += fs.statSync(destPath).size || 0;
      } catch (e) {}
      stats.files += 1;
    }
  }
  return stats;
}

function findSqliteFiles(rootDir, currentDir = rootDir, depth = 0, out = []) {
  if (!fs.existsSync(currentDir) || depth > 4) return out;
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    if (CODE_EXCLUDE_DIRS.has(entry.name)) continue;
    const full = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      findSqliteFiles(rootDir, full, depth + 1, out);
    } else if (entry.isFile() && DB_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      out.push(path.relative(rootDir, full));
    }
  }
  return out;
}

function readSimpleEnv(workDir) {
  const env = {};
  for (const fname of ['.env', 'config.env']) {
    const fpath = path.join(workDir, fname);
    if (!fs.existsSync(fpath)) continue;
    const content = fs.readFileSync(fpath, 'utf-8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const k = trimmed.substring(0, idx).trim();
        let v = trimmed.substring(idx + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        if (!(k in env)) env[k] = v;
      }
    }
  }
  return env;
}

function backupDatabase(workDir, dbTargetDir) {
  const stats = { files: 0, bytes: 0, notes: [] };
  const sqliteFiles = findSqliteFiles(workDir);
  if (sqliteFiles.length > 0) {
    const sqliteDest = path.join(dbTargetDir, 'sqlite');
    for (const rel of sqliteFiles) {
      const src = path.join(workDir, rel);
      const dest = path.join(sqliteDest, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      try {
        stats.bytes += fs.statSync(dest).size || 0;
      } catch (e) {}
      stats.files += 1;
    }
  }

  const env = readSimpleEnv(workDir);
  const dbName = env.DB_DATABASE || env.MYSQL_DATABASE;
  const dbConn = (env.DB_CONNECTION || '').toLowerCase();
  if (dbName && (dbConn === 'mysql' || env.MYSQL_DATABASE)) {
    try {
      const dumpArgs = [];
      if (env.DB_HOST) dumpArgs.push('-h', env.DB_HOST);
      if (env.DB_PORT) dumpArgs.push('-P', env.DB_PORT);
      if (env.DB_USERNAME) dumpArgs.push('-u', env.DB_USERNAME);
      if (env.DB_PASSWORD) dumpArgs.push(`-p${env.DB_PASSWORD}`);
      dumpArgs.push(dbName);
      const sqlOut = execFileSync('mysqldump', dumpArgs, { encoding: 'utf-8', timeout: 30000, windowsHide: true });
      fs.mkdirSync(dbTargetDir, { recursive: true });
      const dumpPath = path.join(dbTargetDir, 'mysql_dump.sql');
      fs.writeFileSync(dumpPath, sqlOut, 'utf-8');
      stats.bytes += Buffer.byteLength(sqlOut);
      stats.files += 1;
    } catch (e) {
      stats.notes.push(`mysqldump dilewati: ${e.message}`);
    }
  } else if (env.DATABASE_URL && env.DATABASE_URL.startsWith('postgres')) {
    try {
      const sqlOut = execFileSync('pg_dump', [env.DATABASE_URL], { encoding: 'utf-8', timeout: 30000, windowsHide: true });
      fs.mkdirSync(dbTargetDir, { recursive: true });
      const dumpPath = path.join(dbTargetDir, 'postgres_dump.sql');
      fs.writeFileSync(dumpPath, sqlOut, 'utf-8');
      stats.bytes += Buffer.byteLength(sqlOut);
      stats.files += 1;
    } catch (e) {
      stats.notes.push(`pg_dump dilewati: ${e.message}`);
    }
  }

  return stats;
}

function backupUploads(workDir, uploadTargetDir) {
  const stats = { files: 0, bytes: 0, dirs: [] };
  for (const rel of UPLOAD_DIR_CANDIDATES) {
    const src = path.join(workDir, rel);
    if (fs.existsSync(src) && fs.statSync(src).isDirectory()) {
      const dest = path.join(uploadTargetDir, rel);
      copyTreeFiltered(src, dest, {}, stats);
      stats.dirs.push(rel);
    }
  }
  return stats;
}

function createSnapshot({ workDir = process.cwd(), baseCode, paramRes, projectId = '' }) {
  const resolvedWorkDir = path.resolve(workDir);
  const snapshotRoot = getSnapshotRoot(resolvedWorkDir);
  fs.mkdirSync(snapshotRoot, { recursive: true });

  const { seq, fullCode } = getNextSnapshotName(snapshotRoot, baseCode);
  const snapshotDir = path.join(snapshotRoot, fullCode);
  fs.mkdirSync(snapshotDir, { recursive: true });

  const includes = paramRes.includes;
  const kodeStats = includes.kode
    ? copyTreeFiltered(resolvedWorkDir, path.join(snapshotDir, 'kode'), {
        excludeDirs: CODE_EXCLUDE_DIRS,
        excludeFiles: CODE_EXCLUDE_FILES
      })
    : { files: 0, bytes: 0 };

  const dbStats = includes.db
    ? backupDatabase(resolvedWorkDir, path.join(snapshotDir, 'db'))
    : { files: 0, bytes: 0, notes: [] };

  const uploadStats = includes.upload
    ? backupUploads(resolvedWorkDir, path.join(snapshotDir, 'upload'))
    : { files: 0, bytes: 0, dirs: [] };

  const totalBytes = kodeStats.bytes + dbStats.bytes + uploadStats.bytes;
  const createdAtMs = Date.now();
  const createdAt = formatLocalTimestamp(createdAtMs);

  const meta = {
    code: fullCode,
    baseCode,
    seq,
    params: paramRes.label,
    includes,
    projectId,
    workDir: resolvedWorkDir,
    createdAt,
    createdAtMs,
    stats: {
      kodeFiles: kodeStats.files,
      dbFiles: dbStats.files,
      uploadFiles: uploadStats.files,
      totalBytes
    }
  };

  fs.writeFileSync(path.join(snapshotDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n', 'utf-8');

  const archiveFile = `${fullCode}.tar.gz`;
  const archivePath = path.join(snapshotDir, archiveFile);
  const tarEntries = ['meta.json', 'kode', 'db', 'upload'].filter((name) => fs.existsSync(path.join(snapshotDir, name)));
  if (tarEntries.length > 0) {
    execFileSync('tar', ['-czf', archivePath, '-C', snapshotDir, ...tarEntries], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 120000
    });
    for (const dirName of ['kode', 'db', 'upload']) {
      const p = path.join(snapshotDir, dirName);
      if (fs.existsSync(p)) {
        fs.rmSync(p, { recursive: true, force: true });
      }
    }
    meta.archiveFile = archiveFile;
    try {
      meta.archiveBytes = fs.statSync(archivePath).size || 0;
    } catch (e) {
      meta.archiveBytes = 0;
    }
    fs.writeFileSync(path.join(snapshotDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n', 'utf-8');
  }

  return {
    ok: true,
    snapshotRoot,
    snapshotDir,
    archiveFile,
    archivePath,
    meta
  };
}

function restoreSnapshot({ workDir = process.cwd(), code }) {
  const resolvedWorkDir = path.resolve(workDir);
  const { snapshotRoot, snapshots, latest } = listSnapshots(resolvedWorkDir, 4);
  const targetCode = String(code || '').trim();

  if (!targetCode) {
    return {
      ok: false,
      needsSelection: true,
      error: 'Kode snapshot lengkap belum disebutkan.',
      snapshotRoot,
      latest
    };
  }

  const matched = snapshots.find((s) => s.code.toLowerCase() === targetCode.toLowerCase());
  if (!matched) {
    return {
      ok: false,
      needsSelection: true,
      error: `Snapshot '${targetCode}' tidak ditemukan. Harus menyebutkan kode lengkap (contoh: ${latest[0] ? latest[0].code : 'rilis-01'}).`,
      snapshotRoot,
      latest
    };
  }

  const restored = { kodeFiles: 0, dbFiles: 0, uploadFiles: 0, totalBytes: 0 };
  const archiveCandidate = path.join(matched.dirPath, `${matched.code}.tar.gz`);
  let sourceRoot = matched.dirPath;
  let tempExtractDir = null;

  try {
    if (fs.existsSync(archiveCandidate)) {
      tempExtractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kerakerja-restore-'));
      execFileSync('tar', ['-xzf', archiveCandidate, '-C', tempExtractDir], {
        stdio: 'ignore',
        windowsHide: true,
        timeout: 120000
      });
      sourceRoot = tempExtractDir;
    }

    const kodeSrc = path.join(sourceRoot, 'kode');
    if (fs.existsSync(kodeSrc)) {
      const s = copyTreeFiltered(kodeSrc, resolvedWorkDir, {
        excludeDirs: CODE_EXCLUDE_DIRS,
        excludeFiles: CODE_EXCLUDE_FILES
      });
      restored.kodeFiles = s.files;
      restored.totalBytes += s.bytes;
    }

    const sqliteSrc = path.join(sourceRoot, 'db', 'sqlite');
    if (fs.existsSync(sqliteSrc)) {
      const s = copyTreeFiltered(sqliteSrc, resolvedWorkDir, {});
      restored.dbFiles = s.files;
      restored.totalBytes += s.bytes;
    }

    const uploadSrc = path.join(sourceRoot, 'upload');
    if (fs.existsSync(uploadSrc)) {
      const s = copyTreeFiltered(uploadSrc, resolvedWorkDir, {});
      restored.uploadFiles = s.files;
      restored.totalBytes += s.bytes;
    }
  } finally {
    if (tempExtractDir && fs.existsSync(tempExtractDir)) {
      fs.rmSync(tempExtractDir, { recursive: true, force: true });
    }
  }

  return {
    ok: true,
    code: matched.code,
    snapshotDir: matched.dirPath,
    meta: matched,
    restored
  };
}

function buildRestoreTelegramPayload(latest, projectId = '') {
  if (!latest || latest.length === 0) {
    return {
      html: `📦 <b>RESTORE SNAPSHOT</b>\n📁 <b>Proyek:</b> <code>${escapeTelegramHtml(projectId || '-')}</code>\n\n⚠️ Belum ada snapshot tersimpan di <code>snapshot-kerakerja</code>.\n💡 Buat dulu dengan: <code>/snapshot rilis full</code>`,
      extra: {}
    };
  }

  const lines = latest.map((s, idx) => (
    `${idx + 1}. <code>${escapeTelegramHtml(s.code)}</code> (${escapeTelegramHtml(s.params)} • ${formatBytes(s.totalBytes)} • ${escapeTelegramHtml(s.createdAt)})`
  ));

  const keyboard = latest.map((s) => ([
    {
      text: `♻️ ${s.code} (${s.params} • ${formatBytes(s.totalBytes)})`,
      callback_data: `cb:restore:${s.code}`
    }
  ]));

  const html = `♻️ <b>PILIH SNAPSHOT UNTUK RESTORE</b>\n`
             + `📁 <b>Proyek:</b> <code>${escapeTelegramHtml(projectId || '-')}</code>\n\n`
             + `<b>4 Snapshot Terakhir:</b>\n`
             + lines.join('\n') + `\n\n`
             + `💡 Pilih salah satu tombol di bawah atau ketik <code>/restore &lt;kode_lengkap&gt;</code>:`;

  return {
    html,
    extra: {
      reply_markup: {
        inline_keyboard: keyboard
      }
    }
  };
}

function listSnapshotArtifacts(snapshotDir) {
  const items = [];
  if (!snapshotDir || !fs.existsSync(snapshotDir)) return items;
  try {
    for (const entry of fs.readdirSync(snapshotDir, { withFileTypes: true })) {
      if (entry.isFile()) {
        items.push(entry.name);
      } else if (entry.isDirectory()) {
        const subDir = path.join(snapshotDir, entry.name);
        if (entry.name === 'db') {
          const sqliteDir = path.join(subDir, 'sqlite');
          if (fs.existsSync(sqliteDir)) {
            const dbFiles = findSqliteFiles(sqliteDir);
            for (const f of dbFiles.slice(0, 5)) {
              items.push(`db/sqlite/${f}`);
            }
          }
          for (const f of fs.readdirSync(subDir)) {
            if (f.endsWith('.sql')) items.push(`db/${f}`);
          }
        } else {
          items.push(`${entry.name}/`);
        }
      }
    }
  } catch (e) {}
  return items;
}

function formatSnapshotSuccessHtml(res) {
  const m = res.meta;
  const archiveName = m.archiveFile || res.archiveFile || `${m.code}.tar.gz`;
  const archiveSize = m.archiveBytes ? ` (${formatBytes(m.archiveBytes)})` : '';
  const artifacts = listSnapshotArtifacts(res.snapshotDir);
  const fileLines = artifacts.length > 0
    ? artifacts.map((f) => `• <code>${escapeTelegramHtml(f)}</code>`).join('\n')
    : `• <code>${escapeTelegramHtml(archiveName)}</code>`;

  return `📸 <b>SNAPSHOT BERHASIL DIBUAT</b>\n`
       + `🏷️ <b>Kode:</b> <code>${escapeTelegramHtml(m.code)}</code>\n`
       + `⚙️ <b>Parameter:</b> <code>${escapeTelegramHtml(m.params)}</code>\n`
       + `📁 <b>Folder:</b> <code>${escapeTelegramHtml(res.snapshotDir)}</code>\n`
       + `🗜️ <b>Archive:</b> <code>${escapeTelegramHtml(archiveName)}</code>${escapeHtmlBytes(archiveSize)}\n`
       + `🕒 <b>Waktu:</b> ${escapeTelegramHtml(m.createdAt)}\n`
       + `📊 <b>Ringkasan:</b> Kode ${m.stats.kodeFiles} file | DB ${m.stats.dbFiles} file | Upload ${m.stats.uploadFiles} file (${formatBytes(m.stats.totalBytes)})\n`
       + `📄 <b>File Snapshot:</b>\n${fileLines}`;
}

function escapeHtmlBytes(s) {
  return escapeTelegramHtml(s);
}

function formatRestoreSuccessHtml(res) {
  return `♻️ <b>RESTORE SNAPSHOT SELESAI</b>\n`
       + `🏷️ <b>Kode:</b> <code>${escapeTelegramHtml(res.code)}</code>\n`
       + `📂 <b>Sumber:</b> <code>${escapeTelegramHtml(res.snapshotDir)}</code>\n`
       + `📊 <b>Dipulihkan:</b> Kode ${res.restored.kodeFiles} file | DB ${res.restored.dbFiles} file | Upload ${res.restored.uploadFiles} file (${formatBytes(res.restored.totalBytes)})`;
}

async function snapshotCommand(args = []) {
  const isJson = args.includes('--json');
  const cleanArgs = args.filter((a) => a !== '--json' && a !== '--no-telegram');
  const cwd = process.cwd();
  const config = loadConfig(cwd);

  const resolved = resolveSnapshotInputs(cleanArgs, cwd);
  if (!resolved.ok) {
    if (isJson) {
      console.log(JSON.stringify(resolved, null, 2));
    } else {
      console.error(`❌ ${resolved.error}`);
    }
    return resolved;
  }

  const res = createSnapshot({
    workDir: cwd,
    baseCode: resolved.baseCode,
    paramRes: resolved.paramRes,
    projectId: config.projectId
  });

  if (!args.includes('--no-telegram')) {
    await sendTelegramHtml(config, formatSnapshotSuccessHtml(res));
  }

  if (isJson) {
    console.log(JSON.stringify(res, null, 2));
  } else {
    console.log(`\n📸 Snapshot berhasil dibuat: ${res.meta.code}`);
    console.log(`   Parameter : ${res.meta.params}`);
    console.log(`   Lokasi    : ${res.snapshotDir}`);
    console.log(`   Isi       : Kode ${res.meta.stats.kodeFiles} file | DB ${res.meta.stats.dbFiles} file | Upload ${res.meta.stats.uploadFiles} file (${formatBytes(res.meta.stats.totalBytes)})\n`);
  }
  return res;
}

async function restoreCommand(args = []) {
  const isJson = args.includes('--json');
  const cleanArgs = args.filter((a) => a !== '--json' && a !== '--no-telegram');
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const targetCode = cleanArgs[0] || '';

  const res = restoreSnapshot({ workDir: cwd, code: targetCode });

  if (!res.ok) {
    if (!args.includes('--no-telegram')) {
      const payload = buildRestoreTelegramPayload(res.latest, config.projectId);
      await sendTelegramHtml(config, payload.html, payload.extra);
    }
    if (isJson) {
      console.log(JSON.stringify(res, null, 2));
    } else {
      console.log(`\n⚠️ ${res.error}`);
      if (res.latest && res.latest.length > 0) {
        console.log('\n📦 4 Snapshot Terakhir:');
        for (const s of res.latest) {
          console.log(`   • ${s.code} (${s.params} | ${formatBytes(s.totalBytes)} | ${s.createdAt})`);
        }
        console.log('\n💡 Gunakan: kerakerja restore <kode_lengkap>\n');
      }
    }
    return res;
  }

  if (!args.includes('--no-telegram')) {
    await sendTelegramHtml(config, formatRestoreSuccessHtml(res));
  }

  if (isJson) {
    console.log(JSON.stringify(res, null, 2));
  } else {
    console.log(`\n♻️ Snapshot '${res.code}' berhasil di-restore!`);
    console.log(`   Dipulihkan: Kode ${res.restored.kodeFiles} file | DB ${res.restored.dbFiles} file | Upload ${res.restored.uploadFiles} file (${formatBytes(res.restored.totalBytes)})\n`);
  }
  return res;
}

module.exports = {
  getSnapshotRoot,
  sanitizeBaseCode,
  parseSnapshotParams,
  listSnapshots,
  resolveSnapshotInputs,
  getNextSnapshotName,
  createSnapshot,
  restoreSnapshot,
  buildRestoreTelegramPayload,
  formatSnapshotSuccessHtml,
  formatRestoreSuccessHtml,
  snapshotCommand,
  restoreCommand
};
