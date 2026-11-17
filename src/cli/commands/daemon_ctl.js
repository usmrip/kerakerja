const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { getGlobalDir } = require('../../config/workspaces');

const PID_FILE = 'tele-worker.pid';
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

async function stopCommand(args = []) {
  const cwd = process.cwd();
  const isAll = args.includes('--all') || args.includes('-a');
  const pid = getRunningPid(cwd, isAll);

  if (!pid) {
    console.log(`⚪ Tidak ada background ${isAll ? 'multi-project ' : ''}worker yang sedang berjalan.`);
    return;
  }

  console.log(`Menghentikan ${isAll ? 'multi-project ' : ''}worker dengan PID ${pid}...`);
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /pid ${pid} /T /F 2>nul`);
    } else {
      process.kill(pid, 'SIGTERM');
    }
    console.log(`✅ Worker (PID ${pid}) berhasil dihentikan.`);
  } catch (e) {
    console.log(`⚠️ Gagal mengirim sinyal berhenti: ${e.message}`);
  }

  const pidPath = resolvePidFile(cwd, isAll);
  if (fs.existsSync(pidPath)) {
    try { fs.unlinkSync(pidPath); } catch (e) {}
  }
}

async function restartCommand(args = []) {
  const isAll = args.includes('--all') || args.includes('-a');
  const isVerbose = args.includes('--verbose') || args.includes('-v');
  await stopCommand(args);
  await new Promise(r => setTimeout(r, 1000));
  const startCommand = require('./start');
  const startArgs = ['--daemon'];
  if (isAll) startArgs.push('--all');
  if (isVerbose) startArgs.push('--verbose');
  await startCommand(startArgs);
}

async function logsCommand(args = []) {
  const cwd = process.cwd();
  const isAll = args.includes('--all') || args.includes('-a');
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
  getRunningPid
};
