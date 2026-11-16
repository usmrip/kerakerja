const fs = require('fs');
const path = require('path');

const DEFAULT_SERVER_URL = 'https://biru.co.id/tele-vs-cli/';
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

function loadConfig(workDir = process.cwd()) {
  const jsonConfigPath = path.join(workDir, 'tele.config.json');
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
    path.join(workDir, '.env'),
    path.join(workDir, '.vscode', 'tele-vs-cli', 'config.env'),
    path.join(workDir, '.vscode', 'tele-vs-code', 'config.env')
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
  const jsonConfigPath = path.join(workDir, 'tele.config.json');
  fs.writeFileSync(jsonConfigPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  return jsonConfigPath;
}

module.exports = {
  loadConfig,
  saveConfig,
  DEFAULT_SERVER_URL
};
