const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const TeleWorker = require('../../worker/worker');

const PID_FILE = 'tele-worker.pid';

async function startCommand(args) {
  const isDaemon = args.includes('--daemon') || args.includes('-d');
  const isOnce = args.includes('--once');
  const cwd = process.cwd();

  const pidPath = path.join(cwd, PID_FILE);
  if (fs.existsSync(pidPath)) {
    const existingPid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
    try {
      process.kill(existingPid, 0);
      console.log(`⚠️ Tele-vs-CLI Worker sudah aktif dengan PID ${existingPid}.`);
      console.log(`Gunakan 'tele stop' untuk menghentikan terlebih dahulu.`);
      return;
    } catch (e) {
      fs.unlinkSync(pidPath);
    }
  }

  if (isDaemon) {
    const logsDir = path.join(cwd, 'logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

    const logFile = path.join(logsDir, 'worker.log');
    const out = fs.openSync(logFile, 'a');
    const err = fs.openSync(logFile, 'a');

    const nodeBin = process.execPath;
    const scriptPath = path.join(__dirname, '..', '..', '..', 'bin', 'tele.js');

    const child = spawn(nodeBin, [scriptPath, 'start'], {
      cwd,
      detached: true,
      stdio: ['ignore', out, err]
    });

    child.unref();

    fs.writeFileSync(pidPath, String(child.pid), 'utf-8');
    console.log(`🚀 Tele-vs-CLI Worker berhasil dijalankan di background!`);
    console.log(`📌 Process ID (PID) : ${child.pid}`);
    console.log(`📁 File Log         : ${logFile}`);
    console.log(`💡 Ketik 'tele logs -f' untuk memantau log secara real-time.`);
    console.log(`💡 Ketik 'tele stop' untuk menghentikan worker.`);
    return;
  }

  // Foreground mode
  fs.writeFileSync(pidPath, String(process.pid), 'utf-8');

  const worker = new TeleWorker({ workDir: cwd });

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
    if (isOnce) {
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
