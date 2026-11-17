const fs = require('fs');
const os = require('os');
const path = require('path');

function getGlobalDir(customHome) {
  const home = customHome || os.homedir();
  return path.join(home, '.kerakerja');
}

function getGlobalWorkspacesPath(customHome) {
  if (!customHome && (process.env.KERAKERJA_WORKSPACES_FILE || process.env.TELE_WORKSPACES_FILE)) {
    return process.env.KERAKERJA_WORKSPACES_FILE || process.env.TELE_WORKSPACES_FILE;
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
  const normTargetDir = normalizeWorkDir(resolvedWorkDir);
  const normTargetProject = String(entry.projectId).trim().toLowerCase();
  const list = loadWorkspaces(filePath);

  let updated = false;
  let movedFrom = null;
  let existingMatch = null;
  const prunedList = [];

  for (const w of list) {
    const wDirNorm = normalizeWorkDir(w.workDir);
    const wProjNorm = String(w.projectId || '').trim().toLowerCase();

    if (wDirNorm === normTargetDir) {
      updated = true;
      existingMatch = w;
      continue;
    }

    if (wProjNorm === normTargetProject) {
      updated = true;
      movedFrom = w.workDir;
      existingMatch = existingMatch || w;
      continue;
    }

    // Auto-prune entri lama yang foldernya sudah dihapus/dipindah dari disk
    if (!fs.existsSync(w.workDir)) {
      continue;
    }

    prunedList.push(w);
  }

  const newRecord = {
    ...(existingMatch || {}),
    projectId: String(entry.projectId),
    workDir: resolvedWorkDir,
    serverUrl: entry.serverUrl || (existingMatch && existingMatch.serverUrl) || 'https://biru.co.id/kerakerja/',
    secret: entry.secret || (existingMatch && existingMatch.secret) || '',
    agent: entry.agent || (existingMatch && existingMatch.agent) || 'auto',
    taskTimeout: Number(entry.taskTimeout) || (existingMatch && existingMatch.taskTimeout) || 600000,
    pollInterval: Number(entry.pollInterval) || (existingMatch && existingMatch.pollInterval) || 5000,
    updatedAt: new Date().toISOString()
  };

  prunedList.push(newRecord);
  saveWorkspaces(prunedList, filePath);
  return {
    registered: true,
    updated,
    movedFrom,
    total: prunedList.length,
    filePath
  };
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
