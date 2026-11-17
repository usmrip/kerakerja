const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const TeleWorker = require('../../worker/worker');
const MultiProjectWorker = require('../../worker/multi_worker');
const { loadConfig } = require('../../config/config');
const { getGlobalDir, registerWorkspace } = require('../../config/workspaces');

const PID_FILE = 'tele-worker.pid';
const MULTI_PID_FILE = 'multi-worker.pid';

async function startCommand(args = []) {
  const isDaemon = args.includes('--daemon') || args.includes('-d');
  const isOnce = args.includes('--once');
  const isVerbose = args.includes('--verbose') || args.includes('-v');
  const isAll = args.includes('--all') || args.includes('-a');
  const cwd = process.cwd();

  const globalDir = getGlobalDir();
  const pidPath = isAll ? path.join(globalDir, MULTI_PID_FILE) : path.join(cwd, PID_FILE);
  const logFile = isAll ? path.join(globalDir, 'multi-worker.log') : path.join(cwd, 'logs', 'worker.log');

  if (isAll && !fs.existsSync(globalDir)) {
    fs.mkdirSync(globalDir, { recursive: true });
  }

  if (fs.existsSync(pidPath)) {
    const existingPid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
    if (existingPid !== process.pid) {
      try {
        process.kill(existingPid, 0);
        console.log(`⚠️ ${isAll ? 'Multi-Project Worker' : 'Tele-vs-CLI Worker'} sudah aktif dengan PID ${existingPid}.`);
        console.log(`Gunakan 'tele stop${isAll ? ' --all' : ''}' untuk menghentikan terlebih dahulu.`);
        return;
      } catch (e) {
        fs.unlinkSync(pidPath);
      }
    }
  }

  if (isDaemon) {
    const logsDir = path.dirname(logFile);
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

    const out = fs.openSync(logFile, 'a');
    const err = fs.openSync(logFile, 'a');

    const nodeBin = process.execPath;
    const scriptPath = path.join(__dirname, '..', '..', '..', 'bin', 'tele.js');

    const spawnArgs = [scriptPath, 'start'];
    if (isAll) spawnArgs.push('--all');
    if (isVerbose) spawnArgs.push('--verbose');

    const child = spawn(nodeBin, spawnArgs, {
      cwd,
      detached: true,
      stdio: ['ignore', out, err]
    });

    child.unref();

    fs.writeFileSync(pidPath, String(child.pid), 'utf-8');
    console.log(`🚀 ${isAll ? 'Tele-vs-CLI Multi-Project Worker' : 'Tele-vs-CLI Worker'} berhasil dijalankan di background!`);
    console.log(`📌 Process ID (PID) : ${child.pid}`);
    console.log(`📁 File Log         : ${logFile}`);
    if (isVerbose) {
      console.log(`🔍 Mode Verbose     : AKTIF (progres berjalan agent dicatat ke log)`);
    }
    console.log(`💡 Ketik 'tele logs${isAll ? ' --all' : ''} -f' untuk memantau log secara real-time.`);
    console.log(`💡 Ketik 'tele stop${isAll ? ' --all' : ''}' untuk menghentikan worker.`);
    return;
  }

  // Foreground mode
  fs.writeFileSync(pidPath, String(process.pid), 'utf-8');

  if (!isAll) {
    // Auto-register workspace lokal jika sudah terkonfigurasi
    const cfg = loadConfig(cwd);
    if (cfg.secret && cfg.projectId && cfg.projectId !== 'default') {
      registerWorkspace({ ...cfg, workDir: cwd });
    }
  }

  const worker = isAll
    ? new MultiProjectWorker({ verbose: isVerbose })
    : new TeleWorker({ workDir: cwd, verbose: isVerbose });

  const cleanup = async () => {
    console.log('\n[SIGNAL] Menerima sinyal berhenti...');
    await worker.stop();
    if (fs.existsSync(pidPath)) {
      try { fs.unlinkSync(pidPath); } catch (e) {}
    }
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  try {
    if (isOnce && !isAll) {
      console.log('⚡ Menjalankan 1 siklus pemeriksaan tugas (--once)...');
      await worker.checkAndProcessNextTask();
      if (fs.existsSync(pidPath)) fs.unlinkSync(pidPath);
      process.exit(0);
    } else {
      await worker.start();
    }
  } catch (err) {
    console.error(`❌ Gagal memulai worker: ${err.message}`);
    if (fs.existsSync(pidPath)) fs.unlinkSync(pidPath);
    process.exit(1);
  }
}

module.exports = startCommand;
