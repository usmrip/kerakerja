const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { getGlobalDir, loadWorkspaces } = require('../../config/workspaces');
const { isActiveTaskLocked, clearActiveTask } = require('../../utils/process');
const { selectFromListInteractive } = require('../../utils/prompt');

const PID_FILE = 'kerakerja-worker.pid';
const MULTI_PID_FILE = 'multi-worker.pid';

function resolvePidFile(cwd, isAll = false) {
  return isAll ? path.join(getGlobalDir(), MULTI_PID_FILE) : path.join(cwd, PID_FILE);
}

function resolveLogFile(cwd, isAll = false) {
  return isAll ? path.join(getGlobalDir(), 'multi-worker.log') : path.join(cwd, 'logs', 'worker.log');
}

function getRunningPid(cwd, isAll = false) {
  const pidPath = resolvePidFile(cwd, isAll);
  if (!fs.existsSync(pidPath)) return null;
  const pid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
  try {
    process.kill(pid, 0);
    return pid;
  } catch (e) {
    try { fs.unlinkSync(pidPath); } catch (_) {}
    return null;
  }
}

function resolveTargetAll(args = [], cwd = process.cwd(), checkLog = false) {
  if (args.includes('--all') || args.includes('-a')) return true;
  if (args.includes('--single')) return false;

  if (checkLog) {
    const localLog = resolveLogFile(cwd, false);
    const multiLog = resolveLogFile(cwd, true);
    if (!fs.existsSync(localLog) && fs.existsSync(multiLog)) {
      return true;
    }
    if (getRunningPid(cwd, true) && !getRunningPid(cwd, false)) {
      return true;
    }
    return false;
  }

  const localPid = getRunningPid(cwd, false);
  if (localPid) return false;
  const multiPid = getRunningPid(cwd, true);
  return Boolean(multiPid);
}

function findActiveJobs(cwd = process.cwd(), isAll = false) {
  const dirsToCheck = [path.resolve(cwd)];
  if (isAll) {
    try {
      for (const ws of loadWorkspaces()) {
        if (ws && ws.workDir) dirsToCheck.push(path.resolve(ws.workDir));
      }
    } catch (e) {}
  }

  const seen = new Set();
  const active = [];
  for (const dir of dirsToCheck) {
    const key = process.platform === 'win32' ? dir.toLowerCase() : dir;
    if (seen.has(key)) continue;
    seen.add(key);

    const lock = isActiveTaskLocked(dir);
    if (lock && lock.locked && lock.owner) {
      active.push({
        workDir: dir,
        taskId: lock.owner.taskId || 'unknown',
        workerPid: lock.owner.workerPid || null,
        executor: lock.owner.executor || 'cli'
      });
    }
  }
  return active;
}

async function promptActiveJobAction(activeJobs, actionLabel = 'stop', selectFn = selectFromListInteractive) {
  const taskList = activeJobs.map((j) => `${j.taskId} (${path.basename(j.workDir)})`).join(', ');
  const title = `⚠️ Masih ada pekerjaan aktif [${taskList}]. Pilih tindakan untuk ${actionLabel}:`;
  const choices = [
    { label: 'Selesaikan pekerjaan (tunggu selesai lalu ' + actionLabel + ')', value: 'wait' },
    { label: 'Lakukan sekarang (hentikan paksa segera)', value: 'now' },
    { label: 'Batal', value: 'cancel' }
  ];
  const selected = await selectFn(title, choices);
  return selected ? selected.value : 'cancel';
}

async function waitForActiveJobsToFinish(cwd, isAll, pollMs = 1000) {
  while (true) {
    const stillActive = findActiveJobs(cwd, isAll);
    const pid = getRunningPid(cwd, isAll);
    if (stillActive.length === 0 || !pid) {
      break;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

async function stopCommand(args = [], deps = {}) {
  const cwd = deps.cwd || process.cwd();
  const isAll = resolveTargetAll(args, cwd);
  const pid = getRunningPid(cwd, isAll);

  if (!pid) {
    console.log(`⚪ Tidak ada background ${isAll ? 'multi-project ' : ''}worker yang sedang berjalan.`);
    return { stopped: false, cancelled: false };
  }

  const force = args.includes('--force') || args.includes('-f') || args.includes('--yes') || args.includes('-y');
  const findFn = deps.findActiveJobs || findActiveJobs;
  const activeJobs = findFn(cwd, isAll);

  if (activeJobs.length > 0 && !force && (deps.selectOption || process.stdin.isTTY)) {
    const actionLabel = deps.actionLabel || 'stop';
    const choice = await promptActiveJobAction(
      activeJobs,
      actionLabel,
      deps.selectOption || selectFromListInteractive
    );
    if (choice === 'cancel') {
      console.log('❎ Dibatalkan. Worker dan pekerjaan aktif tetap berjalan.');
      return { stopped: false, cancelled: true };
    }
    if (choice === 'wait') {
      console.log(`⏳ Menunggu ${activeJobs.length} pekerjaan aktif selesai sebelum ${actionLabel}...`);
      const waitFn = deps.waitForActiveJobs || waitForActiveJobsToFinish;
      await waitFn(cwd, isAll, deps.pollMs || 1000);
    }
  }

  const currentPid = getRunningPid(cwd, isAll);
  if (!currentPid) {
    console.log('✅ Pekerjaan selesai dan worker sudah berhenti.');
    return { stopped: true, cancelled: false };
  }

  console.log(`Menghentikan ${isAll ? 'multi-project ' : ''}worker dengan PID ${currentPid}...`);
  try {
    if (deps.killWorker) {
      deps.killWorker(currentPid);
    } else if (process.platform === 'win32') {
      execSync(`taskkill /pid ${currentPid} /T /F 2>nul`, { windowsHide: true });
    } else {
      process.kill(currentPid, 'SIGTERM');
    }
    console.log(`✅ Worker (PID ${currentPid}) berhasil dihentikan.`);
  } catch (e) {
    console.log(`⚠️ Gagal mengirim sinyal berhenti: ${e.message}`);
  }

  for (const job of activeJobs) {
    clearActiveTask(job.workDir, job.taskId);
  }

  const pidPath = resolvePidFile(cwd, isAll);
  if (fs.existsSync(pidPath)) {
    try { fs.unlinkSync(pidPath); } catch (e) {}
  }
  return { stopped: true, cancelled: false };
}

async function restartCommand(args = [], deps = {}) {
  const cwd = deps.cwd || process.cwd();
  const isAll = resolveTargetAll(args, cwd);
  const isVerbose = args.includes('--verbose') || args.includes('-v');
  const stopRes = await stopCommand(isAll ? [...args, '--all'] : args, { ...deps, actionLabel: 'restart' });
  if (stopRes && stopRes.cancelled) {
    return { restarted: false, cancelled: true };
  }
  await new Promise(r => setTimeout(r, deps.restartDelayMs !== undefined ? deps.restartDelayMs : 1000));
  const startCommand = deps.startCommand || require('./start');
  const startArgs = ['--daemon'];
  if (isAll) startArgs.push('--all');
  if (isVerbose) startArgs.push('--verbose');
  await startCommand(startArgs);
  return { restarted: true, cancelled: false };
}

async function logsCommand(args = []) {
  const cwd = process.cwd();
  const isAll = resolveTargetAll(args, cwd, true);
  const logFile = resolveLogFile(cwd, isAll);

  if (!fs.existsSync(logFile)) {
    console.log(`⚪ Belum ada berkas log di ${logFile}`);
    return;
  }

  const isFollow = args.includes('-f') || args.includes('--follow');

  if (!isFollow) {
    const content = fs.readFileSync(logFile, 'utf-8');
    const lines = content.split('\n');
    console.log(lines.slice(-50).join('\n'));
    return;
  }

  console.log(`[LOGS] Memantau berkas log: ${logFile} (Ctrl+C untuk keluar)...\n`);
  let lastSize = fs.statSync(logFile).size;
  const fd = fs.openSync(logFile, 'r');

  const initialRead = Math.max(0, lastSize - 5000);
  const buf = Buffer.alloc(lastSize - initialRead);
  fs.readSync(fd, buf, 0, buf.length, initialRead);
  process.stdout.write(buf.toString('utf-8'));

  setInterval(() => {
    try {
      const currentSize = fs.statSync(logFile).size;
      if (currentSize > lastSize) {
        const diff = currentSize - lastSize;
        const buffer = Buffer.alloc(diff);
        fs.readSync(fd, buffer, 0, diff, lastSize);
        process.stdout.write(buffer.toString('utf-8'));
        lastSize = currentSize;
      }
    } catch (e) {}
  }, 500);
}

module.exports = {
  stopCommand,
  restartCommand,
  logsCommand,
  getRunningPid,
  resolveTargetAll,
  resolvePidFile,
  resolveLogFile,
  findActiveJobs,
  promptActiveJobAction,
  waitForActiveJobsToFinish
};
