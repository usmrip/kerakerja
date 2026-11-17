const fs = require('fs');
const os = require('os');
const path = require('path');

function getGlobalDir(customHome) {
  const home = customHome || os.homedir();
  return path.join(home, '.tele-vs-cli');
}

function getGlobalWorkspacesPath(customHome) {
  if (!customHome && process.env.TELE_WORKSPACES_FILE) {
    return process.env.TELE_WORKSPACES_FILE;
  }
  return path.join(getGlobalDir(customHome), 'workspaces.json');
}

function normalizeWorkDir(dir) {
  const resolved = path.resolve(String(dir || process.cwd()));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function loadWorkspaces(filePath = getGlobalWorkspacesPath()) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.workspaces) ? parsed.workspaces : []);
    return list.filter(w => w && typeof w === 'object' && w.workDir && w.projectId);
  } catch (e) {
    return [];
  }
}

function saveWorkspaces(workspaces, filePath = getGlobalWorkspacesPath()) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const payload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    workspaces
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
  return filePath;
}

function registerWorkspace(entry, filePath = getGlobalWorkspacesPath()) {
  if (!entry || !entry.workDir || !entry.projectId || entry.projectId === 'default') {
    return { registered: false, reason: 'invalid_entry' };
  }

  const resolvedWorkDir = path.resolve(entry.workDir);
  const normTarget = normalizeWorkDir(resolvedWorkDir);
  const list = loadWorkspaces(filePath);

  const newRecord = {
    projectId: String(entry.projectId),
    workDir: resolvedWorkDir,
    serverUrl: entry.serverUrl || 'https://biru.co.id/tele-vs-cli/',
    secret: entry.secret || '',
    agent: entry.agent || 'auto',
    taskTimeout: Number(entry.taskTimeout) || 600000,
    pollInterval: Number(entry.pollInterval) || 5000,
    updatedAt: new Date().toISOString()
  };

  const idx = list.findIndex(w => normalizeWorkDir(w.workDir) === normTarget);
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...newRecord };
  } else {
    list.push(newRecord);
  }

  saveWorkspaces(list, filePath);
  return { registered: true, updated: idx >= 0, total: list.length, filePath };
}

function unregisterWorkspace(targetOrDir, filePath = getGlobalWorkspacesPath()) {
  if (!targetOrDir) return { removed: false };
  const list = loadWorkspaces(filePath);
  const normDir = normalizeWorkDir(targetOrDir);
  const filtered = list.filter(w =>
    normalizeWorkDir(w.workDir) !== normDir &&
    String(w.projectId).toLowerCase() !== String(targetOrDir).toLowerCase()
  );

  if (filtered.length === list.length) {
    return { removed: false, total: list.length };
  }
  saveWorkspaces(filtered, filePath);
  return { removed: true, total: filtered.length, filePath };
}

module.exports = {
  getGlobalDir,
  getGlobalWorkspacesPath,
  normalizeWorkDir,
  loadWorkspaces,
  saveWorkspaces,
  registerWorkspace,
  unregisterWorkspace
};
