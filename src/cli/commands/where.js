const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { loadConfig } = require('../../config/config');
const { escapeTelegramHtml } = require('../../utils/telegram');

/**
 * Resolve current git branch for a directory, or '-' if not a git repo.
 * @param {string} workDir
 * @returns {string}
 */
function getGitBranch(workDir) {
  try {
    const out = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: workDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
      windowsHide: true
    }).trim();
    return out || '-';
  } catch (e) {
    return '-';
  }
}

/**
 * Build structured data about the active working directory.
 * @param {string} [cwd]
 */
function buildWhereData(cwd = process.cwd()) {
  const workDir = path.resolve(cwd);
  const config = loadConfig(workDir);
  const exists = fs.existsSync(workDir);
  const gitBranch = exists ? getGitBranch(workDir) : '-';

  return {
    workDir,
    folderName: path.basename(workDir) || workDir,
    exists,
    projectId: config.projectId || '-',
    agent: config.agent || 'auto',
    serverUrl: config.serverUrl,
    gitBranch,
    hostname: os.hostname(),
    platform: `${process.platform} (${process.arch})`
  };
}

/**
 * Format active working directory info as Telegram HTML.
 * @param {ReturnType<typeof buildWhereData>} data
 * @returns {string}
 */
function formatWhereTelegramHtml(data) {
  let html = `📂 <b>DIREKTORI KERJA AKTIF</b>\n`
    + `📍 <b>Path:</b> <code>${escapeTelegramHtml(data.workDir)}</code>\n`
    + `🏢 <b>Proyek:</b> <code>${escapeTelegramHtml(data.projectId)}</code>\n`
    + `🤖 <b>Agent:</b> <code>${escapeTelegramHtml(data.agent)}</code>\n`;

  if (data.gitBranch && data.gitBranch !== '-') {
    html += `🌿 <b>Git Branch:</b> <code>${escapeTelegramHtml(data.gitBranch)}</code>\n`;
  }

  html += `🖥️ <b>Host / OS:</b> <code>${escapeTelegramHtml(data.hostname)}</code> (${escapeTelegramHtml(data.platform)})`;
  return html;
}

/**
 * CLI handler for `kerakerja where [--json]`.
 * @param {string[]} [args]
 */
async function whereCommand(args = []) {
  const isJson = args.includes('--json');
  const data = buildWhereData(process.cwd());

  if (isJson) {
    console.log(JSON.stringify(data, null, 2));
    return data;
  }

  console.log('==============================================================================');
  console.log('📂 DIREKTORI KERJA AKTIF');
  console.log('==============================================================================');
  console.log(`  - Direktori Kerja : ${data.workDir}`);
  console.log(`  - Proyek Aktif    : ${data.projectId}`);
  console.log(`  - AI Agent        : ${data.agent}`);
  if (data.gitBranch && data.gitBranch !== '-') {
    console.log(`  - Git Branch      : ${data.gitBranch}`);
  }
  console.log(`  - Host / OS       : ${data.hostname} (${data.platform})`);
  console.log('==============================================================================\n');
  return data;
}

module.exports = {
  whereCommand,
  buildWhereData,
  formatWhereTelegramHtml
};
