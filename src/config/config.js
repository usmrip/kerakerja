const fs = require('fs');
const path = require('path');

const DEFAULT_SERVER_URL = 'https://biru.co.id/kerakerja/';
const DEFAULT_TIMEOUT_MS = 600000; // 10 menit

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf-8');
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.substring(0, eqIdx).trim();
      let val = trimmed.substring(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.substring(1, val.length - 1);
      }
      env[key] = val;
    }
  }
  return env;
}

function getConfigPath(workDir = process.cwd()) {
  return path.join(workDir, '.biru', 'kerakerja.config.json');
}

function ensureSecureConfigDir(configDir) {
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  }
  if (process.platform !== 'win32') {
    try { fs.chmodSync(configDir, 0o700); } catch (e) {}
  }

  const htaccessPath = path.join(configDir, '.htaccess');
  if (!fs.existsSync(htaccessPath)) {
    const htaccessContent = [
      '# Lindungi konfigurasi KeraKerja agar tidak bisa diakses/diunduh publik',
      '<IfModule mod_authz_core.c>',
      '    Require all denied',
      '</IfModule>',
      '<IfModule !mod_authz_core.c>',
      '    Order allow,deny',
      '    Deny from all',
      '</IfModule>',
      ''
    ].join('\n');
    fs.writeFileSync(htaccessPath, htaccessContent, { encoding: 'utf-8', mode: 0o644 });
    if (process.platform !== 'win32') {
      try { fs.chmodSync(htaccessPath, 0o644); } catch (e) {}
    }
  }
}

function loadConfig(workDir = process.cwd()) {
  const biruJsonPath = getConfigPath(workDir);
  const dotConfigJsonPath = path.join(workDir, '.config', 'kerakerja.config.json');
  const legacyKerakerjaJsonPath = path.join(workDir, 'kerakerja.config.json');
  const legacyTeleJsonPath = path.join(workDir, 'tele.config.json');
  const jsonConfigPath = [biruJsonPath, dotConfigJsonPath, legacyKerakerjaJsonPath, legacyTeleJsonPath]
    .find((p) => fs.existsSync(p)) || biruJsonPath;

  let jsonConfig = {};
  if (fs.existsSync(jsonConfigPath)) {
    try {
      jsonConfig = JSON.parse(fs.readFileSync(jsonConfigPath, 'utf-8'));
    } catch (e) {
      console.warn(`[WARN] Gagal parse ${jsonConfigPath}: ${e.message}`);
    }
  }

  const envCandidates = [
    path.join(workDir, 'config.env'),
    path.join(workDir, '.env')
  ];

  let fileEnv = {};
  for (const c of envCandidates) {
    if (fs.existsSync(c)) {
      fileEnv = { ...loadEnvFile(c), ...fileEnv };
    }
  }

  const serverUrl = jsonConfig.serverUrl || 
                    process.env.TELE_SERVER_URL || 
                    process.env.AGENTS_TELE_SERVER_URL || 
                    fileEnv.TELE_SERVER_URL || 
                    fileEnv.AGENTS_TELE_SERVER_URL || 
                    DEFAULT_SERVER_URL;

  const secret = jsonConfig.secret || 
                 process.env.TELE_SECRET || 
                 process.env.AGENTS_TELE_SECRET || 
                 fileEnv.TELE_SECRET || 
                 fileEnv.AGENTS_TELE_SECRET || 
                 '';

  const projectId = jsonConfig.projectId || 
                    process.env.TELE_PROJECT_ID || 
                    process.env.AGENTS_TELE_PROJECT_KEY || 
                    fileEnv.TELE_PROJECT_ID || 
                    fileEnv.AGENTS_TELE_PROJECT_KEY || 
                    'default';

  const agent = jsonConfig.agent || 
                process.env.TELE_AGENT || 
                fileEnv.TELE_AGENT || 
                'auto';

  const taskTimeout = parseInt(
    jsonConfig.taskTimeout || 
    process.env.TELE_TASK_TIMEOUT || 
    fileEnv.TELE_TASK_TIMEOUT || 
    DEFAULT_TIMEOUT_MS, 
    10
  );

  const pollInterval = parseInt(
    jsonConfig.pollInterval || 
    process.env.TELE_POLL_INTERVAL || 
    fileEnv.TELE_POLL_INTERVAL || 
    5000, 
    10
  );

  return {
    serverUrl: serverUrl.endsWith('/') ? serverUrl : serverUrl + '/',
    secret,
    projectId,
    agent,
    taskTimeout,
    pollInterval,
    workDir: path.resolve(workDir),
    jsonConfigPath
  };
}

function saveConfig(config, workDir = process.cwd()) {
  const jsonConfigPath = getConfigPath(workDir);
  const configDir = path.dirname(jsonConfigPath);
  ensureSecureConfigDir(configDir);
  fs.writeFileSync(jsonConfigPath, JSON.stringify(config, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
  if (process.platform !== 'win32') {
    try { fs.chmodSync(jsonConfigPath, 0o600); } catch (e) {}
  }
  return jsonConfigPath;
}

module.exports = {
  getConfigPath,
  ensureSecureConfigDir,
  loadConfig,
  saveConfig,
  DEFAULT_SERVER_URL
};
