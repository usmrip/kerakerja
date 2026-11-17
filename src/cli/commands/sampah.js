const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');
const { loadConfig, getConfigPath } = require('../../config/config');
const { loadWorkspaces } = require('../../config/workspaces');
const ApiClient = require('../../api/client');
const { formatLocalTimestamp } = require('../../utils/time');
const { getInstallPaths, removeDirFromWindowsPath } = require('../../../scripts/uninstall');

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function getPathSize(targetPath, depth = 0) {
  if (depth > 8 || !fs.existsSync(targetPath)) return 0;
  try {
    const stat = fs.lstatSync(targetPath);
    if (!stat.isDirectory()) return stat.size || 0;
    let total = 0;
    for (const entry of fs.readdirSync(targetPath)) {
      total += getPathSize(path.join(targetPath, entry), depth + 1);
    }
    return total;
  } catch (e) {
    return 0;
  }
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function stopPidIfAlive(pidPath, dryRun, platform) {
  if (!fs.existsSync(pidPath)) return;
  try {
    const pid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
    if (Number.isNaN(pid) || pid <= 0) return;
    let alive = false;
    try {
      process.kill(pid, 0);
      alive = true;
    } catch (e) {
      alive = false;
    }
    if (alive && !dryRun) {
      if (platform === 'win32') {
        execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore', windowsHide: true });
      } else {
        process.kill(pid, 'SIGTERM');
      }
    }
  } catch (e) {}
}

function removeFileItem(filePath, label, scope, dryRun, items) {
  if (!fs.existsSync(filePath)) return;
  const size = getPathSize(filePath);
  if (dryRun) {
    items.push({ item: label, path: filePath, scope, status: 'Akan Dihapus', size, ok: true });
    return;
  }
  try {
    fs.unlinkSync(filePath);
    items.push({ item: label, path: filePath, scope, status: 'Dihapus', size, ok: true });
  } catch (e) {
    items.push({ item: label, path: filePath, scope, status: 'Gagal', size, ok: false, error: e.message });
  }
}

function removeDirItem(dirPath, label, scope, dryRun, items) {
  if (!fs.existsSync(dirPath)) return;
  const size = getPathSize(dirPath);
  if (dryRun) {
    items.push({ item: label, path: dirPath, scope, status: 'Akan Dihapus', size, ok: true });
    return;
  }
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
    items.push({ item: label, path: dirPath, scope, status: 'Dihapus', size, ok: true });
  } catch (e) {
    items.push({ item: label, path: dirPath, scope, status: 'Gagal', size, ok: false, error: e.message });
  }
}

function migrateOrDeleteLegacyConfig(legacyPath, targetConfigPath, label, scope, dryRun, items) {
  if (!fs.existsSync(legacyPath)) return;
  const size = getPathSize(legacyPath);
  if (!fs.existsSync(targetConfigPath)) {
    if (dryRun) {
      items.push({ item: `${label} -> .config/`, path: legacyPath, scope, status: 'Akan Dimigrasi', size, ok: true });
      return;
    }
    try {
      fs.mkdirSync(path.dirname(targetConfigPath), { recursive: true });
      fs.copyFileSync(legacyPath, targetConfigPath);
      fs.unlinkSync(legacyPath);
      items.push({ item: `${label} -> .config/`, path: legacyPath, scope, status: 'Dimigrasi', size, ok: true });
    } catch (e) {
      items.push({ item: label, path: legacyPath, scope, status: 'Gagal', size, ok: false, error: e.message });
    }
    return;
  }
  removeFileItem(legacyPath, label, scope, dryRun, items);
}

/**
 * Membersihkan seluruh file/direktori legacy `tele-vs-cli` di workspace dan sistem global.
 */
function cleanTeleVsCliTrash(options = {}) {
  const workDir = path.resolve(options.workDir || process.cwd());
  const dryRun = Boolean(options.dryRun);
  const platform = options.platform || process.platform;
  const homeDir = options.homeDir || os.homedir();
  const localAppData = options.localAppData || process.env.LOCALAPPDATA;
  const cleanGlobal = options.cleanGlobal !== false;
  const includeRegisteredWorkspaces = options.includeRegisteredWorkspaces !== false;

  const items = [];
  const wsDirs = [workDir];
  if (Array.isArray(options.extraWorkDirs)) {
    wsDirs.push(...options.extraWorkDirs);
  }
  if (includeRegisteredWorkspaces) {
    try {
      for (const ws of loadWorkspaces()) {
        if (ws && ws.workDir) wsDirs.push(ws.workDir);
      }
    } catch (e) {}
  }

  const seenDirs = new Set();
  for (const dir of wsDirs) {
    if (!dir) continue;
    const resolved = path.resolve(dir);
    const key = platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (seenDirs.has(key) || !fs.existsSync(resolved)) continue;
    seenDirs.add(key);

    const isCurrent = (platform === 'win32'
      ? resolved.toLowerCase() === workDir.toLowerCase()
      : resolved === workDir);
    const scope = isCurrent ? 'Lokal' : `WS:${path.basename(resolved)}`;
    const dotConfigPath = getConfigPath(resolved);

    stopPidIfAlive(path.join(resolved, 'tele-worker.pid'), dryRun, platform);
    removeFileItem(path.join(resolved, 'tele-worker.pid'), 'tele-worker.pid', scope, dryRun, items);
    removeFileItem(path.join(resolved, 'tele-worker.log'), 'tele-worker.log', scope, dryRun, items);
    removeFileItem(path.join(resolved, 'logs', 'tele-worker.log'), 'logs/tele-worker.log', scope, dryRun, items);
    removeDirItem(path.join(resolved, '.vscode', 'tele-vs-cli', 'logs'), '.vscode/tele-vs-cli/logs', scope, dryRun, items);

    migrateOrDeleteLegacyConfig(
      path.join(resolved, 'kerakerja.config.json'),
      dotConfigPath,
      'kerakerja.config.json (root)',
      scope,
      dryRun,
      items
    );
    migrateOrDeleteLegacyConfig(
      path.join(resolved, 'tele.config.json'),
      dotConfigPath,
      'tele.config.json',
      scope,
      dryRun,
      items
    );
  }

  if (cleanGlobal) {
    const installPaths = getInstallPaths(platform, homeDir, localAppData);
    const legacyHomeDir = path.join(homeDir, '.tele-vs-cli');
    stopPidIfAlive(path.join(legacyHomeDir, 'multi-worker.pid'), dryRun, platform);
    removeDirItem(legacyHomeDir, '~/.tele-vs-cli', 'Global', dryRun, items);
    removeDirItem(path.join(homeDir, '.config', 'tele-notify'), '~/.config/tele-notify', 'Global', dryRun, items);

    if (platform === 'win32') {
      if (installPaths.legacyBaseDir) {
        removeDirItem(installPaths.legacyBaseDir, '%LOCALAPPDATA%\\tele-vs-cli', 'Global', dryRun, items);
      }
      if (!options.skipSystemCommands) {
        if (installPaths.legacyServiceName) {
          try {
            execSync(`schtasks /query /tn "${installPaths.legacyServiceName}"`, { stdio: 'ignore', windowsHide: true });
            if (dryRun) {
              items.push({ item: installPaths.legacyServiceName, path: installPaths.legacyServiceName, scope: 'Service', status: 'Akan Dihapus', size: 0, ok: true });
            } else {
              execSync(`schtasks /delete /tn "${installPaths.legacyServiceName}" /f`, { stdio: 'ignore', windowsHide: true });
              items.push({ item: installPaths.legacyServiceName, path: installPaths.legacyServiceName, scope: 'Service', status: 'Dihapus', size: 0, ok: true });
            }
          } catch (e) {}
        }
        if (installPaths.legacyBinDir) {
          try {
            const currentPath = execSync(
              'powershell -NoProfile -ExecutionPolicy Bypass -Command "[Environment]::GetEnvironmentVariable(\'Path\', \'User\')"',
              { encoding: 'utf-8', windowsHide: true }
            ).trim();
            const { changed, newPath } = removeDirFromWindowsPath(currentPath, installPaths.legacyBinDir);
            if (changed) {
              if (dryRun) {
                items.push({ item: 'PATH tele-vs-cli\\bin', path: installPaths.legacyBinDir, scope: 'PATH', status: 'Akan Dihapus', size: 0, ok: true });
              } else {
                execSync(
                  'powershell -NoProfile -ExecutionPolicy Bypass -Command "[Environment]::SetEnvironmentVariable(\'Path\', $env:__TELE_NEW_PATH, \'User\')"',
                  { windowsHide: true, env: { ...process.env, __TELE_NEW_PATH: newPath } }
                );
                items.push({ item: 'PATH tele-vs-cli\\bin', path: installPaths.legacyBinDir, scope: 'PATH', status: 'Dihapus', size: 0, ok: true });
              }
            }
          } catch (e) {}
        }
      }
    } else {
      for (const launcher of installPaths.legacyLaunchers || []) {
        removeFileItem(launcher, path.basename(launcher), 'Global', dryRun, items);
      }
      if (installPaths.legacySystemdUnit) {
        removeFileItem(installPaths.legacySystemdUnit, 'tele-vs-cli.service', 'Service', dryRun, items);
      }
      if (installPaths.legacyLaunchdPlist) {
        removeFileItem(installPaths.legacyLaunchdPlist, 'com.usmrip.tele-vs-cli.plist', 'Service', dryRun, items);
      }
    }
  }

  let cleanedCount = 0;
  let migratedCount = 0;
  let failedCount = 0;
  let totalBytes = 0;

  for (const it of items) {
    if (!it.ok) {
      failedCount += 1;
    } else if (String(it.status).includes('Migrasi') || String(it.status).includes('Dimigrasi')) {
      migratedCount += 1;
      totalBytes += it.size || 0;
    } else {
      cleanedCount += 1;
      totalBytes += it.size || 0;
    }
  }

  return {
    dryRun,
    workDir,
    checkedWorkspaces: seenDirs.size,
    items,
    cleanedCount,
    migratedCount,
    failedCount,
    totalBytes
  };
}

function truncateCell(str, maxLen) {
  const s = String(str || '');
  if (s.length <= maxLen) return s;
  return s.slice(0, Math.max(1, maxLen - 1)) + '…';
}

function formatCleanupTable(report) {
  const rows = (report && Array.isArray(report.items) && report.items.length > 0)
    ? report.items.map((it, idx) => ({
        no: String(idx + 1),
        item: truncateCell(it.item, 28),
        scope: truncateCell(it.scope, 10),
        status: truncateCell(it.status, 14),
        size: it.size > 0 ? formatBytes(it.size) : '-'
      }))
    : [{ no: '-', item: 'Tidak ada sampah tele-vs-cli', scope: 'Semua', status: 'Sudah Bersih', size: '-' }];

  const headers = { no: 'No', item: 'Item', scope: 'Scope', status: 'Status', size: 'Ukuran' };
  const widths = {
    no: Math.max(headers.no.length, ...rows.map((r) => r.no.length)),
    item: Math.max(headers.item.length, ...rows.map((r) => r.item.length)),
    scope: Math.max(headers.scope.length, ...rows.map((r) => r.scope.length)),
    status: Math.max(headers.status.length, ...rows.map((r) => r.status.length)),
    size: Math.max(headers.size.length, ...rows.map((r) => r.size.length))
  };

  const sep = `+-${'-'.repeat(widths.no)}-+-${'-'.repeat(widths.item)}-+-${'-'.repeat(widths.scope)}-+-${'-'.repeat(widths.status)}-+-${'-'.repeat(widths.size)}-+`;
  const rowLine = (r) => `| ${r.no.padStart(widths.no)} | ${r.item.padEnd(widths.item)} | ${r.scope.padEnd(widths.scope)} | ${r.status.padEnd(widths.status)} | ${r.size.padStart(widths.size)} |`;

  const lines = [sep, rowLine(headers), sep];
  for (const r of rows) {
    lines.push(rowLine(r));
  }
  lines.push(sep);
  return lines.join('\n');
}

function formatCleanupTelegramHtml(report, meta = {}) {
  const projectLabel = meta.projectName || meta.projectId || path.basename(report.workDir || process.cwd());
  const timestamp = meta.timestamp || formatLocalTimestamp();
  const table = formatCleanupTable(report);
  const modeTag = report.dryRun ? ' (DRY-RUN)' : '';

  const totalActionable = (report.cleanedCount || 0) + (report.migratedCount || 0);
  const summaryLine = totalActionable === 0
    ? '✅ <b>Status:</b> Tidak ditemukan sampah <code>tele-vs-cli</code> (sudah bersih).'
    : `📊 <b>Ringkasan:</b> ${report.cleanedCount} dihapus, ${report.migratedCount} dimigrasi (${formatBytes(report.totalBytes)})${report.failedCount ? `, ${report.failedCount} gagal` : ''}.`;

  let msg = `🧹 <b>LAPORAN PEMBERSIHAN SAMPAH TELE-VS-CLI${escapeHtml(modeTag)}</b>\n`
          + `📁 <b>Proyek:</b> <code>${escapeHtml(projectLabel)}</code>\n`
          + `🕒 <b>Waktu:</b> ${escapeHtml(timestamp)}\n\n`
          + `<pre>${escapeHtml(table)}</pre>\n\n`
          + summaryLine;

  if (msg.length > 4000) {
    msg = msg.slice(0, 3960) + '\n...</pre>';
  }
  return msg;
}

function postTelegramMessage(botToken, chatId, htmlText) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      chat_id: chatId,
      text: htmlText,
      parse_mode: 'HTML'
    });
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${botToken}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 8000
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ ok: Boolean(parsed && parsed.ok), error: parsed && parsed.description });
        } catch (e) {
          resolve({ ok: false, error: 'Invalid Telegram response' });
        }
      });
    });
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Timeout' }); });
    req.write(payload);
    req.end();
  });
}

async function sendTelegramReport(config, htmlText) {
  let botToken = process.env.TELEGRAM_BOT_TOKEN || '';
  let chatId = process.env.TELEGRAM_CHAT_ID || '';

  if (config && config.serverUrl && config.secret) {
    try {
      const api = new ApiClient(config.serverUrl, config.secret, config.projectId);
      const res = await api.request('projects');
      const projects = (res && res.data && Array.isArray(res.data.projects)) ? res.data.projects : [];
      const target = projects.find((p) => (
        p.project_key === config.projectId ||
        String(p.id) === String(config.projectId) ||
        (p.code && p.code.toLowerCase() === String(config.projectId || '').toLowerCase()) ||
        p.name === config.projectId
      )) || projects[0];
      if (target) {
        if (target.bot_token) botToken = target.bot_token;
        if (target.telegram_chat_id) chatId = target.telegram_chat_id;
      }
    } catch (e) {}
  }

  if (!botToken || !chatId) {
    return { ok: false, error: 'Kredensial Telegram (bot_token/chat_id) tidak tersedia' };
  }
  return postTelegramMessage(botToken, chatId, htmlText);
}

async function sampahCommand(args = []) {
  const flags = new Set(args.map((a) => String(a).trim().toLowerCase()));
  const dryRun = flags.has('--dry-run');
  const isJson = flags.has('--json');
  const noTelegram = flags.has('--no-telegram');
  const localOnly = flags.has('--local-only');

  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const report = cleanTeleVsCliTrash({
    workDir: cwd,
    dryRun,
    cleanGlobal: !localOnly
  });

  let telegramRes = { ok: false, skipped: true };
  if (!dryRun && !noTelegram) {
    const html = formatCleanupTelegramHtml(report, { projectId: config.projectId });
    telegramRes = await sendTelegramReport(config, html);
  }

  if (isJson) {
    console.log(JSON.stringify({ ...report, telegram: telegramRes }, null, 2));
    return report;
  }

  console.log('\n==============================================================================');
  console.log(`🧹 PEMBERSIHAN SAMPAH TELE-VS-CLI${dryRun ? ' (DRY-RUN)' : ''}`);
  console.log('==============================================================================\n');
  console.log(formatCleanupTable(report));
  console.log(`\n📊 Ringkasan: ${report.cleanedCount} dihapus, ${report.migratedCount} dimigrasi (${formatBytes(report.totalBytes)}), ${report.failedCount} gagal.`);
  if (!dryRun && !noTelegram) {
    if (telegramRes.ok) {
      console.log('📨 Laporan tabel berhasil dikirim ke Telegram.');
    } else {
      console.log(`⚠️ Laporan Telegram dilewati/gagal: ${telegramRes.error || 'tidak tersedia'}`);
    }
  }
  console.log('');
  return report;
}

module.exports = {
  sampahCommand,
  cleanTeleVsCliTrash,
  formatCleanupTable,
  formatCleanupTelegramHtml,
  sendTelegramReport,
  formatBytes
};
