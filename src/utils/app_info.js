const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const ApiClient = require('../api/client');

/**
 * Mengambil informasi versi aplikasi dan tanggal pembaruan terakhir.
 * @param {string} rootDir Direktori root proyek Tele-vs-CLI
 * @returns {{ version: string, commitHash: string, lastUpdateDate: string, hasGit: boolean }}
 */
function getAppInfo(rootDir = path.resolve(__dirname, '..', '..')) {
  let version = '1.0.0';
  const pkgPath = path.join(rootDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg && pkg.version) version = pkg.version;
    } catch (e) {}
  }

  const hasGit = fs.existsSync(path.join(rootDir, '.git'));
  let commitHash = '';
  let lastUpdateDate = '';

  if (hasGit) {
    try {
      commitHash = execSync('git rev-parse --short HEAD', {
        cwd: rootDir,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim();
    } catch (e) {}

    try {
      lastUpdateDate = execSync('git log -1 --format=%ci', {
        cwd: rootDir,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim();
    } catch (e) {}
  }

  if (!lastUpdateDate && fs.existsSync(pkgPath)) {
    try {
      const stat = fs.statSync(pkgPath);
      lastUpdateDate = stat.mtime.toISOString().replace('T', ' ').substring(0, 19);
    } catch (e) {
      lastUpdateDate = '-';
    }
  }

  return {
    version,
    commitHash,
    lastUpdateDate: lastUpdateDate || '-',
    hasGit
  };
}

/**
 * Memeriksa apakah ada pembaruan baru di remote origin/main.
 * @param {string} rootDir Direktori root proyek
 * @returns {{ checked: boolean, updateAvailable: boolean, localCommit?: string, remoteCommit?: string, commits?: string[], reason?: string }}
 */
function checkForUpdates(rootDir = path.resolve(__dirname, '..', '..')) {
  if (!fs.existsSync(path.join(rootDir, '.git'))) {
    return { checked: false, updateAvailable: false, reason: 'no-git' };
  }

  try {
    execSync('git fetch origin main', {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000
    });
    const localCommit = execSync('git rev-parse HEAD', { cwd: rootDir, encoding: 'utf-8' }).trim();
    const remoteCommit = execSync('git rev-parse origin/main', { cwd: rootDir, encoding: 'utf-8' }).trim();

    if (localCommit === remoteCommit) {
      return { checked: true, updateAvailable: false, localCommit, remoteCommit, commits: [] };
    }

    const logDiff = execSync('git log HEAD..origin/main --oneline', { cwd: rootDir, encoding: 'utf-8' }).trim();
    const commits = logDiff ? logDiff.split(/\r?\n/).slice(0, 5) : [];
    return { checked: true, updateAvailable: true, localCommit, remoteCommit, commits };
  } catch (e) {
    return { checked: false, updateAvailable: false, reason: e.message };
  }
}

/**
 * Menerapkan pembaruan otomatis menggunakan git pull origin main.
 * @param {string} rootDir Direktori root proyek
 * @returns {{ ok: boolean, output?: string, error?: string }}
 */
function applyAutoUpdate(rootDir = path.resolve(__dirname, '..', '..')) {
  try {
    const output = execSync('git pull origin main', {
      cwd: rootDir,
      encoding: 'utf-8',
      timeout: 30000
    }).trim();
    return { ok: true, output };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Menghasilkan panduan cara mengganti proyek aktif di Telegram, Dashboard, dan CLI.
 * @param {string} [projectTag] Tag proyek aktif jika tersedia
 * @returns {string[]}
 */
function getProjectSwitchGuideLines(projectTag = '') {
  const sampleTag = projectTag ? `#${projectTag.replace(/^#/, '')}` : '<#tag>';
  return [
    '🔀 CARA GANTI PROYEK AKTIF (Telegram & Dashboard):',
    `   • Di Telegram  : Ketik /use <#tag>  (contoh: /use ${sampleTag})`,
    `   • Di Dashboard : Ketik <#tag> pada kolom perintah (contoh: ${sampleTag}), ATAU`,
    '                    klik dropdown proyek di Dashboard -> pilih proyek tujuan',
    `   • Di Terminal  : Ketik tele use ${sampleTag}`
  ];
}

/**
 * Menguji komunikasi 3-arah antara Workstation, Dashboard Server, dan Telegram.
 * @param {object} config Konfigurasi { serverUrl, secret, projectId }
 * @param {object} [deps] Dependency opsional untuk pengujian
 * @returns {Promise<{ ok: boolean, dashboardOk: boolean, telegramOk: boolean, projectFound: boolean, projectTag: string, projectName: string, messages: string[] }>}
 */
async function testCommunication(config, deps = {}) {
  const messages = [];
  let dashboardOk = false;
  let telegramOk = false;
  let projectFound = false;
  let projectTag = '';
  let projectName = config.projectId || '';
  let botToken = config.botToken || process.env.TELEGRAM_BOT_TOKEN || '';
  let chatId = config.chatId || process.env.TELEGRAM_CHAT_ID || '';

  const client = deps.client || new ApiClient(config.serverUrl, config.secret, config.projectId);
  const fetchFn = deps.fetch || globalThis.fetch;

  // 1. Test Workstation <-> Dashboard
  try {
    const res = await client.request('projects');
    if (res && res.statusCode >= 200 && res.statusCode < 300 && res.data && res.data.ok !== false) {
      dashboardOk = true;
      const projects = Array.isArray(res.data.projects) ? res.data.projects : [];
      const target = projects.find(p =>
        p.project_key === config.projectId ||
        String(p.id) === String(config.projectId) ||
        (p.name && p.name.toLowerCase() === (config.projectId || '').toLowerCase()) ||
        (p.code && p.code.toLowerCase() === (config.projectId || '').replace(/^#/, '').toLowerCase())
      );

      if (target) {
        projectFound = true;
        projectTag = target.code || '';
        projectName = target.name || target.project_key || config.projectId;
        if (target.bot_token) botToken = target.bot_token;
        if (target.chat_id) chatId = target.chat_id;
        messages.push(`✅ Workstation <-> Dashboard : TERHUBUNG (Proyek "${projectName}"${projectTag ? ` [#${projectTag}]` : ''} ditemukan)`);
      } else {
        messages.push(`⚠️ Workstation <-> Dashboard : TERHUBUNG, namun proyek "${config.projectId || '-'}" belum terdaftar di website Dashboard.`);
      }
    } else {
      const errMsg = (res && res.data && res.data.error) ? res.data.error : `HTTP ${res ? res.statusCode : '?'}`;
      messages.push(`❌ Workstation <-> Dashboard : GAGAL (${errMsg})`);
    }
  } catch (e) {
    messages.push(`❌ Workstation <-> Dashboard : GAGAL (${e.message})`);
  }

  // 2. Test Dashboard / Workstation -> Telegram
  if (dashboardOk && botToken && chatId && typeof fetchFn === 'function') {
    const userHost = `${os.userInfo().username}@${os.hostname()}`;
    const tagDisplay = projectTag ? ` (#${projectTag})` : '';
    const testText =
      `✅ <b>Test Komunikasi Tele-vs-CLI Berhasil!</b>\n\n` +
      `💻 <b>Workstation:</b> <code>${userHost}</code>\n` +
      `🌐 <b>Dashboard:</b> Terhubung\n` +
      `🏢 <b>Proyek:</b> <code>${projectName}${tagDisplay}</code>\n\n` +
      `<i>Workstation, Dashboard, dan Telegram siap digunakan.</i>`;

    try {
      const tgRes = await fetchFn(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: testText,
          parse_mode: 'HTML',
          disable_web_page_preview: true
        })
      });
      const tgData = await tgRes.json();
      if (tgData && tgData.ok) {
        telegramOk = true;
        messages.push('✅ Dashboard <-> Telegram    : TERHUBUNG (pesan test berhasil dikirim ke Telegram)');
      } else {
        messages.push(`❌ Dashboard <-> Telegram    : GAGAL (${(tgData && tgData.description) || 'Respon Telegram tidak valid'})`);
      }
    } catch (e) {
      messages.push(`❌ Dashboard <-> Telegram    : GAGAL (${e.message})`);
    }
  } else if (!dashboardOk) {
    messages.push('⚪ Dashboard <-> Telegram    : Dilewati (Dashboard belum terhubung)');
  } else {
    messages.push('⚠️ Dashboard <-> Telegram    : Bot Token / Chat ID belum terkonfigurasi untuk proyek ini di Dashboard');
  }

  return {
    ok: dashboardOk && telegramOk,
    dashboardOk,
    telegramOk,
    projectFound,
    projectTag,
    projectName,
    messages
  };
}

module.exports = {
  getAppInfo,
  checkForUpdates,
  applyAutoUpdate,
  getProjectSwitchGuideLines,
  testCommunication
};
