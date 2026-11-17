const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const TeleWorker = require('../../worker/worker');
const MultiProjectWorker = require('../../worker/multi_worker');
const { loadConfig } = require('../../config/config');
const { getGlobalDir, loadWorkspaces, registerWorkspace } = require('../../config/workspaces');

const PID_FILE = 'kerakerja-worker.pid';
const MULTI_PID_FILE = 'multi-worker.pid';

function isProjectConfigured(cfg) {
  return Boolean(cfg && cfg.secret && cfg.projectId && cfg.projectId !== 'default');
}

function resolveStartMode(args = [], cwd = process.cwd(), workspacesFile = undefined) {
  const explicitAll = args.includes('--all') || args.includes('-a');
  const explicitSingle = args.includes('--single');
  if (explicitAll) {
    return { isAll: true, autoDetected: false, localConfigured: true };
  }

  const localCfg = loadConfig(cwd);
  const localConfigured = isProjectConfigured(localCfg);
  if (localConfigured || explicitSingle) {
    return { isAll: false, autoDetected: false, localConfigured, localCfg };
  }

  const registered = loadWorkspaces(workspacesFile);
  if (registered.length > 0) {
    return { isAll: true, autoDetected: true, localConfigured: false, registeredCount: registered.length };
  }

  return { isAll: false, autoDetected: false, localConfigured: false, registeredCount: 0 };
}

async function startCommand(args = []) {
  const isDaemon = args.includes('--daemon') || args.includes('-d');
  const isOnce = args.includes('--once');
  const isVerbose = args.includes('--verbose') || args.includes('-v');
  const cwd = process.cwd();

  const mode = resolveStartMode(args, cwd);
  const isAll = mode.isAll;

  if (mode.autoDetected) {
    console.log(`ℹ️ Direktori '${cwd}' belum dikonfigurasi sebagai proyek tunggal.`);
    console.log(`🚀 Otomatis menjalankan Multi-Project Worker untuk ${mode.registeredCount} proyek terdaftar...\n`);
  } else if (!isAll && !mode.localConfigured) {
    console.error(`❌ Direktori '${cwd}' belum dikonfigurasi dan belum ada proyek di Multi-Project Registry.`);
    console.error(`💡 Masuk ke folder proyek Anda (misal /a, /b) lalu jalankan 'kerakerja init',`);
    console.error(`   setelah itu jalankan 'kerakerja start --all --daemon' (atau 'kerakerja start --daemon' dari folder mana saja).`);
    process.exit(1);
  }

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
        console.log(`⚠️ ${isAll ? 'Multi-Project Worker' : 'KeraKerja Worker'} sudah aktif dengan PID ${existingPid}.`);
        console.log(`Gunakan 'kerakerja stop${isAll ? ' --all' : ''}' untuk menghentikan terlebih dahulu.`);
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
    const scriptPath = path.join(__dirname, '..', '..', '..', 'bin', 'kerakerja.js');

    const spawnArgs = [scriptPath, 'start'];
    if (isAll) spawnArgs.push('--all');
    if (isVerbose) spawnArgs.push('--verbose');

    const child = spawn(nodeBin, spawnArgs, {
      cwd,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', out, err]
    });

    child.unref();

    fs.writeFileSync(pidPath, String(child.pid), 'utf-8');
    console.log(`🚀 ${isAll ? 'KeraKerja Multi-Project Worker' : 'KeraKerja Worker'} berhasil dijalankan di background!`);
    console.log(`📌 Process ID (PID) : ${child.pid}`);
    console.log(`📁 File Log         : ${logFile}`);
    if (isVerbose) {
      console.log(`🔍 Mode Verbose     : AKTIF (progres berjalan agent dicatat ke log)`);
    }
    console.log(`💡 Ketik 'kerakerja logs${isAll ? ' --all' : ''} -f' untuk memantau log secara real-time.`);
    console.log(`💡 Ketik 'kerakerja stop${isAll ? ' --all' : ''}' untuk menghentikan worker.`);
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

startCommand.resolveStartMode = resolveStartMode;
startCommand.isProjectConfigured = isProjectConfigured;

module.exports = startCommand;
