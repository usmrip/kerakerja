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
      execSync(`taskkill /pid ${numPid} /T /F 2>nul`, { stdio: 'ignore' });
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

module.exports = {
  normalizeTaskId,
  matchesTaskId,
  killProcessTree,
  getActiveTaskFile,
  writeActiveTask,
  readActiveTask,
  clearActiveTask
};
