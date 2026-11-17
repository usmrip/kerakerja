const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Normalizes a task ID by trimming whitespace and stripping any leading '#'.
 * @param {string} rawId
 * @returns {string}
 */
function normalizeTaskId(rawId) {
  return String(rawId || '').trim().replace(/^#+/, '');
}

/**
 * Checks whether two task IDs refer to the same task (case-insensitive,
 * tolerating missing '#' or 'TASK-' prefix).
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function matchesTaskId(a, b) {
  const normA = normalizeTaskId(a).toUpperCase();
  const normB = normalizeTaskId(b).toUpperCase();
  if (!normA || !normB) return false;
  if (normA === normB) return true;
  if (normA === `TASK-${normB}` || `TASK-${normA}` === normB) return true;
  return false;
}

/**
 * Terminates a process and its child process tree cross-platform.
 * @param {number} pid
 * @returns {boolean} true if termination was attempted without fatal error
 */
function killProcessTree(pid) {
  const numPid = Number(pid);
  if (!Number.isInteger(numPid) || numPid <= 0) return false;

  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /pid ${numPid} /T /F 2>nul`, { stdio: 'ignore', windowsHide: true });
      return true;
    }
    try {
      process.kill(-numPid, 'SIGKILL');
    } catch (e) {
      process.kill(numPid, 'SIGKILL');
    }
    return true;
  } catch (e) {
    return false;
  }
}

function getActiveTaskFile(workDir) {
  return path.join(workDir || process.cwd(), 'logs', 'active-task.json');
}

function isProcessAlive(pid) {
  const numPid = Number(pid);
  if (!Number.isInteger(numPid) || numPid <= 0) return false;
  try {
    process.kill(numPid, 0);
    return true;
  } catch (e) {
    return e && e.code === 'EPERM';
  }
}

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (e) {
    return null;
  }
}

function isActiveTaskLocked(workDir, currentWorkerId = null, currentPid = process.pid) {
  const root = workDir || process.cwd();
  const candidates = [
    { path: getActiveTaskFile(root), own: true }
  ];

  for (const candidate of candidates) {
    const entry = readJsonSafe(candidate.path);
    if (!entry) continue;

    const pidAlive = isProcessAlive(entry.pid);
    const workerPidAlive = isProcessAlive(entry.workerPid);
    const hasPid = Number.isInteger(Number(entry.pid)) || Number.isInteger(Number(entry.workerPid));

    if (hasPid && !pidAlive && !workerPidAlive) {
      if (candidate.own) {
        try { fs.unlinkSync(candidate.path); } catch (e) {}
      }
      continue;
    }

    const sameWorker = currentWorkerId && entry.workerId && entry.workerId === currentWorkerId;
    const samePid = (entry.workerPid && Number(entry.workerPid) === currentPid) || (entry.pid && Number(entry.pid) === currentPid);
    if (!sameWorker && !samePid) {
      return { locked: true, owner: entry, filePath: candidate.path };
    }
  }

  return { locked: false, owner: null, filePath: null };
}

function hasLocalQueueInProgress(workDir, excludeTaskId = null) {
  const queueFile = path.join(workDir || process.cwd(), 'TASK_QUEUE.md');
  if (!fs.existsSync(queueFile)) return { active: false, taskId: null };
  try {
    const content = fs.readFileSync(queueFile, 'utf-8');
    const activeSection = content.split('## ✅ Riwayat Tugas Selesai')[0];
    const regex = /###\s+\[IN_PROGRESS\]\s+(#?TASK-[A-Za-z0-9_-]+)/gi;
    let match;
    while ((match = regex.exec(activeSection)) !== null) {
      const foundId = match[1];
      if (!excludeTaskId || !matchesTaskId(foundId, excludeTaskId)) {
        return { active: true, taskId: foundId };
      }
    }
  } catch (e) {}
  return { active: false, taskId: null };
}

function writeActiveTask(workDir, info) {
  try {
    const filePath = getActiveTaskFile(workDir);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(info, null, 2), 'utf-8');
  } catch (e) {}
}

function readActiveTask(workDir) {
  try {
    const filePath = getActiveTaskFile(workDir);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (e) {
    return null;
  }
}

function clearActiveTask(workDir, expectedTaskId = null) {
  try {
    const filePath = getActiveTaskFile(workDir);
    if (!fs.existsSync(filePath)) return;
    if (expectedTaskId) {
      const current = readActiveTask(workDir);
      if (current && current.taskId && !matchesTaskId(current.taskId, expectedTaskId)) {
        return;
      }
    }
    fs.unlinkSync(filePath);
  } catch (e) {}
}

function reconcileLocalQueueStatus(workDir, taskId, newStatus = 'PENDING') {
  const queueFile = path.join(workDir || process.cwd(), 'TASK_QUEUE.md');
  if (!fs.existsSync(queueFile) || !taskId) return false;
  try {
    const content = fs.readFileSync(queueFile, 'utf-8');
    const cleanId = normalizeTaskId(taskId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(###\\s+)\\[IN_PROGRESS\\](\\s+#?${cleanId}\\b)`, 'gi');
    const updated = content.replace(re, `$1[${String(newStatus || 'PENDING').toUpperCase()}]$2`);
    if (updated !== content) {
      fs.writeFileSync(queueFile, updated, 'utf-8');
      return true;
    }
  } catch (e) {}
  return false;
}

module.exports = {
  normalizeTaskId,
  matchesTaskId,
  killProcessTree,
  isProcessAlive,
  getActiveTaskFile,
  writeActiveTask,
  readActiveTask,
  clearActiveTask,
  isActiveTaskLocked,
  hasLocalQueueInProgress,
  reconcileLocalQueueStatus
};
