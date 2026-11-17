const os = require('os');
const path = require('path');
const { loadConfig } = require('../../config/config');
const { getAppInfo } = require('../../utils/app_info');
const { escapeTelegramHtml } = require('../../utils/telegram');

function buildInfoData(cwd = process.cwd(), rootDir = path.resolve(__dirname, '..', '..', '..')) {
  const config = loadConfig(cwd);
  const appInfo = getAppInfo(rootDir);
  return {
    name: 'KeraKerja',
    version: appInfo.version,
    commitHash: appInfo.commitHash || '-',
    lastUpdateDate: appInfo.lastUpdateDate || '-',
    hasGit: appInfo.hasGit,
    installDir: rootDir,
    workDir: cwd,
    projectId: config.projectId || '-',
    agent: config.agent || 'auto',
    serverUrl: config.serverUrl,
    hostname: os.hostname(),
    platform: `${process.platform} (${process.arch})`,
    nodeVersion: process.version
  };
}

function formatInfoTelegramHtml(info) {
  const versionStr = `<code>v${escapeTelegramHtml(info.version)}</code>`
    + (info.commitHash && info.commitHash !== '-' ? ` (<code>${escapeTelegramHtml(info.commitHash)}</code>)` : '');

  return [
    'ℹ️ <b>INFORMASI VERSI KERAKERJA</b>',
    '━━━━━━━━━━━━━━━━━━━━━━',
    `📦 <b>Versi:</b> ${versionStr}`,
    `🕒 <b>Update Terakhir:</b> <code>${escapeTelegramHtml(info.lastUpdateDate)}</code>`,
    '',
    `🏢 <b>Proyek Aktif:</b> <code>${escapeTelegramHtml(info.projectId)}</code>`,
    `🤖 <b>Agent:</b> <code>${escapeTelegramHtml(info.agent)}</code>`,
    `🖥️ <b>Host / OS:</b> <code>${escapeTelegramHtml(info.hostname)}</code> (<code>${escapeTelegramHtml(info.platform)}</code>)`,
    `📂 <b>WorkDir:</b> <code>${escapeTelegramHtml(info.workDir)}</code>`
  ].join('\n');
}

async function infoCommand(args = []) {
  const isJson = args.includes('--json');
  const info = buildInfoData(process.cwd());

  if (isJson) {
    console.log(JSON.stringify(info, null, 2));
    return info;
  }

  console.log('==============================================================================');
  console.log('ℹ️ INFORMASI VERSI KERAKERJA');
  console.log('==============================================================================');
  console.log(`  - Versi           : v${info.version}${info.commitHash !== '-' ? ` (${info.commitHash})` : ''}`);
  console.log(`  - Update Terakhir : ${info.lastUpdateDate}`);
  console.log(`  - Direktori App   : ${info.installDir}`);
  console.log(`  - Direktori Kerja : ${info.workDir}`);
  console.log(`  - Proyek Aktif    : ${info.projectId}`);
  console.log(`  - AI Agent        : ${info.agent}`);
  console.log(`  - Server          : ${info.serverUrl}`);
  console.log(`  - Node.js / OS    : ${info.nodeVersion} / ${info.platform} (${info.hostname})`);
  console.log('==============================================================================\n');
  return info;
}

module.exports = {
  infoCommand,
  buildInfoData,
  formatInfoTelegramHtml
};
